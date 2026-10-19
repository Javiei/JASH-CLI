import { JashError } from '../core/errors.js';

/**
 * Proveedores soportados. Los modelos por defecto se pueden cambiar en `jash registro` / `jash config`.
 * `openai` acepta además una baseUrl personalizada para cualquier API compatible (OpenRouter, LM Studio, Groq…).
 */
export const PROVIDERS = {
  openai: {
    label: 'OpenAI (o compatible)',
    needsKey: true,
    defaultModel: 'gpt-4o-mini',
    defaultBaseUrl: 'https://api.openai.com/v1',
  },
  anthropic: {
    label: 'Anthropic Claude',
    needsKey: true,
    defaultModel: 'claude-sonnet-4-5',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
  },
  gemini: {
    label: 'Google Gemini',
    needsKey: true,
    defaultModel: 'gemini-2.5-flash',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  },
  ollama: {
    label: 'Ollama (local, gratis)',
    needsKey: false,
    defaultModel: 'llama3.1',
    defaultBaseUrl: 'http://localhost:11434',
  },
};

async function postJson(url, body, headers, label) {
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  } catch (err) {
    const hint = label.startsWith('Ollama') ? '¿Está Ollama corriendo? Prueba `ollama serve`.' : undefined;
    throw new JashError(`No se pudo conectar con ${label}: ${err.cause?.code || err.message}`, { hint });
  }
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try {
      const j = JSON.parse(text);
      msg = j.error?.message || j.error || j.message || text;
    } catch {
      /* texto plano */
    }
    throw new JashError(`${label} respondió ${res.status}: ${String(msg).slice(0, 400)}`, {
      hint: res.status === 401 || res.status === 403 ? 'Revisa tu API key con `jash config`.' : undefined,
    });
  }
  return JSON.parse(text);
}

const adapters = {
  async openai({ model, apiKey, baseUrl }, messages, system) {
    const data = await postJson(
      `${baseUrl}/chat/completions`,
      { model, messages: [...(system ? [{ role: 'system', content: system }] : []), ...messages] },
      { authorization: `Bearer ${apiKey}` },
      'OpenAI',
    );
    return data.choices?.[0]?.message?.content ?? '';
  },

  async anthropic({ model, apiKey, baseUrl }, messages, system, maxTokens) {
    const data = await postJson(
      `${baseUrl}/messages`,
      { model, max_tokens: maxTokens, ...(system ? { system } : {}), messages },
      { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      'Anthropic',
    );
    return (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  },

  async gemini({ model, apiKey, baseUrl }, messages, system, maxTokens) {
    const data = await postJson(
      `${baseUrl}/models/${encodeURIComponent(model)}:generateContent`,
      {
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        contents: messages.map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        })),
        generationConfig: { maxOutputTokens: maxTokens },
      },
      { 'x-goog-api-key': apiKey },
      'Gemini',
    );
    return (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
  },

  async ollama({ model, baseUrl }, messages, system) {
    const data = await postJson(
      `${baseUrl}/api/chat`,
      { model, stream: false, messages: [...(system ? [{ role: 'system', content: system }] : []), ...messages] },
      {},
      'Ollama',
    );
    return data.message?.content ?? '';
  },
};

/**
 * Crea un cliente de IA unificado.
 * @returns {{ provider: string, model: string, chat(messages: {role:'user'|'assistant',content:string}[], opts?: {system?: string, maxTokens?: number}): Promise<string> }}
 */
export function createAI({ provider, model, apiKey, baseUrl }) {
  const meta = PROVIDERS[provider];
  if (!meta) throw new JashError(`Proveedor de IA desconocido: ${provider}`);
  if (meta.needsKey && !apiKey) {
    throw new JashError(`Falta la API key de ${meta.label}.`, { hint: 'Configúrala con `jash config`.' });
  }
  const cfg = { model: model || meta.defaultModel, apiKey, baseUrl: (baseUrl || meta.defaultBaseUrl).replace(/\/+$/, '') };
  return {
    provider,
    model: cfg.model,
    label: `${meta.label} · ${cfg.model}`,
    async chat(messages, { system, maxTokens = 8192 } = {}) {
      const out = await adapters[provider](cfg, messages, system, maxTokens);
      if (!out?.trim()) throw new JashError(`${meta.label} devolvió una respuesta vacía.`);
      return out;
    },
  };
}

export function aiFromSession(session) {
  const { ai } = session.profile;
  return createAI({ provider: ai.provider, model: ai.model, baseUrl: ai.baseUrl, apiKey: session.secrets?.aiApiKey });
}
