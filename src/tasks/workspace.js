import fs from 'node:fs';
import path from 'node:path';
import { formatDate } from '../ui/format.js';

/** Semana ISO (lunes a domingo). */
export function isoWeek(date) {
  const t = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return { year: t.getUTCFullYear(), week: Math.ceil(((t - yearStart) / 864e5 + 1) / 7) };
}

export function weekLabel(ts) {
  const { year, week } = isoWeek(ts ? new Date(ts * 1000) : new Date());
  return `${year}-S${String(week).padStart(2, '0')}`;
}

/** Nombre seguro para carpetas en Windows/macOS/Linux. */
export function safeName(s, max = 60) {
  const clean = String(s)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .replace(/[. ]+$/, '');
  return clean || 'tarea';
}

export function taskDir(profile, task) {
  return path.join(
    profile.workspaceDir,
    safeName(task.course, 40),
    safeName(task.name),
  );
}

const TEXT_EXT = new Set(['.txt', '.md', '.csv', '.json', '.html', '.htm']);

/** Lee el contenido de adjuntos de texto plano para dárselo a la IA (máx. ~20k caracteres). */
export function readTextAttachments(dir, maxChars = 20000) {
  const folder = path.join(dir, 'adjuntos');
  if (!fs.existsSync(folder)) return '';
  let out = '';
  for (const f of fs.readdirSync(folder)) {
    if (!TEXT_EXT.has(path.extname(f).toLowerCase())) continue;
    const content = fs.readFileSync(path.join(folder, f), 'utf8');
    out += `\n### ${f}\n${content}\n`;
    if (out.length > maxChars) return `${out.slice(0, maxChars)}\n…(recortado)`;
  }
  return out.trim();
}

/**
 * Crea la carpeta de la tarea con su explicación README.md y adjuntos:
 *   Matemáticas/Guía 3/
 *     ├─ README.md       (explicación de la tarea)
 *     ├─ adjuntos/       (archivos del profesor)
 *     ├─ entrega/        (archivos finales que se subirán)
 *     └─ meta.json
 */
export async function prepareTaskFolder(profile, task, client, { onProgress = () => {} } = {}) {
  const dir = task.local?.dir && fs.existsSync(task.local.dir) ? task.local.dir : taskDir(profile, task);
  fs.mkdirSync(path.join(dir, 'adjuntos'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'entrega'), { recursive: true });

  const md = [
    `# ${task.name}`,
    '',
    `- **Materia:** ${task.courseName || task.course}`,
    `- **Fecha de entrega:** ${formatDate(task.duedate)}`,
    task.cutoffdate ? `- **Fecha límite de cierre:** ${formatDate(task.cutoffdate)}` : null,
    `- **Tipo de entrega en Moodle:** ${task.submissionTypes.join(', ') || '—'}`,
    `- **Enlace directo a Moodle:** ${task.url}`,
    '',
    '---',
    '',
    '## 📋 Enunciado de la Tarea',
    '',
    task.intro || '_Sin enunciado escrito por el profesor._',
    '',
    task.attachments.length ? '## 📎 Adjuntos del Profesor\n\n' + task.attachments.map((a) => `- [${a.filename}](adjuntos/${safeName(a.filename, 120)})`).join('\n') : null,
  ]
    .filter((l) => l !== null)
    .join('\n');
  fs.writeFileSync(path.join(dir, 'README.md'), md, 'utf8');

  if (client) {
    for (const a of task.attachments) {
      const target = path.join(dir, 'adjuntos', safeName(a.filename, 120));
      if (fs.existsSync(target)) continue;
      try {
        onProgress(`Descargando ${a.filename}…`);
        fs.writeFileSync(target, await client.downloadFile(a.fileurl));
      } catch {
        /* si un adjunto falla seguimos con el resto */
      }
    }
  }

  fs.writeFileSync(
    path.join(dir, 'meta.json'),
    JSON.stringify({ id: task.id, cmid: task.cmid, course: task.course, name: task.name, url: task.url }, null, 2),
  );
  return dir;
}

/** Abre una carpeta en el explorador de archivos del sistema. */
export async function openFolder(dir) {
  const { spawn } = await import('node:child_process');
  const cmd = process.platform === 'win32' ? 'explorer' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  spawn(cmd, [dir], { detached: true, stdio: 'ignore' }).unref();
}
