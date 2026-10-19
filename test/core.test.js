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

test('splitDraft separa las notas privadas', () => {
  const { draft, notes } = splitDraft('# Ensayo\n\nTexto.\n\n## Notas para el estudiante\n- Revisa X');
  assert.equal(draft, '# Ensayo\n\nTexto.');
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
