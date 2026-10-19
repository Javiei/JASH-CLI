import { JashError } from '../core/errors.js';

/**
 * Convierte objetos/arrays anidados al formato que espera Moodle:
 *   { courseids: [3, 5] }            -> courseids[0]=3&courseids[1]=5
 *   { plugindata: { a: { b: 1 } } }  -> plugindata[a][b]=1
 */
export function flattenParams(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') flattenParams(v, key, out);
    else out.append(key, typeof v === 'boolean' ? (v ? '1' : '0') : String(v));
  }
  return out;
}

export function normalizeUrl(url) {
  let s = String(url).trim();
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  return s.replace(/\/+$/, '').replace(/\/login(\/index\.php)?$/i, '');
}

async function parseJson(res, context) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new JashError(`Respuesta inesperada de Moodle (${context}).`, {
      hint: 'Verifica la URL de tu plataforma y que la app móvil de Moodle esté habilitada en tu colegio.',
    });
  }
}

/**
 * Obtiene un token de Web Services usando el servicio de la app móvil oficial.
 * La contraseña solo se usa aquí y NUNCA se guarda.
 */
export async function requestToken(baseUrl, username, password, service = 'moodle_mobile_app') {
  let res;
  try {
    res = await fetch(`${baseUrl}/login/token.php`, {
      method: 'POST',
      body: new URLSearchParams({ username, password, service }),
    });
  } catch (err) {
    throw new JashError(`No se pudo conectar con ${baseUrl}: ${err.cause?.code || err.message}`);
  }
  const data = await parseJson(res, 'login');
  if (data.error || !data.token) {
    throw new JashError(`Moodle rechazó el inicio de sesión: ${data.error || 'no se recibió token'}`, {
      code: data.errorcode,
      hint:
        data.errorcode === 'enablewsdescription'
          ? 'Tu colegio no tiene habilitados los servicios web / app móvil. Pide al administrador que active "Mobile services".'
          : undefined,
    });
  }
  return data.token;
}

export class MoodleClient {
  constructor(baseUrl, token) {
    this.baseUrl = normalizeUrl(baseUrl);
    this.token = token;
  }

  async call(wsfunction, params = {}) {
    let res;
    try {
      res = await fetch(`${this.baseUrl}/webservice/rest/server.php`, {
        method: 'POST',
        body: flattenParams({ wstoken: this.token, wsfunction, moodlewsrestformat: 'json', ...params }),
      });
    } catch (err) {
      throw new JashError(`No se pudo conectar con Moodle: ${err.cause?.code || err.message}`);
    }
    if (!res.ok) throw new JashError(`Moodle respondió HTTP ${res.status} en ${wsfunction}`);
    const data = await parseJson(res, wsfunction);
    if (data && data.exception) {
      const expired = ['invalidtoken', 'accessexception'].includes(data.errorcode);
      throw new JashError(`Moodle (${wsfunction}): ${data.message}`, {
        code: data.errorcode,
        hint: expired ? 'Tu sesión de Moodle expiró. Ejecuta `jash login`.' : undefined,
      });
    }
    return data;
  }

  siteInfo() {
    return this.call('core_webservice_get_site_info');
  }

  userCourses(userid) {
    return this.call('core_enrol_get_users_courses', { userid });
  }

  assignments(courseids) {
    return this.call('mod_assign_get_assignments', { courseids });
  }

  submissionStatus(assignid) {
    return this.call('mod_assign_get_submission_status', { assignid });
  }

  async downloadFile(fileurl) {
    const url = new URL(fileurl);
    url.searchParams.set('token', this.token);
    const res = await fetch(url);
    if (!res.ok) throw new JashError(`No se pudo descargar ${url.pathname} (HTTP ${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }

  /** Sube archivos al área "draft" del usuario y devuelve el itemid para usar en la entrega. */
  async uploadDraftFiles(files) {
    let itemid = 0;
    for (const f of files) {
      const form = new FormData();
      form.append('token', this.token);
      form.append('filearea', 'draft');
      form.append('itemid', String(itemid));
      form.append('file', new Blob([f.buffer]), f.name);
      const res = await fetch(`${this.baseUrl}/webservice/upload.php`, { method: 'POST', body: form });
      const data = await parseJson(res, 'upload');
      if (!Array.isArray(data) || !data[0]?.itemid) {
        throw new JashError(`Error subiendo "${f.name}": ${data.error || data.message || JSON.stringify(data)}`);
      }
      itemid = data[0].itemid;
    }
    return itemid;
  }

  saveSubmission(assignmentid, plugindata) {
    return this.call('mod_assign_save_submission', { assignmentid, plugindata });
  }

  submitForGrading(assignmentid) {
    return this.call('mod_assign_submit_for_grading', { assignmentid, acceptsubmissionstatement: 1 });
  }
}

/** Crea un cliente a partir de la sesión desbloqueada. */
export function clientFromSession(session) {
  if (!session.secrets?.moodleToken) {
    throw new JashError('Este perfil no tiene sesión de Moodle.', { hint: 'Ejecuta `jash login`.' });
  }
  return new MoodleClient(session.profile.moodle.url, session.secrets.moodleToken);
}
