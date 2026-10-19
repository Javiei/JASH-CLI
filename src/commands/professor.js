import fs from 'node:fs';
import path from 'node:path';
import { select } from '@inquirer/prompts';
import chalk from 'chalk';
import ora from 'ora';
import { openSession } from '../core/session.js';
import { aiFromSession } from '../ai/providers.js';
import { activePendingTasks, findTask } from '../tasks/sync.js';
import { getTaskDraftContent } from '../tasks/draft.js';
import { readTextAttachments, prepareTaskFolder } from '../tasks/workspace.js';
import { clientFromSession } from '../moodle/client.js';
import {
  PROFESSOR_REVIEW_SYSTEM,
  professorReviewPrompt,
  PROFESSOR_EXPLAIN_SYSTEM,
  professorExplainPrompt,
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
 * Revisa una o todas las tareas comparando el borrador contra el mandato oficial del profesor.
 */
export async function revisarTareas(opts = {}, gopts = {}) {
  const session = await openSession({ profileName: gopts.perfil });
  const ai = aiFromSession(session);
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
    } catch (err) {
      sp.fail(`Error al revisar tarea: ${err.message}`);
    }
  }
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
    case 'explicar':
      await explicarTareas({}, gopts);
      break;
    case 'volver':
    default:
      break;
  }
}
