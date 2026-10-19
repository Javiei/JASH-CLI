import fs from 'node:fs';
import path from 'node:path';
import { DRAFT_SYSTEM, NOTES_HEADING, draftUserPrompt } from '../ai/prompts.js';
import { prepareTaskFolder, readTextAttachments } from './workspace.js';

/** Separa el borrador de la sección de notas privadas para el estudiante. */
export function splitDraft(text) {
  const idx = text.indexOf(NOTES_HEADING);
  if (idx === -1) return { draft: text.trim(), notes: '' };
  return { draft: text.slice(0, idx).trim(), notes: text.slice(idx).trim() };
}

/**
 * Genera el borrador de una tarea con la IA y lo guarda en su carpeta:
 *   borrador.md  -> el trabajo (lo que se entregaría tras tu revisión)
 *   notas.md     -> supuestos y puntos a revisar (nunca se sube)
 */
export async function generateDraft(session, ai, client, task, { instructions = '', onProgress = () => {} } = {}) {
  onProgress('Preparando carpeta…');
  const dir = await prepareTaskFolder(session.profile, task, client, { onProgress });
  const attachmentsText = readTextAttachments(dir);

  onProgress(`Redactando con ${ai.label}…`);
  const raw = await ai.chat([{ role: 'user', content: draftUserPrompt(task, { attachmentsText, instructions }) }], {
    system: DRAFT_SYSTEM,
  });
  const { draft, notes } = splitDraft(raw);

  const draftFile = path.join(dir, 'borrador.md');
  if (fs.existsSync(draftFile)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    fs.renameSync(draftFile, path.join(dir, `borrador.anterior-${stamp}.md`));
  }
  fs.writeFileSync(draftFile, draft + '\n', 'utf8');
  if (notes) fs.writeFileSync(path.join(dir, 'notas.md'), notes + '\n', 'utf8');

  task.local = { ...task.local, state: 'borrador', dir, draftAt: new Date().toISOString(), model: ai.label };
  session.state.tasks[task.id] = task;
  session.saveState();
  return { dir, draftFile, hasNotes: Boolean(notes) };
}
