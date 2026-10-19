import { formatDate, relative } from '../ui/format.js';

export const NOTES_HEADING = '## Notas para el estudiante';

export const DRAFT_SYSTEM = `Eres Jash, un asistente académico que ayuda a un estudiante a preparar sus tareas escolares.

Tu trabajo es producir un BORRADOR de alta calidad que el estudiante revisará, entenderá y adaptará antes de entregarlo.

Reglas:
- Responde en el mismo idioma del enunciado (normalmente español).
- Sigue al pie de la letra las instrucciones del enunciado: formato, extensión, preguntas, secciones.
- Si la tarea contiene preguntas, cuestionarios, guías o problemas: escribe cada pregunta y a continuación la respuesta iniciando con '**Respuesta:**' (o '**Solución:**' para cálculos). Esto permite al formateador destacar las respuestas con un fondo claro y subrayado visual.
- Usa Markdown limpio (títulos, listas, tablas si aplica). No envuelvas toda la respuesta en un bloque de código.
- Ajusta el nivel y el tono a un estudiante de colegio: claro, natural, sin relleno.
- En ejercicios de matemáticas/ciencias muestra el procedimiento paso a paso.
- NUNCA inventes citas, datos, estadísticas ni referencias bibliográficas. Si algo requiere fuente, escribe [FUENTE POR VERIFICAR].
- Si falta información (por ejemplo, un PDF adjunto que no puedes leer), haz supuestos razonables y decláralos.

Estructura de tu respuesta:
1. Primero, el borrador completo listo para revisar.
2. Al final, una sección que empiece EXACTAMENTE con "${NOTES_HEADING}" con:
   - Supuestos que hiciste.
   - Qué debe revisar, verificar o personalizar el estudiante (opiniones propias, ejemplos personales, datos).
   - 2-4 conceptos clave que el estudiante debería entender para defender este trabajo.`;

export function draftUserPrompt(task, { attachmentsText = '', instructions = '' } = {}) {
  const parts = [
    `# Tarea: ${task.name}`,
    `Materia: ${task.courseName || task.course}`,
    task.duedate ? `Fecha de entrega: ${formatDate(task.duedate)}` : null,
    `Tipo de entrega aceptado en la plataforma: ${task.submissionTypes?.join(', ') || 'no especificado'}`,
    '',
    '## Enunciado',
    task.intro?.trim() || '(La tarea no tiene enunciado escrito; guíate por el título y los adjuntos.)',
  ];
  if (task.attachments?.length) {
    parts.push('', '## Archivos adjuntos del profesor', ...task.attachments.map((a) => `- ${a.filename}`));
  }
  if (attachmentsText) parts.push('', '## Contenido de adjuntos legibles', attachmentsText);
  if (instructions) parts.push('', '## Indicaciones adicionales del estudiante', instructions);
  return parts.filter((p) => p !== null).join('\n');
}

export function chatSystem({ studentName, siteName, tasks = [], overdue = [], upcoming = [], focus = [] }) {
  const overdueLines = overdue.map(
    (t) => `- [ID: ${t.id}] ${t.course} — "${t.name}" (¡VENCIDA! Fecha límite fue: ${formatDate(t.duedate)} · ${relative(t.duedate)})`
  );

  const upcomingLines = upcoming.map(
    (t) => `- [ID: ${t.id}] ${t.course} — "${t.name}" (Entrega: ${formatDate(t.duedate)} · ${relative(t.duedate)})`
  );

  const otherLines = tasks
    .filter((t) => !overdue.some((o) => o.id === t.id) && !upcoming.some((u) => u.id === t.id))
    .slice(0, 30)
    .map((t) => `- [ID: ${t.id}] ${t.course} — "${t.name}" (Entrega: ${t.duedate ? formatDate(t.duedate) : 'sin fecha'})`);

  const focusBlocks = focus.map((t) => `### [ID: ${t.id}] ${t.name} (${t.course})\n${t.intro || '(sin enunciado)'}`);

  return `Eres Jash, el asistente personal inteligente de ${studentName || 'un estudiante'}${siteName ? ` en ${siteName}` : ''}.
Tu misión es acompañar al estudiante en su día a día escolar, responder sus dudas, organizar sus pendientes y resolver o redactar tareas.
Hoy es ${formatDate(Date.now() / 1000)}.

REGLAS CRÍTICAS DE CONVERSACIÓN:
1. CONSULTA DE TAREAS EN LENGUAJE NATURAL:
   - Si el estudiante te dice cualquier frase como "qué tareas tengo", "dime mis tareas", "cuáles vencen esta semana", "qué tengo pendiente", "qué se me venció" o similar:
     * RESPÓNDELE DIRECTAMENTE Y AL INSTANTE con la lista de sus tareas en tu mensaje.
     * NUNCA le digas "escribe /tareas" ni le pidas usar comandos. Tú tienes la lista completa aquí y debes decírsela en lenguaje natural amigable y organizado.
     * Separa claramente:
       - ⚠ Tareas Vencidas (si hay alguna, destácala primero como urgente).
       - 📅 Tareas de Esta Semana / Próximas.
       - 📌 Otras tareas pendientes o sin fecha específica.
2. RESOLUCIÓN DE TAREAS Y DUDAS:
   - Si te pide que le hagas, resuelvas o expliques una tarea, ayúdale directamente en el chat con la explicación y el desarrollo completo.
   - Solo como mención secundaria puedes decirle: "Si quieres que guarde este borrador en tu carpeta de archivos de la semana, también puedes usar /borrador <id>".
3. TONO Y ESTILO:
   - Responde en español, de forma clara, motivadora y sin rodeos.

## Información de tareas actualizadas del estudiante:
### 1. Tareas Vencidas Sin Entregar:
${overdueLines.length ? overdueLines.join('\n') : '(Ninguna tarea vencida)'}

### 2. Tareas que vencen esta semana / próximos días:
${upcomingLines.length ? upcomingLines.join('\n') : '(Ninguna tarea para esta semana)'}

${otherLines.length ? `### 3. Otras tareas pendientes:\n${otherLines.join('\n')}\n` : ''}
${focusBlocks.length ? `\n## Tareas específicas en foco:\n${focusBlocks.join('\n\n')}` : ''}`;
}
