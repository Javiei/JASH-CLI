import { htmlToText } from '../moodle/html.js';

const DAY = 86400;

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

function enabledSubmissionTypes(configs = []) {
  return configs
    .filter((c) => c.subtype === 'assignsubmission' && c.name === 'enabled' && String(c.value) === '1')
    .map((c) => c.plugin)
    .filter((p) => p !== 'comments');
}

/**
 * Descarga cursos y tareas desde Moodle y actualiza la caché local del perfil.
 * Trae todos los cursos activos del estudiante y todas las tareas pendientes o recientes.
 */
export async function syncTasks(session, client, { onProgress = () => {}, pastDays = 90 } = {}) {
  onProgress('Conectando con Moodle…');
  const info = await client.siteInfo();
  const now = Date.now() / 1000;

  onProgress('Obteniendo tus cursos…');
  // Traemos todos los cursos matriculados del alumno sin descartar arbitrariamente por fechas antiguas
  const allCourses = await client.userCourses(info.userid);
  const courses = Array.isArray(allCourses) ? allCourses : [];

  const previous = session.state.tasks || {};
  const tasks = {};

  if (courses.length) {
    onProgress(`Leyendo tareas de ${courses.length} materias…`);
    const res = await client.assignments(courses.map((c) => c.id));
    const flat = [];

    for (const course of res.courses || []) {
      for (const a of course.assignments || []) {
        // No descartamos tareas si no tienen fecha o si están dentro del rango amplio
        // Tareas con más de 90 días de vencidas que ya no apliquen se pueden ignorar
        if (a.duedate && a.duedate < now - pastDays * DAY) {
          // Si el usuario ya la tenía como entregada en caché, la ignoramos para ahorrar llamadas
          if (previous[a.id]?.moodleStatus === 'submitted') continue;
        }
        flat.push({ course, a });
      }
    }

    let done = 0;
    await mapLimit(flat, 5, async ({ course, a }) => {
      let status = 'new';
      try {
        const st = await client.submissionStatus(a.id);
        status = st?.lastattempt?.submission?.status || st?.lastattempt?.teamsubmission?.status || 'new';
      } catch {
        /* algunas tareas no permiten consultar el estado */
      }
      onProgress(`Revisando estado (${++done}/${flat.length})…`);
      const prev = previous[a.id] || {};
      tasks[a.id] = {
        id: a.id,
        cmid: a.cmid,
        courseId: course.id,
        course: course.shortname || course.fullname,
        courseName: course.fullname,
        name: a.name,
        intro: htmlToText(a.intro),
        duedate: a.duedate || 0,
        cutoffdate: a.cutoffdate || 0,
        allowFrom: a.allowsubmissionsfromdate || 0,
        attachments: (a.introattachments || []).map((f) => ({
          filename: f.filename,
          fileurl: f.fileurl,
          filesize: f.filesize,
        })),
        submissionTypes: enabledSubmissionTypes(a.configs),
        moodleStatus: status,
        url: `${client.baseUrl}/mod/assign/view.php?id=${a.cmid}`,
        local: prev.local || { state: 'pendiente' },
      };
    });
  }

  session.state.tasks = tasks;
  session.state.lastSync = new Date().toISOString();
  session.state.site = { name: info.sitename, fullname: info.fullname, userid: info.userid };
  session.saveState();
  return { tasks: Object.values(tasks), courses, info };
}

/** Lista de tareas ordenada cronológicamente (vencidas primero, luego próximas, sin fecha al final). */
export function sortedTasks(state) {
  return Object.values(state.tasks || {}).sort((x, y) => {
    if (!x.duedate && !y.duedate) return x.name.localeCompare(y.name);
    if (!x.duedate) return 1;
    if (!y.duedate) return -1;
    return x.duedate - y.duedate;
  });
}

export function isPending(t) {
  return t.moodleStatus !== 'submitted' && t.local?.state !== 'entregado';
}

/** Tareas pendientes que YA VENCIERON y no se han entregado. */
export function overdueTasks(state) {
  const now = Date.now() / 1000;
  return sortedTasks(state).filter((t) => isPending(t) && t.duedate > 0 && t.duedate < now);
}

/** Tareas pendientes que vencen en los próximos `days` días (o sin fecha si includeUndated). */
export function upcoming(state, days = 7, { includeUndated = false } = {}) {
  const now = Date.now() / 1000;
  return sortedTasks(state).filter(
    (t) => isPending(t) && (t.duedate ? t.duedate >= now && t.duedate <= now + days * DAY : includeUndated),
  );
}

/** Todas las tareas pendientes activas (vencidas no entregadas + próximas de la semana + sin fecha). */
export function activePendingTasks(state) {
  return sortedTasks(state).filter(isPending);
}

export function findTask(state, id) {
  return state.tasks?.[String(id)] || null;
}
