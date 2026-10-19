import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { openSession } from '../core/session.js';
import { clientFromSession } from '../moodle/client.js';
import { aiFromSession } from '../ai/providers.js';
import { syncTasks, sortedTasks, upcoming, findTask, isPending } from '../tasks/sync.js';
import { generateDraft } from '../tasks/draft.js';
import { planSubmission, submitPlan } from '../tasks/submit.js';
import { formatDate } from '../ui/format.js';

export async function runMcpServer(gopts) {
  // En modo MCP se conecta automáticamente al perfil activo sin requerir contraseñas
  const server = new Server(
    {
      name: 'jash-mcp',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  let session = null;
  const getSession = async (needSecrets = true) => {
    if (!session) {
      session = await openSession({ profileName: gopts.perfil, needSecrets });
    }
    return session;
  };

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: 'listar_tareas',
          description: 'Devuelve la lista de tareas escolares (pendientes o de la semana) del estudiante desde la caché local o Moodle.',
          inputSchema: {
            type: 'object',
            properties: {
              semana: { type: 'boolean', description: 'Si es true, solo tareas de los próximos 7 días' },
              todas: { type: 'boolean', description: 'Si es true, incluye entregadas y vencidas' },
            },
          },
        },
        {
          name: 'sincronizar_moodle',
          description: 'Sincroniza y descarga las tareas más recientes y cursos desde la plataforma Moodle del colegio.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'obtener_detalle_tarea',
          description: 'Obtiene el enunciado completo, fechas y estado de una tarea escolar específica por su ID.',
          inputSchema: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'ID numérico de la tarea en Moodle' },
            },
            required: ['id'],
          },
        },
        {
          name: 'generar_borrador',
          description: 'Genera el borrador de resolución para una tarea escolar utilizando la IA configurada y lo guarda en la carpeta local de la semana/materia.',
          inputSchema: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'ID de la tarea' },
              indicaciones: { type: 'string', description: 'Instrucciones específicas (ej: formato, extensión, enfoque)' },
            },
            required: ['id'],
          },
        },
        {
          name: 'subir_tarea_moodle',
          description: 'Sube la entrega final (archivos o texto) de una tarea a la plataforma Moodle del colegio.',
          inputSchema: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'ID de la tarea' },
              final: { type: 'boolean', description: 'Si es true, marca la tarea como enviada definitivamente para calificar' },
            },
            required: ['id'],
          },
        },
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      if (name === 'listar_tareas') {
        const sess = await getSession(false);
        const list = args?.todas
          ? sortedTasks(sess.state)
          : args?.semana
          ? upcoming(sess.state, 7)
          : sortedTasks(sess.state).filter(isPending);

        const data = list.map((t) => ({
          id: t.id,
          materia: t.course,
          tarea: t.name,
          entrega: formatDate(t.duedate),
          estado_moodle: t.moodleStatus,
          estado_local: t.local?.state || 'pendiente',
          carpeta: t.local?.dir || null,
        }));

        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      }

      if (name === 'sincronizar_moodle') {
        const sess = await getSession(true);
        const client = clientFromSession(sess);
        const r = await syncTasks(sess, client);
        return {
          content: [
            {
              type: 'text',
              text: `Sincronización exitosa. Cursos: ${r.courses.length}, Tareas encontradas: ${r.tasks.length}.`,
            },
          ],
        };
      }

      if (name === 'obtener_detalle_tarea') {
        const sess = await getSession(false);
        const task = findTask(sess.state, args.id);
        if (!task) {
          return { isError: true, content: [{ type: 'text', text: `Tarea con ID ${args.id} no encontrada.` }] };
        }
        return { content: [{ type: 'text', text: JSON.stringify(task, null, 2) }] };
      }

      if (name === 'generar_borrador') {
        const sess = await getSession(true);
        const task = findTask(sess.state, args.id);
        if (!task) {
          return { isError: true, content: [{ type: 'text', text: `Tarea con ID ${args.id} no encontrada.` }] };
        }
        const client = clientFromSession(sess);
        const ai = aiFromSession(sess);
        const res = await generateDraft(sess, ai, client, task, {
          instructions: args.indicaciones || '',
        });
        return {
          content: [
            {
              type: 'text',
              text: `Borrador generado con éxito.\nCarpeta: ${res.dir}\nArchivo de borrador: ${res.draftFile}\nNotas privadas generadas: ${res.hasNotes}`,
            },
          ],
        };
      }

      if (name === 'subir_tarea_moodle') {
        const sess = await getSession(true);
        const task = findTask(sess.state, args.id);
        if (!task) {
          return { isError: true, content: [{ type: 'text', text: `Tarea con ID ${args.id} no encontrada.` }] };
        }
        const plan = planSubmission(task);
        const client = clientFromSession(sess);
        await submitPlan(sess, client, task, plan, { final: Boolean(args.final) });
        return {
          content: [
            {
              type: 'text',
              text: `Tarea ${task.id} (${task.name}) subida correctamente a Moodle.${args.final ? ' (Enviada definitivamente para calificar)' : ' (Guardada como borrador en Moodle)'}`,
            },
          ],
        };
      }

      return { isError: true, content: [{ type: 'text', text: `Herramienta desconocida: ${name}` }] };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Error ejecutando ${name}: ${err.message}` }],
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
