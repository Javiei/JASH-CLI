import fs from 'node:fs';
import path from 'node:path';
import { CONFIG_FILE, PROFILES_DIR, profileDir } from './paths.js';

export function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export function writeJson(file, data, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), { encoding: 'utf8', mode });
}

// ---------- Configuración global ----------

export function getConfig() {
  return readJson(CONFIG_FILE, { activeProfile: null });
}

export function setActiveProfile(name) {
  const cfg = getConfig();
  cfg.activeProfile = name;
  writeJson(CONFIG_FILE, cfg);
}

// ---------- Perfiles ----------

export function isValidProfileName(name) {
  return /^[a-zA-Z0-9_-]{2,32}$/.test(name);
}

export function listProfiles() {
  if (!fs.existsSync(PROFILES_DIR)) return [];
  return fs
    .readdirSync(PROFILES_DIR)
    .filter((n) => fs.existsSync(path.join(profileDir(n), 'profile.json')));
}

export function profileExists(name) {
  return fs.existsSync(path.join(profileDir(name), 'profile.json'));
}

export function loadProfile(name) {
  return readJson(path.join(profileDir(name), 'profile.json'), null);
}

export function saveProfile(profile) {
  writeJson(path.join(profileDir(profile.name), 'profile.json'), profile);
}

export function deleteProfile(name) {
  fs.rmSync(profileDir(name), { recursive: true, force: true });
  const cfg = getConfig();
  if (cfg.activeProfile === name) setActiveProfile(listProfiles()[0] ?? null);
}

// ---------- Secretos ----------

export function saveSecrets(name, secrets) {
  writeJson(path.join(profileDir(name), 'secrets.json'), secrets, 0o600);
}

export function loadSecrets(name) {
  return readJson(path.join(profileDir(name), 'secrets.json'), { moodleToken: null, aiApiKey: null });
}

// ---------- Estado (caché de tareas) ----------

export function loadState(name) {
  return readJson(path.join(profileDir(name), 'state.json'), { tasks: {}, lastSync: null, site: null });
}

export function saveState(name, state) {
  writeJson(path.join(profileDir(name), 'state.json'), state);
}
