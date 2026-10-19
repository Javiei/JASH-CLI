import fs from 'node:fs';
import path from 'node:path';
import { checkbox, confirm } from '@inquirer/prompts';
import chalk from 'chalk';
import ora from 'ora';
import Table from 'cli-table3';
import { JashError } from '../core/errors.js';
import { openSession } from '../core/session.js';
import { clientFromSession } from '../moodle/client.js';
import { aiFromSession } from '../ai/providers.js';
import { syncTasks, sortedTasks, upcoming, overdueTasks, findTask, isPending } from '../tasks/sync.js';
import { generateDraft } from '../tasks/draft.js';
import { planSubmission, submitPlan } from '../tasks/submit.js';
import { openFolder, prepareTaskFolder } from '../tasks/workspace.js';
import {
  formatDate,
  relative,
  urgencyColor,
  moodleStatusLabel,
  localStateLabel,
  ok,
  info,
  warn,
} from '../ui/format.js';

const truncate = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export async function runSync(session, client) {
  const sp = ora({ text: 'Sincronizando con Moodle…', color: 'cyan' }).start();
  try {
    const r = await syncTasks(session, client, { onProgress: (t) => (sp.text = t) });
    const pending = r.tasks.filter(isPending).length;
    sp.succeed(`Sincronizado: ${r.tasks.length} tareas en ${r.courses.length} materias (${pending} pendientes)`);
    return r;
  } catch (err) {
    sp.fail('No se pudo sincronizar');
    throw err;
  }
}

/** Sincroniza si la caché tiene más de `maxAgeH` horas. */
async function ensureFresh(session, client, maxAgeH = 6) {
  const age = session.state.lastSync ? (Date.now() - Date.parse(session.state.lastSync)) / 36e5 : Infinity;
  if (age >= maxAgeH) await runSync(session, client);
}

export function printTasks(tasks, { title } = {}) {
  if (title) console.log(chalk.bold(`\n${title}`));
  if (!tasks.length) return info('No hay tareas para mostrar.');
  const table = new Table({
    head: ['ID', 'Materia', 'Tarea', 'Entrega', 'Falta', 'Moodle', 'Jash'].map((h) => chalk.hex('#38bdf8').bold(h)),
    style: { head: [], border: ['gray'] },
    wordWrap: true,
  });
  for (const t of tasks) {
    const color = urgencyColor(t.duedate);
    table.push([
      chalk.bold(t.id),
      truncate(t.course, 18),
      truncate(t.name, 40),
      formatDate(t.duedate),
      color(relative(t.duedate)),
      moodleStatusLabel(t.moodleStatus),
      localStateLabel(t.local?.state),
    ]);
  }
  console.log(table.toString());
}

// ---------- sincronizar ----------

export async function sincronizar(gopts) {
  const session = await openSession({ profileName: gopts.perfil });
  await runSync(session, clientFromSession(session));

  const over = overdueTasks(session.state);
  if (over.length) {
    console.log(chalk.red.bold(`\n⚠ Tienes ${over.length} tarea(s) vencida(s) sin entregar:`));
    printTasks(over);
  }

  printTasks(upcoming(session.state, 7, { includeUndated: true }), { title: 'Pendientes de la semana / próximos 7 días' });
}

// ---------- tareas ----------

export async function tareas(opts, gopts) {
  const session = await openSession({ profileName: gopts.perfil });
  if (opts.sync) await runSync(session, clientFromSession(session));
  if (!session.state.lastSync) {
    throw new JashError('Aún no has sincronizado tus tareas.', { hint: 'Ejecuta `jash sincronizar`.' });
  }

  let list;
  let title;
  if (opts.vencidas) {
    list = overdueTasks(session.state);
    title = `⚠ Tareas vencidas sin entregar (${list.length})`;
  } else if (opts.todas) {
    list = sortedTasks(session.state);
    title = 'Todas las tareas';
  } else if (opts.semana) {
    list = upcoming(session.state, 7, { includeUndated: true });
    title = 'Pendientes de la semana / próximos 7 días';
  } else {
    list = sortedTasks(session.state).filter(isPending);
    const over = overdueTasks(session.state);
    if (over.length) {
      console.log(chalk.red.bold(`\n⚠ Tienes ${over.length} tarea(s) vencida(s) sin entregar (ver solo vencidas: jash tareas -v)`));
    }
    title = 'Todas las tareas pendientes';
  }
  printTasks(list, { title });
  console.log(chalk.dim(`Última sincronización: ${new Date(session.state.lastSync).toLocaleString('es')}`));
}

// ---------- borrador ----------

export async function borrador(ids, opts, gopts) {
  const session = await openSession({ profileName: gopts.perfil });
  const client = clientFromSession(session);
  const ai = aiFromSession(session);
  await ensureFresh(session, client);

  let targets = [];
  if (ids.length) {
    for (const id of ids) {
      const t = findTask(session.state, id);
      if (t) targets.push(t);
      else warn(`No encontré la tarea ${id}. Revisa \`jash tareas\`.`);
    }
  } else if (opts.semana) {
    targets = upcoming(session.state, 7).filter((t) => opts.forzar || t.local?.state === 'pendiente');
  } else {
    const candidates = upcoming(session.state, 21, { includeUndated: true });
    if (!candidates.length) return info('No tienes tareas pendientes. 🎉');
    targets = await checkbox({
      message: '¿Para qué tareas preparo borrador?',
      choices: candidates.map((t) => ({
        value: t,
        name: `${t.course} — ${t.name} ${chalk.dim(`(${relative(t.duedate)})`)}${t.local?.state === 'borrador' ? chalk.cyan(' · ya tiene borrador') : ''}`,
        checked: t.local?.state === 'pendiente' && t.duedate && t.duedate - Date.now() / 1000 < 7 * 86400,
      })),
      pageSize: 15,
    });
  }

  if (!targets.length) {
    return info(opts.semana ? 'Todas las tareas de la semana ya tienen borrador (usa --forzar para rehacerlos).' : 'Nada seleccionado.');
  }

  console.log(chalk.dim(`\nUsando ${ai.label}. Esto puede tardar un poco por tarea…\n`));
  const done = [];
  for (const task of targets) {
    const sp = ora({ text: `${task.name}`, color: 'magenta', prefixText: chalk.dim(`[${task.id}]`) }).start();
    try {
      const r = await generateDraft(session, ai, client, task, {
        instructions: opts.indicaciones,
        onProgress: (t) => (sp.text = `${task.name} · ${chalk.dim(t)}`),
      });
      sp.succeed(`${task.name} ${chalk.dim('→')} ${chalk.underline(path.relative(session.profile.workspaceDir, r.dir))}`);
      done.push(task);
    } catch (err) {
      sp.fail(`${task.name}: ${err.message}`);
      if (err.hint) console.log(chalk.dim(`  ${err.hint}`));
    }
  }

  if (done.length) {
    console.log(`
${chalk.bold('Listo.')} Archivos generados en: ${chalk.underline(session.profile.workspaceDir)}

  1. Abre la carpeta de la materia y revisa el documento ${chalk.cyan('Word (.docx)')} y la explicación en ${chalk.cyan('README.md')}  ${chalk.dim('(jash abrir <id>)')}
  2. Puedes editar el documento Word directamente o colocar tus archivos en la carpeta ${chalk.cyan('entrega/')}
  3. Cuando quieras subirlo a Moodle: ${chalk.cyan('jash entregar <id>')}
`);
  }
}

// ---------- abrir ----------

export async function abrir(id, gopts) {
  const session = await openSession({ profileName: gopts.perfil, needSecrets: false });
  const task = findTask(session.state, id);
  if (!task) throw new JashError(`No encontré la tarea ${id}.`);
  let dir = task.local?.dir;
  if (!dir || !fs.existsSync(dir)) {
    dir = await prepareTaskFolder(session.profile, task, null);
    task.local = { ...task.local, dir };
    session.saveState();
  }
  await openFolder(dir);
  ok(`Abriendo ${chalk.underline(dir)}`);
}

// ---------- entregar ----------

export async function entregar(id, opts, gopts) {
  const session = await openSession({ profileName: gopts.perfil });
  const task = findTask(session.state, id);
  if (!task) throw new JashError(`No encontré la tarea ${id}.`, { hint: 'Revisa `jash tareas`.' });

  const plan = planSubmission(task);
  const now = Date.now() / 1000;

  console.log(`
${chalk.bold.hex('#38bdf8')('Vista previa de la entrega')}
  ${chalk.dim('Tarea:  ')} ${chalk.bold(task.name)}
  ${chalk.dim('Materia:')} ${task.courseName}
  ${chalk.dim('Entrega:')} ${formatDate(task.duedate)} ${urgencyColor(task.duedate)(`(${relative(task.duedate)})`)}
  ${chalk.dim('Enlace: ')} ${chalk.underline(task.url)}
`);
  if (plan.files.length) {
    console.log(chalk.bold('  Archivos que se subirán:'));
    for (const f of plan.files) console.log(`   📎 ${f.name} ${chalk.dim(`(${(f.size / 1024).toFixed(1)} KB)`)}`);
  }
  if (plan.text) {
    console.log(chalk.bold(`  Texto en línea ${chalk.dim(`(desde ${path.basename(plan.textSource)})`)}:`));
    const lines = plan.text.split('\n');
    console.log(chalk.gray(lines.slice(0, 18).map((l) => `   │ ${l}`).join('\n')));
    if (lines.length > 18) console.log(chalk.dim(`   │ … (${lines.length - 18} líneas más)`));
  }
  console.log();

  if (task.cutoffdate && task.cutoffdate < now) warn('La fecha de cierre ya pasó; Moodle probablemente rechazará la entrega.');
  if (task.moodleStatus === 'submitted') warn('Moodle ya la marca como entregada; esto la reemplazará si el profesor lo permite.');
  if (fs.existsSync(path.join(plan.dir, 'notas.md'))) {
    warn(`Revisa ${chalk.cyan('notas.md')}: tiene supuestos y puntos a verificar antes de entregar.`);
  }

  const approved = await confirm({ message: '¿Revisaste el contenido y apruebas subirlo a Moodle?', default: false });
  if (!approved) return info('Cancelado. No se subió nada.');

  let final = Boolean(opts.final);
  if (final) {
    final = await confirm({
      message: 'Enviar para calificar es DEFINITIVO (ya no podrás editarla). ¿Continuar?',
      default: false,
    });
  }

  const client = clientFromSession(session);
  const sp = ora({ text: 'Subiendo…', color: 'magenta' }).start();
  try {
    await submitPlan(session, client, task, plan, { final, onProgress: (t) => (sp.text = t) });
    sp.succeed(final ? 'Entrega enviada para calificar.' : 'Entrega guardada en Moodle.');
  } catch (err) {
    sp.fail('La entrega falló');
    throw err;
  }
  if (!final) {
    console.log(
      chalk.dim(
        '  Si tu curso exige pulsar "Enviar tarea", quedó como borrador en Moodle. Usa --final o envíala desde la web.',
      ),
    );
  }
  console.log(`  Compruébalo aquí: ${chalk.underline(task.url)}`);
}
