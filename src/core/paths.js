import os from 'node:os';
import path from 'node:path';

/** Carpeta raíz donde Jash guarda configuración y perfiles (se puede cambiar con JASH_HOME). */
export const JASH_HOME = process.env.JASH_HOME || path.join(os.homedir(), '.jash');
export const CONFIG_FILE = path.join(JASH_HOME, 'config.json');
export const PROFILES_DIR = path.join(JASH_HOME, 'profiles');

export const profileDir = (name) => path.join(PROFILES_DIR, name);

/** Carpeta por defecto donde se crean las tareas de un perfil. */
export const defaultWorkspace = (name) => path.join(os.homedir(), 'Documents', 'Jash', name);
