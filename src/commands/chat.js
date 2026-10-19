import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import chalk from 'chalk';
import ora from 'ora';
import { openSession } from '../core/session.js';
import { clientFromSession } from '../moodle/client.js';
import { aiFromSession } from '../ai/providers.js';
import { chatSystem } from '../ai/prompts.js';
import { upcoming, overdueTasks, findTask, sortedTasks, isPending } from '../tasks/sync.js';
import { generateDraft, deleteDraft } from '../tasks/draft.js';
import { chatHud, animateLines, streamMarkdown, mascotArt } from '../ui/format.js';
import { printTasks, runSync, ponerseAlDia, subirBorradores } from './tasks.js';

const HELP = `
  ${chalk.cyan('/tareas')}                   muestra la tabla de todas tus tareas pendientes
  ${chalk.cyan('/al-dia')}                   genera borradores de TODAS las tareas pendientes
  ${chalk.cyan('/subir')}                    sube todos los borradores listos a Moodle
  ${chalk.cyan('/tarea <id>')}               pone el enunciado de una tarea en contexto
  ${chalk.cyan('/borrador <id> [texto]')}    genera/rehace el borrador en Word (.docx)
  ${chalk.cyan('/eliminar <id>')}            elimina el borrador y desmarca la tarea
  ${chalk.cyan('/mascota')}                  muestra el dot art de la mascota de Jash
  ${chalk.cyan('/sync')}                     sincroniza las tareas con Moodle
  ${chalk.cyan('/limpiar')}                  reinicia la memoria de la conversación
  ${chalk.cyan('/salir')}                    cierra la sesión
`;

/** Render enriquecido de Markdown estilo Claude Code / OpenCode para la terminal. */
function renderMd(text) {
  let md = text;

  // Formato de bloques de código ```lang ... ```
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

  // Resaltado de Respuestas / Soluciones
  md = md.replace(/(\b(?:Respuesta|Solución|Rpta):\s*)(.*)/gi, (_, label, rest) => {
    return chalk.hex('#38bdf8').bold.underline(label) + chalk.hex('#f1f5f9')(rest);
  });

  // Código en línea
  md = md.replace(/`([^`\n]+)`/g, (_, t) => chalk.hex('#38bdf8').bgHex('#0f172a')(` ${t} `));

  // Listas con viñetas elegantes
  md = md.replace(/^(\s*)[-*]\s+(.*)$/gm, (_, sp, t) => `  ${sp}${chalk.hex('#38bdf8')('•')} ${t}`);
  md = md.replace(/^(\s*)(\d+)\.\s+(.*)$/gm, (_, sp, n, t) => `  ${sp}${chalk.hex('#60a5fa')(n + '.')} ${t}`);

  // Citas / Callouts
  md = md.replace(/^>\s+(.*)$/gm, (_, t) => `  ${chalk.hex('#0ea5e9')('│')} ${chalk.italic.dim(t)}`);

  // Líneas de texto general indentadas suavemente
  return md
    .split('\n')
    .map((line) => (line.startsWith('  ') ? line : `  ${line}`))
    .join('\n');
}

export async function chat(gopts) {
  // Cambiar el título de la ventana de la terminal
  try {
    stdout.write('\x1b]0;Jash · Asistente Académico\x07');
  } catch {
    /* ignorar si no se soporta */
  }

  const session = await openSession({ profileName: gopts.perfil });
  const ai = aiFromSession(session);
  let client = null;
  const getClient = () => (client ??= clientFromSession(session));

  // Sincronizar en silencio si no hay caché
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

  // Limpiar la pantalla para crear la atmósfera inmersiva
  console.clear();

  const overdue = overdueTasks(session.state);
  const weekTasks = upcoming(session.state, 7, { includeUndated: true });

  await animateLines(
    chatHud({
      user: session.state.site?.fullname || session.profile.moodle?.fullname || session.profile.name,
      site: session.state.site?.name || 'Moodle',
      model: ai.label,
      overdueCount: overdue.length,
      weekCount: weekTasks.length,
    }),
    { delay: 16 }
  );

  const divider = () => chalk.hex('#1e293b')('─'.repeat(Math.min(stdout.columns || 75, 75)));

  console.log(divider());
  console.log(
    chalk.dim('  Escribe con naturalidad (ej: "¿Qué tareas tengo para hoy?") o usa /ayuda')
  );
  console.log(divider());

  const rl = readline.createInterface({ input: stdin, output: stdout });
  rl.on('SIGINT', () => rl.close());
  let closed = false;
  rl.on('close', () => (closed = true));

  while (!closed) {
    let line;
    try {
      line = (await rl.question(`\n${chalk.hex('#38bdf8').bold('❯')} `)).trim();
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
          case 'clear':
            history = [];
            focus.length = 0;
            console.clear();
            await animateLines(
              chatHud({
                user: session.state.site?.fullname || session.profile.moodle?.fullname || session.profile.name,
                site: session.state.site?.name || 'Moodle',
                model: ai.label,
                overdueCount: overdueTasks(session.state).length,
                weekCount: upcoming(session.state, 7, { includeUndated: true }).length,
              }),
              { delay: 14 }
            );
            console.log(divider());
            console.log(chalk.dim('  Memoria reiniciada. Puedes empezar una nueva consulta.'));
            console.log(divider());
            break;
          case 'tareas':
            printTasks(sortedTasks(session.state).filter(isPending));
            break;
          case 'al-dia':
          case 'aldia':
            await ponerseAlDia({ indicaciones: [arg, ...rest].filter(Boolean).join(' ') }, gopts);
            break;
          case 'subir':
            await subirBorradores({}, gopts);
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
          case 'mascota':
            await animateLines(mascotArt(), { delay: 10 });
            break;
          case 'eliminar': {
            const t = findTask(session.state, arg);
            if (!t) {
              console.log(chalk.red(`  No encontré la tarea ${arg}.`));
              break;
            }
            await deleteDraft(session, t);
            console.log(chalk.green(`  ✔ Borrador de "${t.name}" eliminado. La tarea vuelve a estar marcada como pendiente.`));
            break;
          }
          case 'borrador': {
            if (arg === 'eliminar' || arg === 'borrar') {
              const taskId = rest[0];
              const t = findTask(session.state, taskId);
              if (!t) {
                console.log(chalk.red(`  No encontré la tarea ${taskId}.`));
                break;
              }
              await deleteDraft(session, t);
              console.log(chalk.green(`  ✔ Borrador de "${t.name}" eliminado. La tarea vuelve a estar marcada como pendiente.`));
              break;
            }
            const t = findTask(session.state, arg);
            if (!t) {
              console.log(chalk.red(`  No encontré la tarea ${arg}.`));
              break;
            }
            const sp = ora({ text: t.name, color: 'cyan' }).start();
            const r = await generateDraft(session, ai, getClient(), t, {
              instructions: rest.join(' '),
              onProgress: (m) => (sp.text = `${t.name} · ${chalk.dim(m)}`),
            });
            sp.succeed(`Documento Word (.docx) guardado en ${chalk.underline(r.draftFile)}`);
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

    const thinkPhrases = [
      'Jash está pensando…',
      'Analizando tus tareas académicas…',
      'Consultando el contexto de Moodle…',
      'Estructurando la respuesta ideal…',
    ];
    let phraseIdx = 0;
    const sp = ora({
      text: chalk.hex('#94a3b8')(thinkPhrases[0]),
      color: 'cyan',
      spinner: 'dots12',
      discardStdin: false,
    }).start();

    const phraseTimer = setInterval(() => {
      phraseIdx = (phraseIdx + 1) % thinkPhrases.length;
      sp.text = chalk.hex('#94a3b8')(thinkPhrases[phraseIdx]);
    }, 1600);

    try {
      const reply = await ai.chat(history.slice(-20), { system: system() });
      clearInterval(phraseTimer);
      sp.stop();
      history.push({ role: 'assistant', content: reply });

      console.log(`\n${chalk.hex('#38bdf8').bold('◈ Jash')}`);
      await streamMarkdown(renderMd(reply), { delay: 12 });
    } catch (err) {
      clearInterval(phraseTimer);
      sp.fail(err.message);
      history.pop();
    }
  }

  console.log(chalk.dim('\n  Sesión cerrada. ¡Hasta luego! 👋\n'));
}
