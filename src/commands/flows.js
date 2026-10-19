import { input, password, select, confirm } from '@inquirer/prompts';
import chalk from 'chalk';
import ora from 'ora';
import { MoodleClient, normalizeUrl, requestToken } from '../moodle/client.js';
import { PROVIDERS, createAI } from '../ai/providers.js';
import { warn } from '../ui/format.js';

/** Pide URL/usuario/contraseña de Moodle y obtiene un token. Reintenta si falla. */
export async function moodleLoginFlow(defaults = {}) {
  for (;;) {
    const url = normalizeUrl(
      await input({
        message: 'URL de la plataforma Moodle de tu colegio:',
        default: defaults.url,
        validate: (v) => (v.trim().length > 3 ? true : 'Escribe la dirección, ej. aula.micolegio.edu'),
      }),
    );
    const username = await input({ message: 'Usuario de Moodle:', default: defaults.username, validate: (v) => !!v.trim() || 'Requerido' });
    const pass = await password({ message: 'Contraseña de Moodle (no se guarda):', mask: '•' });

    const sp = ora('Iniciando sesión en Moodle…').start();
    try {
      const token = await requestToken(url, username.trim(), pass);
      const site = await new MoodleClient(url, token).siteInfo();
      sp.succeed(`Conectado a ${chalk.bold(site.sitename)} como ${chalk.bold(site.fullname)}`);
      return { url, username: username.trim(), token, site };
    } catch (err) {
      sp.fail(err.message);
      if (err.hint) console.log(chalk.dim(`  ${err.hint}`));
      if (!(await confirm({ message: '¿Intentar de nuevo?', default: true }))) throw err;
    }
  }
}

/** Configura proveedor, modelo y API key de IA. Devuelve { ai: {provider, model, baseUrl}, apiKey }. */
export async function aiSetupFlow(current = {}) {
  const provider = await select({
    message: '¿Qué IA quieres usar?',
    default: current.provider,
    choices: Object.entries(PROVIDERS).map(([value, p]) => ({ value, name: p.label })),
  });
  const meta = PROVIDERS[provider];

  let apiKey = null;
  if (meta.needsKey) {
    const keep = current.provider === provider && current.apiKey;
    apiKey = await password({
      message: `API key de ${meta.label}${keep ? ' (Enter para mantener la actual)' : ''}:`,
      mask: '•',
      validate: (v) => (v.trim() || keep ? true : 'Requerida'),
    });
    apiKey = apiKey.trim() || current.apiKey;
  }

  let baseUrl;
  if (provider === 'openai' || provider === 'ollama') {
    baseUrl = await input({
      message: provider === 'openai' ? 'URL base de la API (cámbiala para OpenRouter, Groq, LM Studio…):' : 'URL de Ollama:',
      default: (current.provider === provider && current.baseUrl) || meta.defaultBaseUrl,
    });
  }

  const model = await input({
    message: 'Modelo:',
    default: (current.provider === provider && current.model) || meta.defaultModel,
  });

  const ai = { provider, model: model.trim(), ...(baseUrl ? { baseUrl: baseUrl.trim() } : {}) };

  if (await confirm({ message: '¿Probar la conexión con la IA ahora?', default: true })) {
    const sp = ora('Probando IA…').start();
    try {
      await createAI({ ...ai, apiKey }).chat([{ role: 'user', content: 'Responde únicamente: OK' }], { maxTokens: 20 });
      sp.succeed(`${meta.label} responde correctamente`);
    } catch (err) {
      sp.fail(err.message);
      warn('Puedes guardar igualmente y corregirlo luego con `jash config`.');
    }
  }
  return { ai, apiKey };
}
