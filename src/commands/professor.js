import fs from 'node:fs';
import path from 'node:path';
import { select, checkbox } from '@inquirer/prompts';
import chalk from 'chalk';
import ora from 'ora';
import { openSession } from '../core/session.js';
import { aiFromSession } from '../ai/providers.js';
import { activePendingTasks, findTask } from '../tasks/sync.js';
import { getTaskDraftContent, deleteDraft, generateDraft } from '../tasks/draft.js';
import { readTextAttachments, prepareTaskFolder } from '../tasks/workspace.js';
import { clientFromSession } from '../moodle/client.js';
import {
  PROFESSOR_REVIEW_SYSTEM,
  professorReviewPrompt,
  PROFESSOR_EXPLAIN_SYSTEM,
  professorExplainPrompt,
  evaluateProfessorReview,
} from '../ai/prompts.js';
import { streamMarkdown } from '../ui/format.js';

function renderMd(text) {
  let md = text;

  // Bloques de código
  md = md.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const header = chalk.hex('#0284c7')(`  ┌── ${lang || 'código'} `) + chalk.hex('#1e293b')('─'.repeat(45));
    const body = code
      .trimEnd()
      .split('\n')
      .map((l) => chalk.hex('#0284c7')('  │ ') + chalk.hex('#e2e8f0')(l))
      .join('\n');
    const footer = chalk.hex('#0284c7')('  └──') + chalk.hex('#1e293b')('─'.repeat(52));
    return `\n${header}\n${body}\n${footer}\n`;
  });

  // Títulos
  md = md.replace(/^### (.*)$/gm, (_, t) => `  ${chalk.hex('#67e8f9').bold('▸ ' + t)}`);
  md = md.replace(/^## (.*)$/gm, (_, t) => `\n  ${chalk.hex('#38bdf8').bold.underline(t)}`);
  md = md.replace(/^# (.*)$/gm, (_, t) => `\n  ${chalk.hex('#0ea5e9').bold.inverse(' ' + t + ' ')}`);

  // Negritas e itálicas
  md = md.replace(/\*\*(.+?)\*\*/g, (_, t) => chalk.bold.white(t));
  md = md.replace(/\*(.+?)\*/g, (_, t) => chalk.italic(t));

  // Estados y calificaciones destacadas
  md = md.replace(/(\[✔[^\]]+\])/g, (_, t) => chalk.bgHex('#166534').white.bold(` ${t} `));
  md = md.replace(/(\[⚠[^\]]+\])/g, (_, t) => chalk.bgHex('#854d0e').white.bold(` ${t} `));
  md = md.replace(/(\[❌[^\]]+\])/g, (_, t) => chalk.bgHex('#991b1b').white.bold(` ${t} `));

  // Listas con viñetas
  md = md.replace(/^(\s*)[-*]\s+(.*)$/gm, (_, sp, t) => `  ${sp}${chalk.hex('#38bdf8')('•')} ${t}`);
  md = md.replace(/^(\s*)(\d+)\.\s+(.*)$/gm, (_, sp, n, t) => `  ${sp}${chalk.hex('#60a5fa')(n + '.')} ${t}`);

  // Citas / Callouts
  md = md.replace(/^>\s+(.*)$/gm, (_, t) => `  ${chalk.hex('#0ea5e9')('│')} ${chalk.italic.dim(t)}`);

  return md
    .split('\n')
    .map((line) => (line.startsWith('  ') ? line : `  ${line}`))
    .join('\n');
}

/**
 * Elimina los borradores que no alcanzaron 100/100 y los vuelve a generar con IA
 * aplicando las recomendaciones y exigencias de la auditoría para asegurar un 100/100.
 */
export async function rehacerImperfectas(imperfectList, session, ai, client, gopts = {}) {
  if (!imperfectList.length) {
    console.log(chalk.green('\n  🎉 ¡No hay tareas imperfectas por rehacer!\n'));
    return;
  }

  console.log(chalk.hex('#f59e0b').bold('\n╔════════════════════════════════════════════════════════════════════════╗'));
  console.log(chalk.hex('#f59e0b').bold('║     🔄 PERFECCIONANDO TAREAS · ELIMINANDO Y REHACIENDO PARA 100/100    ║'));
  console.log(chalk.hex('#f59e0b').bold('╚════════════════════════════════════════════════════════════════════════╝\n'));

  for (const item of imperfectList) {
    const { task, review, score, feedback } = item;
    console.log(
      chalk.hex('#1e3a8a')('  ┌── ') +
      chalk.hex('#38bdf8').bold(`[ID: ${task.id}] ${task.course} — "${task.name}" `) +
      chalk.yellow(`(${item.sinBorrador ? 'Sin borrador previo' : 'Calificación previa: ' + score + '/100'})`)
    );

    // 1. Eliminar borrador anterior
    const spDel = ora({
      text: chalk.dim('Eliminando borrador anterior para comenzar desde cero…'),
      color: 'red',
    }).start();
    await deleteDraft(session, task);
    spDel.succeed(chalk.dim('Borrador anterior eliminado de la carpeta y del registro.'));

    // 2. Preparar instrucciones de perfeccionamiento
    const instructions = [
      'OBSERVACIONES Y EXIGENCIAS DE LA AUDITORÍA DOCENTE:',
      feedback || review || 'El borrador previo no alcanzó la nota perfecta.',
      '',
      'INSTRUCCIÓN CRÍTICA Y OBLIGATORIA:',
      '1. Desarrolla el trabajo respondiendo con rigor, exactitud y profundidad CADA punto y pregunta solicitada.',
      '2. Cumple estrictamente todos los requisitos y correcciones señaladas arriba.',
      '3. Asegúrate de que el documento esté 100% completo e impecable para obtener una calificación de 100/100.',
    ].join('\n');

    // 3. Generar borrador nuevo con IA
    const spGen = ora({
      text: chalk.hex('#38bdf8')('Redactando nuevo borrador perfecto con IA…'),
      color: 'cyan',
    }).start();

    try {
      const res = await generateDraft(session, ai, client, task, {
        instructions,
        onProgress: (msg) => {
          spGen.text = chalk.hex('#38bdf8')(`Redactando nuevo borrador · ${chalk.dim(msg)}`);
        },
      });

      spGen.succeed(
        chalk.green.bold('✔ Tarea perfeccionada y generada para 100/100: ') +
        chalk.underline(path.relative(session.profile.workspaceDir, res.dir || ''))
      );
    } catch (err) {
      spGen.fail(chalk.red(`Error al regenerar tarea: ${err.message}`));
    }

    console.log(chalk.hex('#1e3a8a')('  └──') + chalk.hex('#1e293b')('─'.repeat(55)) + '\n');
  }

  console.log(
    chalk.green.bold(`  🎉 ¡Completado! Se eliminaron los borradores anteriores y se rehicieron ${imperfectList.length} tareas para obtener 100/100.\n`)
  );
}

/**
 * Revisa una o todas las tareas comparando el borrador contra el mandato oficial del profesor.
 */
export async function revisarTareas(opts = {}, gopts = {}) {
  const session = await openSession({ profileName: gopts.perfil });
  const ai = aiFromSession(session);
  let client = null;
  try {
    client = clientFromSession(session);
  } catch {
    /* Moodle client opcional si no hay credenciales o está offline */
  }
  const pending = activePendingTasks(session.state);

  if (!pending.length) {
    console.log(chalk.green('\n  ✔ ¡Todo al día! No tienes tareas pendientes para revisar. 🎉\n'));
    return;
  }

  let targets = [];
  if (opts.id) {
    const t = findTask(session.state, opts.id);
    if (!t) {
      console.log(chalk.red(`\n  ✖ No se encontró la tarea con ID o nombre: "${opts.id}"\n`));
      return;
    }
    targets = [t];
  } else {
    targets = pending;
  }

  console.log(chalk.hex('#38bdf8').bold('\n╔════════════════════════════════════════════════════════════════════════╗'));
  console.log(chalk.hex('#38bdf8').bold('║         👨‍🏫 AUDITORÍA DOCENTE · REVISIÓN CONTRA EL MANDATO             ║'));
  console.log(chalk.hex('#38bdf8').bold('╚════════════════════════════════════════════════════════════════════════╝\n'));

  const auditedResults = [];

  for (const t of targets) {
    const dir = t.local?.dir;
    const attachmentsText = dir ? readTextAttachments(dir) : '';
    const draftContent = getTaskDraftContent(t);

    console.log(chalk.hex('#1e3a8a')('  ┌── ') + chalk.hex('#38bdf8').bold(`[ID: ${t.id}] ${t.course} — "${t.name}"`));

    if (!draftContent) {
      console.log(chalk.hex('#1e3a8a')('  │ ') + chalk.yellow.bold('⚠ Estado: SIN BORRADOR GENERADO'));
      console.log(chalk.hex('#1e3a8a')('  │ ') + chalk.dim('No hay un borrador guardado en la carpeta de esta tarea.'));
      console.log(chalk.hex('#1e3a8a')('  │ ') + chalk.dim(`Mandato del profesor: ${t.intro ? t.intro.slice(0, 120) + '…' : '(Sin enunciado escrito)'}`));
      console.log(chalk.hex('#1e3a8a')('  │ ') + chalk.cyan(`Genera el borrador primero ejecutando: jash borrador ${t.id}`));
      console.log(chalk.hex('#1e3a8a')('  └──') + chalk.hex('#1e293b')('─'.repeat(55)) + '\n');
      auditedResults.push({
        task: t,
        review: null,
        is100: false,
        score: 0,
        feedback: 'No tiene borrador previo. Se requiere resolver completamente el mandato.',
        sinBorrador: true,
      });
      continue;
    }

    const sp = ora({
      text: chalk.dim(`El profesor está auditando el borrador contra el mandato…`),
      color: 'cyan',
    }).start();

    try {
      const prompt = professorReviewPrompt(t, {
        mandato: t.intro,
        draft: draftContent,
        attachmentsText,
      });

      const review = await ai.chat([{ role: 'user', content: prompt }], {
        system: PROFESSOR_REVIEW_SYSTEM,
      });

      sp.stop();
      console.log(chalk.hex('#1e3a8a')('  │'));
      await streamMarkdown(renderMd(review), { delay: 6 });
      console.log(chalk.hex('#1e3a8a')('  └──') + chalk.hex('#1e293b')('─'.repeat(55)) + '\n');

      const evaluation = evaluateProfessorReview(review);
      auditedResults.push({
        task: t,
        review,
        is100: evaluation.is100,
        score: evaluation.score,
        feedback: evaluation.feedback,
        status: evaluation.status,
      });
    } catch (err) {
      sp.fail(`Error al revisar tarea: ${err.message}`);
    }
  }

  // Resumen y opción de rehacer las que no tienen 100/100
  const imperfect = auditedResults.filter((r) => !r.is100);
  const perfect = auditedResults.filter((r) => r.is100);

  if (opts.rehacer || opts.perfeccionar) {
    if (imperfect.length) {
      await rehacerImperfectas(imperfect, session, ai, client, gopts);
    } else {
      console.log(chalk.green.bold('  🎉 ¡Todas las tareas auditadas ya están 100/100! No es necesario rehacer nada.\n'));
    }
    return;
  }

  if (!imperfect.length) {
    console.log(chalk.green.bold('\n  🎉 ¡EXCELENTE! Todas las tareas revisadas cumplen el 100/100 al pie de la letra. ✨\n'));
    return;
  }

  console.log(chalk.hex('#f59e0b').bold('╔════════════════════════════════════════════════════════════════════════╗'));
  console.log(chalk.hex('#f59e0b').bold('║                  📊 RESUMEN DE LA AUDITORÍA DOCENTE                    ║'));
  console.log(chalk.hex('#f59e0b').bold('╚════════════════════════════════════════════════════════════════════════╝\n'));
  console.log(chalk.green(`  ✔ Tareas con 100/100 perfecto: ${perfect.length}`));
  console.log(chalk.hex('#f59e0b')(`  ⚠ Tareas que NO están 100/100: ${imperfect.length}`));
  for (const item of imperfect) {
    const scoreLabel = item.sinBorrador ? chalk.yellow('Sin borrador') : chalk.red(`${item.score}/100`);
    console.log(chalk.dim(`    • [ID: ${item.task.id}] `) + chalk.white(`${item.task.course} — "${item.task.name}" `) + chalk.dim(`(`) + scoreLabel + chalk.dim(`)`));
  }
  console.log();

  if (process.stdout.isTTY) {
    const action = await select({
      message: chalk.hex('#f59e0b').bold(`¿Qué deseas hacer con las ${imperfect.length} tareas que no están 100/100?`),
      choices: [
        {
          name: `🔄  Eliminar y rehacer con IA las que no tienen 100/100 (${imperfect.length} tareas)`,
          value: 'rehacer-todas',
        },
        {
          name: '✏️   Elegir manualmente cuáles eliminar y rehacer',
          value: 'elegir',
        },
        {
          name: '🚪  Mantener borradores actuales sin cambios',
          value: 'mantener',
        },
      ],
    });

    if (action === 'rehacer-todas') {
      await rehacerImperfectas(imperfect, session, ai, client, gopts);
    } else if (action === 'elegir') {
      const selectedIds = await checkbox({
        message: 'Selecciona las tareas que deseas eliminar y rehacer con IA para sacar 100/100:',
        choices: imperfect.map((item) => ({
          name: `[ID: ${item.task.id}] ${item.task.course} — "${item.task.name}" (${item.sinBorrador ? 'Sin borrador' : item.score + '/100'})`,
          value: item.task.id,
          checked: true,
        })),
      });

      const filtered = imperfect.filter((item) => selectedIds.includes(item.task.id));
      if (filtered.length) {
        await rehacerImperfectas(filtered, session, ai, client, gopts);
      } else {
        console.log(chalk.dim('\n  No se seleccionó ninguna tarea para rehacer.\n'));
      }
    }
  }
}

/**
 * Revisa y directamente elimina y rehace cualquier tarea pendiente que no tenga 100/100.
 */
export async function perfeccionarTareas(opts = {}, gopts = {}) {
  return await revisarTareas({ ...opts, rehacer: true }, gopts);
}

/**
 * Explica pedagógicamente una o todas las tareas desglosando el mandato en pasos sencillos.
 */
export async function explicarTareas(opts = {}, gopts = {}) {
  const session = await openSession({ profileName: gopts.perfil });
  const ai = aiFromSession(session);
  const pending = activePendingTasks(session.state);

  if (!pending.length) {
    console.log(chalk.green('\n  ✔ ¡Todo al día! No tienes tareas pendientes que explicar. 🎉\n'));
    return;
  }

  let targets = [];
  if (opts.id) {
    const t = findTask(session.state, opts.id);
    if (!t) {
      console.log(chalk.red(`\n  ✖ No se encontró la tarea con ID o nombre: "${opts.id}"\n`));
      return;
    }
    targets = [t];
  } else if (process.stdout.isTTY && !opts.todas) {
    const choices = [
      { name: `🌟  Explicar TODAS las tareas pendientes (${pending.length})`, value: 'todas' },
      ...pending.map((t) => ({
        name: `📚  [ID: ${t.id}] ${t.course} — ${t.name}`,
        value: t.id,
      })),
    ];

    const pick = await select({
      message: chalk.hex('#38bdf8').bold('¿Qué tarea deseas que te explique el profesor?'),
      choices,
    });

    if (pick === 'todas') {
      targets = pending;
    } else {
      targets = [pending.find((t) => String(t.id) === String(pick))];
    }
  } else {
    targets = pending;
  }

  console.log(chalk.hex('#38bdf8').bold('\n╔════════════════════════════════════════════════════════════════════════╗'));
  console.log(chalk.hex('#38bdf8').bold('║         💡 TUTORÍA DOCENTE · EXPLICACIÓN PASO A PASO DEL MANDATO       ║'));
  console.log(chalk.hex('#38bdf8').bold('╚════════════════════════════════════════════════════════════════════════╝\n'));

  for (const t of targets) {
    const dir = t.local?.dir;
    let attachmentsText = dir ? readTextAttachments(dir) : '';

    if (!dir && t.attachments?.length && session.secrets?.moodleToken) {
      try {
        const client = clientFromSession(session);
        const prepared = await prepareTaskFolder(session.profile, t, client);
        attachmentsText = readTextAttachments(prepared);
      } catch {
        /* continua si no se pudieron descargar */
      }
    }

    console.log(chalk.hex('#1e3a8a')('  ┌── ') + chalk.hex('#38bdf8').bold(`[ID: ${t.id}] ${t.course} — "${t.name}"`));

    const sp = ora({
      text: chalk.dim(`El profesor está preparando la explicación didáctica…`),
      color: 'cyan',
    }).start();

    try {
      const prompt = professorExplainPrompt(t, { attachmentsText });
      const explanation = await ai.chat([{ role: 'user', content: prompt }], {
        system: PROFESSOR_EXPLAIN_SYSTEM,
      });

      sp.stop();
      console.log(chalk.hex('#1e3a8a')('  │'));
      await streamMarkdown(renderMd(explanation), { delay: 6 });
      console.log(chalk.hex('#1e3a8a')('  └──') + chalk.hex('#1e293b')('─'.repeat(55)) + '\n');
    } catch (err) {
      sp.fail(`Error al explicar tarea: ${err.message}`);
    }
  }
}

/**
 * Menú interactivo del Apartado de Profesor.
 */
export async function menuProfesor(gopts = {}) {
  console.log();
  const choice = await select({
    message: chalk.hex('#38bdf8').bold('👨‍🏫 Apartado de Profesor · ¿Qué deseas hacer?'),
    choices: [
      {
        name: '🔍  Revisar tareas (Comparar borradores con el mandato y evaluar si están bien)',
        value: 'revisar',
      },
      {
        name: '🔄  Perfeccionar tareas (Eliminar y rehacer de nuevo las que no estén 100/100)',
        value: 'perfeccionar',
      },
      {
        name: '💡  Explicar tareas (Explicación paso a paso de qué pide cada tarea)',
        value: 'explicar',
      },
      {
        name: '⬅️   Volver al menú principal',
        value: 'volver',
      },
    ],
  });

  switch (choice) {
    case 'revisar':
      await revisarTareas({}, gopts);
      break;
    case 'perfeccionar':
      await perfeccionarTareas({}, gopts);
      break;
    case 'explicar':
      await explicarTareas({}, gopts);
      break;
    case 'volver':
    default:
      break;
  }
}
