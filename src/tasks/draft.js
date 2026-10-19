import fs from 'node:fs';
import path from 'node:path';
import { DRAFT_SYSTEM, NOTES_HEADING, draftUserPrompt } from '../ai/prompts.js';
import { prepareTaskFolder, readTextAttachments, safeName } from './workspace.js';
import { createDocxBuffer } from './docx.js';

/** Separa el borrador de la sección de notas privadas para el estudiante. */
export function splitDraft(text) {
  const idx = text.indexOf(NOTES_HEADING);
  if (idx === -1) return { draft: text.trim(), notes: '' };
  return { draft: text.slice(0, idx).trim(), notes: text.slice(idx).trim() };
}

/**
 * Genera el borrador de una tarea con la IA y lo guarda en su carpeta:
 *   <Materia>/<Tarea>/
 *     ├─ README.md                -> Explicación completa del enunciado y resolución
 *     ├─ [Nombre de Tarea].docx   -> Documento Word listo para entregar o editar
 *     ├─ adjuntos/                -> Material que dejó el profesor
 *     └─ entrega/                 -> Archivos finales para subir a Moodle
 */
export async function generateDraft(session, ai, client, task, { instructions = '', onProgress = () => {} } = {}) {
  onProgress('Preparando carpeta de la materia…');
  const dir = await prepareTaskFolder(session.profile, task, client, { onProgress });
  const attachmentsText = readTextAttachments(dir);

  onProgress(`Redactando con ${ai.label}…`);
  const raw = await ai.chat([{ role: 'user', content: draftUserPrompt(task, { attachmentsText, instructions }) }], {
    system: DRAFT_SYSTEM,
  });
  const { draft, notes } = splitDraft(raw);

  // Generar documento Word (.docx)
  onProgress('Generando documento de Word (.docx)…');
  const docxBuffer = await createDocxBuffer({
    title: task.name,
    course: task.courseName || task.course,
    author: session.state.site?.fullname || session.profile.moodle?.fullname || session.profile.name,
    institution: session.state.site?.name || session.profile.moodle?.sitename || '',
    content: draft,
  });

  const docxFileName = `${safeName(task.name)}.docx`;
  const docxPath = path.join(dir, docxFileName);
  fs.writeFileSync(docxPath, docxBuffer);

  // Guardar copia lista en entrega/ para envíos a Moodle
  const entregaDocx = path.join(dir, 'entrega', docxFileName);
  fs.writeFileSync(entregaDocx, docxBuffer);

  // Si Moodle acepta texto en línea, guardamos texto.md en entrega/
  if (task.submissionTypes?.includes('onlinetext')) {
    fs.writeFileSync(path.join(dir, 'entrega', 'texto.md'), draft + '\n', 'utf8');
  }

  // Actualizar o crear README.md con la explicación detallada
  const readmePath = path.join(dir, 'README.md');
  const baseReadme = fs.existsSync(readmePath) ? fs.readFileSync(readmePath, 'utf8') : `# ${task.name}\n`;

  const explanation = [
    '',
    '---',
    '',
    '## 💡 Explicación y Resolución de la Tarea',
    '',
    `📄 **Documento de Word generado:** [\`${docxFileName}\`](./${encodeURIComponent(docxFileName)})`,
    '',
    '### Resumen del contenido:',
    '',
    draft,
    '',
    notes
      ? `### 📝 Notas y Sugerencias para el Estudiante:\n\n${notes.replace(/^##\s+Notas[^\n]*\n+/i, '')}`
      : null,
    '',
    '---',
    '_Tip: Puedes abrir el documento `.docx` en Microsoft Word o Google Docs para darle tu toque personal antes de entregar._',
    '',
  ]
    .filter((l) => l !== null)
    .join('\n');

  fs.writeFileSync(readmePath, baseReadme.split('\n---\n## 💡 Explicación')[0].trimEnd() + '\n' + explanation, 'utf8');

  task.local = {
    ...task.local,
    state: 'borrador',
    dir,
    docxFile: docxPath,
    draftAt: new Date().toISOString(),
    model: ai.label,
  };
  session.state.tasks[task.id] = task;
  session.saveState();

  return { dir, draftFile: docxPath, docxFile: docxPath, hasNotes: Boolean(notes) };
}

/**
 * Elimina el borrador de una tarea y la devuelve al estado 'pendiente'.
 * Borra el archivo .docx de la carpeta y de entrega/, y limpia la sección generada en README.md.
 */
export async function deleteDraft(session, task) {
  const dir = task.local?.dir;
  if (dir && fs.existsSync(dir)) {
    // 1. Eliminar archivo .docx específico si existe
    if (task.local?.docxFile && fs.existsSync(task.local.docxFile)) {
      try {
        fs.unlinkSync(task.local.docxFile);
      } catch {
        /* ignorar */
      }
    }

    // 2. Eliminar cualquier .docx o borrador.md en la carpeta raíz de la tarea
    try {
      const files = fs.readdirSync(dir);
      for (const f of files) {
        if (f.endsWith('.docx') || f.startsWith('borrador.') || f === 'borrador.md') {
          try {
            fs.unlinkSync(path.join(dir, f));
          } catch {
            /* ignorar */
          }
        }
      }
    } catch {
      /* ignorar */
    }

    // 3. Eliminar archivos de entrega generados
    const entregaDir = path.join(dir, 'entrega');
    if (fs.existsSync(entregaDir)) {
      try {
        const files = fs.readdirSync(entregaDir);
        for (const f of files) {
          if (f.endsWith('.docx') || f === 'texto.md') {
            try {
              fs.unlinkSync(path.join(entregaDir, f));
            } catch {
              /* ignorar */
            }
          }
        }
      } catch {
        /* ignorar */
      }
    }

    // 4. Limpiar la sección de explicación del README.md si existe
    const readmePath = path.join(dir, 'README.md');
    if (fs.existsSync(readmePath)) {
      try {
        const content = fs.readFileSync(readmePath, 'utf8');
        const cleanContent = content.split('\n---\n## 💡 Explicación')[0].trimEnd() + '\n';
        fs.writeFileSync(readmePath, cleanContent, 'utf8');
      } catch {
        /* ignorar */
      }
    }
  }

  // Actualizar estado local a pendiente
  task.local = {
    ...task.local,
    state: 'pendiente',
  };
  delete task.local.docxFile;
  delete task.local.draftAt;
  delete task.local.model;

  session.state.tasks[task.id] = task;
  session.saveState();
  return true;
}

