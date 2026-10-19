import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import chalk from 'chalk';
import ora from 'ora';
import { openSession } from '../core/session.js';
import { clientFromSession } from '../moodle/client.js';
import { aiFromSession } from '../ai/providers.js';
import { chatSystem } from '../ai/prompts.js';
import { upcoming, overdueTasks, findTask, sortedTasks, isPending } from '../tasks/sync.js';
import { generateDraft } from '../tasks/draft.js';
import { banner } from '../ui/format.js';
import { printTasks, runSync } from './tasks.js';

const HELP = `
  ${chalk.cyan('/tareas')}                   muestra la tabla de pendientes
  ${chalk.cyan('/tarea <id>')}               pone el enunciado de una tarea en contexto
  ${chalk.cyan('/borrador <id> [texto]')}    genera y guarda el borrador en su carpeta
  ${chalk.cyan('/sync')}                     sincroniza con Moodle
  ${chalk.cyan('/limpiar')}                  olvida la conversación
  ${chalk.cyan('/salir')}                    termina
`;

/** Render mínimo de Markdown para terminal (negritas, títulos, código, listas). */
function renderMd(text) {
  return text
    .replace(/^#{1,6}\s+(.*)$/gm, (_, t) => chalk.bold.hex('#38bdf8')(t))
    .replace(/\*\*(.+?)\*\*/g, (_, t) => chalk.bold(t))
    .replace(/`([^`\n]+)`/g, (_, t) => chalk.cyan(t))
    .replace(/^(\s*)[-*]\s+/gm, '$1• ');
}

export async function chat(gopts) {
  const session = await openSession({ profileName: gopts.perfil });
  const ai = aiFromSession(session);
  let client = null;
  const getClient = () => (client ??= clientFromSession(session));

  if (!session.state.lastSync || Object.keys(session.state.tasks || {}).length === 0) {
    if (session.secrets?.moodleToken) {
      try {
        await runSync(session, getClient());
      } catch {
        /* continua con la caché actual si no hay conexión */
      }
    }
  }

  const focus = [];
  let history = [];
  const system = () =>
    chatSystem({
      studentName: session.state.site?.fullname || session.profile.moodle?.fullname,
      siteName: session.state.site?.name,
      tasks: sortedTasks(session.state).filter(isPending),
      overdue: overdueTasks(session.state),
      upcoming: upcoming(session.state, 7, { includeUndated: true }),
      focus,
    });

  console.log(banner());
  console.log(chalk.dim(`  ${ai.label} · pregúntame lo que quieras de tus tareas y materias\n`));

  const over = overdueTasks(session.state);
  if (over.length) {
    console.log(chalk.red.bold(`  ⚠ Tienes ${over.length} tarea(s) vencida(s) sin entregar.`));
  }
  const soon = upcoming(session.state, 7, { includeUndated: true });
  if (soon.length) {
    console.log(chalk.cyan(`  Tienes ${soon.length} entrega(s) para esta semana / próximos días.\n`));
  }

  const rl = readline.createInterface({ input: stdin, output: stdout });
  rl.on('SIGINT', () => rl.close());
  let closed = false;
  rl.on('close', () => (closed = true));

  while (!closed) {
    let line;
    try {
      line = (await rl.question(chalk.hex('#22d3ee').bold('tú › '))).trim();
    } catch {
      break; // Ctrl+C / Ctrl+D
    }
    if (!line) continue;

    if (line.startsWith('/')) {
      const [cmd, arg, ...rest] = line.slice(1).split(/\s+/);
      try {
        switch (cmd) {
          case 'salir':
          case 'exit':
          case 'q':
            rl.close();
            continue;
          case 'ayuda':
          case 'help':
            console.log(HELP);
            break;
          case 'limpiar':
            history = [];
            focus.length = 0;
            console.log(chalk.dim('  Conversación reiniciada.'));
            break;
          case 'tareas':
            printTasks(sortedTasks(session.state).filter(isPending));
            break;
          case 'sync':
            await runSync(session, getClient());
            break;
          case 'tarea': {
            const t = findTask(session.state, arg);
            if (!t) console.log(chalk.red(`  No encontré la tarea ${arg}.`));
            else {
              if (!focus.includes(t)) focus.push(t);
              console.log(chalk.dim(`  📌 "${t.name}" en contexto. Pregúntame lo que quieras sobre ella.`));
            }
            break;
          }
          case 'borrador': {
            const t = findTask(session.state, arg);
            if (!t) {
              console.log(chalk.red(`  No encontré la tarea ${arg}.`));
              break;
            }
            const sp = ora({ text: t.name, color: 'magenta' }).start();
            const r = await generateDraft(session, ai, getClient(), t, {
              instructions: rest.join(' '),
              onProgress: (m) => (sp.text = `${t.name} · ${chalk.dim(m)}`),
            });
            sp.succeed(`Borrador guardado en ${chalk.underline(r.draftFile)}`);
            break;
          }
          default:
            console.log(chalk.red(`  Comando desconocido: /${cmd}`) + chalk.dim(' (usa /ayuda)'));
        }
      } catch (err) {
        console.log(chalk.red(`  ✖ ${err.message}`));
        if (err.hint) console.log(chalk.dim(`    ${err.hint}`));
      }
      continue;
    }

    history.push({ role: 'user', content: line });
    const sp = ora({ text: 'pensando…', color: 'magenta', discardStdin: false }).start();
    try {
      const reply = await ai.chat(history.slice(-20), { system: system() });
      sp.stop();
      history.push({ role: 'assistant', content: reply });
      console.log(`${chalk.hex('#38bdf8').bold('jash ›')} ${renderMd(reply)}\n`);
    } catch (err) {
      sp.fail(err.message);
      history.pop();
    }
  }
  console.log(chalk.dim('\n  ¡Hasta luego! 👋'));
}
