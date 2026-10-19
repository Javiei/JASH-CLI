import fs from 'node:fs';
import path from 'node:path';
import { input, select, confirm } from '@inquirer/prompts';
import chalk from 'chalk';
import { JashError } from '../core/errors.js';
import { defaultWorkspace } from '../core/paths.js';
import {
  isValidProfileName,
  profileExists,
  saveProfile,
  saveSecrets,
  setActiveProfile,
  listProfiles,
  loadProfile,
  getConfig,
  deleteProfile,
} from '../core/profiles.js';
import { openSession } from '../core/session.js';
import { PROVIDERS } from '../ai/providers.js';
import { banner, ok, info } from '../ui/format.js';
import { moodleLoginFlow, aiSetupFlow } from './flows.js';

export async function registro() {
  console.log(banner());
  console.log(chalk.bold('Vamos a crear tu perfil.'));
  console.log(chalk.dim('Todo se guarda en tu computadora de forma directa y lista para usar.\n'));

  const name = await input({
    message: 'Nombre del perfil (ej. javier):',
    validate: (n) =>
      !isValidProfileName(n) ? '2-32 caracteres: letras, números, - o _' : profileExists(n) ? 'Ese perfil ya existe' : true,
  });

  console.log(chalk.bold('\n① Moodle'));
  const moodle = await moodleLoginFlow();

  console.log(chalk.bold('\n② Inteligencia artificial'));
  const { ai, apiKey } = await aiSetupFlow();

  console.log(chalk.bold('\n③ Carpeta de trabajo'));
  const workspaceDir = path.resolve(
    await input({ message: '¿Dónde guardo tus tareas?', default: defaultWorkspace(name) }),
  );
  fs.mkdirSync(workspaceDir, { recursive: true });

  saveProfile({
    name,
    createdAt: new Date().toISOString(),
    moodle: {
      url: moodle.url,
      username: moodle.username,
      sitename: moodle.site.sitename,
      fullname: moodle.site.fullname,
      userid: moodle.site.userid,
    },
    ai,
    workspaceDir,
  });
  saveSecrets(name, { moodleToken: moodle.token, aiApiKey: apiKey });
  setActiveProfile(name);

  console.log();
  ok(`Perfil ${chalk.bold(name)} creado y activo.`);
  console.log(`
${chalk.bold('Siguientes pasos:')}
  ${chalk.cyan('jash sincronizar')}        trae tus tareas de Moodle
  ${chalk.cyan('jash tareas --semana')}    mira lo que vence esta semana
  ${chalk.cyan('jash borrador --semana')}  prepara borradores de toda la semana
  ${chalk.cyan('jash chat')}               conversa con tu asistente
`);
}

/** Renueva el token de Moodle (por ejemplo si expiró o cambiaste la contraseña). */
export async function login(gopts) {
  const session = await openSession({ profileName: gopts.perfil });
  const moodle = await moodleLoginFlow({ url: session.profile.moodle.url, username: session.profile.moodle.username });
  session.secrets.moodleToken = moodle.token;
  Object.assign(session.profile.moodle, {
    url: moodle.url,
    username: moodle.username,
    sitename: moodle.site.sitename,
    fullname: moodle.site.fullname,
    userid: moodle.site.userid,
  });
  session.saveSecrets();
  session.saveProfile();
  ok('Sesión de Moodle actualizada.');
}

export async function config(gopts) {
  const session = await openSession({ profileName: gopts.perfil });
  const { profile } = session;
  const what = await select({
    message: `Configurar perfil "${profile.name}":`,
    choices: [
      { value: 'ai', name: `IA            ${chalk.dim(`${PROVIDERS[profile.ai.provider]?.label} · ${profile.ai.model}`)}` },
      { value: 'workspace', name: `Carpeta       ${chalk.dim(profile.workspaceDir)}` },
      { value: 'moodle', name: `Moodle        ${chalk.dim(`${profile.moodle.username} @ ${profile.moodle.url}`)}` },
    ],
  });

  if (what === 'ai') {
    const { ai, apiKey } = await aiSetupFlow({ ...profile.ai, apiKey: session.secrets.aiApiKey });
    profile.ai = ai;
    session.secrets.aiApiKey = apiKey;
    session.saveSecrets();
    session.saveProfile();
    ok('IA actualizada.');
  } else if (what === 'workspace') {
    const dir = path.resolve(await input({ message: 'Nueva carpeta de tareas:', default: profile.workspaceDir }));
    fs.mkdirSync(dir, { recursive: true });
    profile.workspaceDir = dir;
    session.saveProfile();
    ok('Carpeta actualizada. Las tareas nuevas se crearán allí.');
  } else if (what === 'moodle') {
    await login(gopts);
  }
}

export function perfilLista() {
  const profiles = listProfiles();
  if (!profiles.length) return info('No hay perfiles. Crea uno con `jash registro`.');
  const active = getConfig().activeProfile;
  for (const n of profiles) {
    const p = loadProfile(n);
    const mark = n === active ? chalk.green('●') : chalk.dim('○');
    console.log(`${mark} ${chalk.bold(n.padEnd(16))} ${chalk.dim(`${p.moodle?.fullname ?? ''} · ${p.moodle?.sitename ?? p.moodle?.url}`)}`);
  }
}

export function perfilUsar(name) {
  if (!profileExists(name)) throw new JashError(`El perfil "${name}" no existe.`);
  setActiveProfile(name);
  ok(`Perfil activo: ${chalk.bold(name)}`);
}

export async function perfilEliminar(name) {
  if (!profileExists(name)) throw new JashError(`El perfil "${name}" no existe.`);
  const sure = await confirm({
    message: `¿Eliminar el perfil "${name}" y sus credenciales? (tus carpetas de tareas NO se borran)`,
    default: false,
  });
  if (!sure) return info('Cancelado.');
  deleteProfile(name);
  ok(`Perfil ${name} eliminado.`);
}
