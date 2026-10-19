import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { flattenParams, normalizeUrl } from '../src/moodle/client.js';
import { htmlToText } from '../src/moodle/html.js';
import { splitDraft } from '../src/tasks/draft.js';
import { isoWeek, safeName } from '../src/tasks/workspace.js';
import { createAI } from '../src/ai/providers.js';

test('flattenParams genera el formato anidado de Moodle', () => {
  const p = flattenParams({ courseids: [3, 5], plugindata: { onlinetext_editor: { text: 'hola', format: 1 } } });
  assert.equal(p.get('courseids[0]'), '3');
  assert.equal(p.get('courseids[1]'), '5');
  assert.equal(p.get('plugindata[onlinetext_editor][text]'), 'hola');
  assert.equal(p.get('plugindata[onlinetext_editor][format]'), '1');
});

test('normalizeUrl', () => {
  assert.equal(normalizeUrl('aula.colegio.edu/'), 'https://aula.colegio.edu');
  assert.equal(normalizeUrl('https://x.edu/moodle/login/index.php'), 'https://x.edu/moodle');
});

test('htmlToText', () => {
  const t = htmlToText('<p>Lee el <b>capítulo</b> 3 &amp; responde:</p><ul><li>¿Qué?</li><li>¿Por qué?</li></ul>');
  assert.match(t, /Lee el capítulo 3 & responde:/);
  assert.match(t, /• ¿Qué\?/);
});

test('splitDraft separa las notas privadas y limpia preámbulos de IA', () => {
  const sampleWithPreamble = [
    'A continuación, presento el desarrollo completo y detallado de la tarea asignada sobre los aspectos de la estructura organizativa.',
    '',
    '# Ensayo',
    '',
    'Texto del desarrollo.',
    '',
    '## Notas para el estudiante',
    '- Revisa X',
  ].join('\n');

  const { draft, notes } = splitDraft(sampleWithPreamble);
  assert.equal(draft, '# Ensayo\n\nTexto del desarrollo.');
  assert.match(notes, /^## Notas para el estudiante/);
  assert.equal(splitDraft('solo texto').notes, '');
});

import { saveSecrets, loadSecrets } from '../src/core/profiles.js';

test('guardar y leer secretos directos', () => {
  saveSecrets('test-user', { moodleToken: 'xyz123', aiApiKey: 'key-abc' });
  const sec = loadSecrets('test-user');
  assert.equal(sec.moodleToken, 'xyz123');
  assert.equal(sec.aiApiKey, 'key-abc');
});

import { taskDir } from '../src/tasks/workspace.js';
import { createDocxBuffer } from '../src/tasks/docx.js';

test('taskDir organiza directamente por Materia/Tarea sin filtro de semana', () => {
  const profile = { workspaceDir: '/workspace' };
  const task = { course: 'Matemáticas Avanzadas', name: 'Guía de Derivadas', duedate: 1792454400 };
  const dir = taskDir(profile, task);
  assert.ok(dir.includes('Matemáticas Avanzadas'));
  assert.ok(dir.includes('Guía de Derivadas'));
  assert.ok(!dir.includes('Semana'));
});

test('createDocxBuffer genera un archivo Word válido con tablas, listas y formato limpio', async () => {
  const content = [
    '# Título del Trabajo',
    '## 1. Introducción',
    'Texto normal con **negrita**, *cursiva* y `código`.',
    '',
    '> Cita destacada del autor',
    '',
    '- Elemento con viñeta 1',
    '- Elemento con viñeta 2',
    '',
    '1. Primer paso numerado',
    '2. Segundo paso numerado',
    '',
    '| Columna A | Columna B |',
    '|---|---|',
    '| Dato 1 | Dato 2 |',
    '',
    '```python',
    'def hola():',
    '    return "mundo"',
    '```',
    '',
    '---',
    '',
    'Conclusión final.',
  ].join('\n');

  const buf = await createDocxBuffer({
    title: 'Tarea 1',
    course: 'Historia',
    content,
  });
  assert.ok(Buffer.isBuffer(buf));
  assert.ok(buf.length > 2000);
});

import { deleteDraft } from '../src/tasks/draft.js';
import { loadState, saveState } from '../src/core/profiles.js';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

test('deleteDraft y reconciliación automática al eliminar archivo de la carpeta', async () => {
  const tmpDir = path.join(os.tmpdir(), `jash-test-draft-${Date.now()}`);
  fs.mkdirSync(path.join(tmpDir, 'entrega'), { recursive: true });

  const fakeDocx = path.join(tmpDir, 'tarea.docx');
  fs.writeFileSync(fakeDocx, 'dummy');

  const task = {
    id: '999',
    name: 'Ensayo',
    course: 'Filosofía',
    local: { state: 'borrador', dir: tmpDir, docxFile: fakeDocx },
  };

  const session = {
    state: { tasks: { 999: task } },
    saveState() {},
  };

  // 1. Probar deleteDraft
  await deleteDraft(session, task);
  assert.equal(task.local.state, 'pendiente');
  assert.equal(fs.existsSync(fakeDocx), false);

  // 2. Probar reconciliación automática cuando el usuario borra manualmente el archivo
  const fakeDocx2 = path.join(tmpDir, 'tarea2.docx');
  fs.writeFileSync(fakeDocx2, 'dummy 2');
  const task2 = {
    id: '1000',
    name: 'Ensayo 2',
    course: 'Filosofía',
    local: { state: 'borrador', dir: tmpDir, docxFile: fakeDocx2 },
  };
  saveState('test-user', { tasks: { 1000: task2 } });

  // Si el usuario borra el archivo del disco manualmente
  fs.unlinkSync(fakeDocx2);

  // loadState debe desmarcarlo automáticamente
  const reloaded = loadState('test-user');
  assert.equal(reloaded.tasks['1000'].local.state, 'pendiente');

  // Limpiar
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('isoWeek y safeName', () => {
  assert.deepEqual(isoWeek(new Date(2026, 9, 19)), { year: 2026, week: 43 });
  assert.deepEqual(isoWeek(new Date(2027, 0, 1)), { year: 2026, week: 53 });
  assert.equal(safeName('Tarea: ¿Qué es "x"? / parte 1.'), 'Tarea ¿Qué es x  parte 1'.replace('  ', ' '));
});

function mockServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      let body = '';
      for await (const c of req) body += c;
      const out = handler(req, JSON.parse(body || '{}'));
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(out));
    });
    server.listen(0, () => resolve(server));
  });
}

test('adaptadores de IA (OpenAI y Ollama) con servidor simulado', async () => {
  const seen = [];
  const server = await mockServer((req, body) => {
    seen.push({ url: req.url, auth: req.headers.authorization, body });
    if (req.url === '/v1/chat/completions') return { choices: [{ message: { content: 'hola openai' } }] };
    if (req.url === '/api/chat') return { message: { content: 'hola ollama' } };
    return {};
  });
  const base = `http://localhost:${server.address().port}`;
  try {
    const oa = createAI({ provider: 'openai', apiKey: 'sk-test', baseUrl: `${base}/v1`, model: 'm' });
    assert.equal(await oa.chat([{ role: 'user', content: 'hi' }], { system: 'sys' }), 'hola openai');
    assert.equal(seen[0].auth, 'Bearer sk-test');
    assert.deepEqual(seen[0].body.messages[0], { role: 'system', content: 'sys' });

    const ol = createAI({ provider: 'ollama', baseUrl: base, model: 'llama' });
    assert.equal(await ol.chat([{ role: 'user', content: 'hi' }]), 'hola ollama');
    assert.equal(seen[1].body.stream, false);
  } finally {
    server.close();
  }
});

import { getTaskDraftContent } from '../src/tasks/draft.js';
import { professorReviewPrompt, professorExplainPrompt } from '../src/ai/prompts.js';

test('modo profesor: prompts y lectura de borrador', () => {
  const task = {
    id: '123',
    name: 'Ensayo Ética',
    course: 'Filosofía',
    intro: 'Analiza el imperativo categórico.',
    local: { draftText: 'El imperativo categórico es...' },
  };

  const draftText = getTaskDraftContent(task);
  assert.equal(draftText, 'El imperativo categórico es...');

  const reviewPrompt = professorReviewPrompt(task, { mandato: task.intro, draft: draftText });
  assert.match(reviewPrompt, /Mandato Oficial del Profesor/);
  assert.match(reviewPrompt, /Borrador o Trabajo Desarrollado/);

  const explainPrompt = professorExplainPrompt(task);
  assert.match(explainPrompt, /Mandato Oficial del Profesor/);
  assert.match(explainPrompt, /Analiza el imperativo categórico/);
});
