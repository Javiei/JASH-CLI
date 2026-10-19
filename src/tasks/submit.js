import fs from 'node:fs';
import path from 'node:path';
import { marked } from 'marked';
import { JashError } from '../core/errors.js';

const MAX_FILE_MB = 50;

function listEntregaFiles(dir) {
  const folder = path.join(dir, 'entrega');
  if (!fs.existsSync(folder)) return [];
  return fs
    .readdirSync(folder)
    .filter((f) => !f.startsWith('.') && !f.startsWith('~$') && fs.statSync(path.join(folder, f)).isFile())
    .map((f) => ({ name: f, path: path.join(folder, f), size: fs.statSync(path.join(folder, f)).size }));
}

/**
 * Decide QUÉ se va a subir, sin subir nada todavía (para mostrar la vista previa y pedir aprobación).
 *  - Archivos: todo lo que haya en entrega/ (si la tarea acepta archivos).
 *  - Texto en línea: entrega/texto.md si existe; si no, borrador.md (cuando no hay archivos o la tarea solo acepta texto).
 */
export function planSubmission(task) {
  const dir = task.local?.dir;
  if (!dir || !fs.existsSync(dir)) {
    throw new JashError('Esta tarea no tiene carpeta todavía.', { hint: `Genera un borrador con \`jash borrador ${task.id}\`.` });
  }
  const types = task.submissionTypes || [];
  const acceptsFiles = types.includes('file');
  const acceptsText = types.includes('onlinetext');

  const files = acceptsFiles ? listEntregaFiles(dir).filter((f) => f.name !== 'texto.md') : [];
  for (const f of files) {
    if (f.size > MAX_FILE_MB * 1024 * 1024) throw new JashError(`"${f.name}" supera ${MAX_FILE_MB} MB.`);
  }

  let textSource = null;
  if (acceptsText) {
    const custom = path.join(dir, 'entrega', 'texto.md');
    const draft = path.join(dir, 'borrador.md');
    const readme = path.join(dir, 'README.md');
    if (fs.existsSync(custom)) textSource = custom;
    else if (!files.length && fs.existsSync(draft)) textSource = draft;
    else if (!files.length && fs.existsSync(readme)) textSource = readme;
  }

  if (!files.length && !textSource) {
    if (acceptsFiles && !acceptsText) {
      throw new JashError('Esta tarea solo acepta archivos y la carpeta entrega/ está vacía.', {
        hint: `Exporta tu trabajo final (PDF, DOCX…) a: ${path.join(dir, 'entrega')}`,
      });
    }
    if (!acceptsFiles && !acceptsText) {
      throw new JashError('Esta tarea no admite entregas en línea (puede ser presencial o en papel).');
    }
    throw new JashError('No hay nada que entregar todavía.', { hint: `Genera un borrador con \`jash borrador ${task.id}\`.` });
  }

  const text = textSource ? fs.readFileSync(textSource, 'utf8') : null;
  return { dir, files, textSource, text };
}

/** Sube la entrega aprobada a Moodle. Si `final` es true además la envía para calificar (no se puede deshacer). */
export async function submitPlan(session, client, task, plan, { final = false, onProgress = () => {} } = {}) {
  const plugindata = {};

  if (plan.files.length) {
    onProgress(`Subiendo ${plan.files.length} archivo(s)…`);
    plugindata.files_filemanager = await client.uploadDraftFiles(
      plan.files.map((f) => ({ name: f.name, buffer: fs.readFileSync(f.path) })),
    );
  }
  if (plan.text) {
    plugindata.onlinetext_editor = { text: await marked.parse(plan.text), format: 1, itemid: 0 };
  }

  onProgress('Guardando entrega en Moodle…');
  const warnings = await client.saveSubmission(task.id, plugindata);
  if (Array.isArray(warnings) && warnings.length) {
    throw new JashError(`Moodle no aceptó la entrega: ${warnings.map((w) => w.message).join('; ')}`);
  }

  if (final) {
    onProgress('Enviando para calificar…');
    const w2 = await client.submitForGrading(task.id);
    if (Array.isArray(w2) && w2.length) {
      throw new JashError(`Se guardó, pero no se pudo enviar para calificar: ${w2.map((w) => w.message).join('; ')}`);
    }
  }

  task.local = { ...task.local, state: 'entregado', submittedAt: new Date().toISOString(), final };
  task.moodleStatus = final ? 'submitted' : task.moodleStatus === 'new' ? 'draft' : task.moodleStatus;
  session.state.tasks[task.id] = task;
  session.saveState();
}
