import crypto from 'node:crypto';

const KEY_LENGTH = 32; // AES-256
const SCRYPT_OPTS = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export function newSalt() {
  return crypto.randomBytes(16).toString('base64');
}

/** Deriva una clave AES-256 a partir de la contraseña maestra del perfil (scrypt). */
export function deriveKey(password, saltB64) {
  return crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), KEY_LENGTH, SCRYPT_OPTS);
}

/** Cifra un objeto JSON con AES-256-GCM (autenticado: detecta contraseña incorrecta o manipulación). */
export function encrypt(obj, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()]);
  return {
    v: 1,
    alg: 'aes-256-gcm/scrypt',
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
}

export function decrypt(payload, key) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
  const out = Buffer.concat([decipher.update(Buffer.from(payload.data, 'base64')), decipher.final()]);
  return JSON.parse(out.toString('utf8'));
}
