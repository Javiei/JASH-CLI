import { JashError } from './errors.js';
import {
  getConfig,
  loadProfile,
  loadSecrets,
  saveSecrets,
  loadState,
  saveState,
  saveProfile,
} from './profiles.js';

/**
 * Abre la sesión del perfil activo (o el indicado con --perfil).
 * Carga automáticamente el perfil, credenciales y estado sin requerir contraseña.
 */
export async function openSession({ profileName } = {}) {
  const name = profileName || getConfig().activeProfile;
  if (!name) {
    throw new JashError('No hay ningún perfil activo.', { hint: 'Ejecuta `jash registro` para crear uno.' });
  }
  const profile = loadProfile(name);
  if (!profile) {
    throw new JashError(`El perfil "${name}" no existe.`, { hint: 'Revisa `jash perfil lista`.' });
  }

  const secrets = loadSecrets(name);

  const session = {
    name,
    profile,
    secrets,
    state: loadState(name),
    saveState() {
      saveState(name, session.state);
    },
    saveSecrets() {
      saveSecrets(name, session.secrets);
    },
    saveProfile() {
      saveProfile(session.profile);
    },
  };
  return session;
}
