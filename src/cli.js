import { Command } from 'commander';
import chalk from 'chalk';
import { createRequire } from 'node:module';
import { getConfig, loadState, loadProfile } from './core/profiles.js';
import { banner, chatHud } from './ui/format.js';
import { overdueTasks, upcoming } from './tasks/sync.js';
import { PROVIDERS } from './ai/providers.js';
import { registro, login, config, perfilLista, perfilUsar, perfilEliminar } from './commands/account.js';
import { sincronizar, tareas, borrador, abrir, entregar } from './commands/tasks.js';
import { recordatorios, programar, quitar, printReminders } from './commands/reminders.js';
import { chat } from './commands/chat.js';
import { runMcpServer } from './mcp/server.js';

const pkg = createRequire(import.meta.url)('../package.json');

export function buildProgram() {
  const program = new Command();
  const g = () => program.opts();

  program
    .name('jash')
    .description('Tu asistente de tareas escolares: Moodle + IA en la terminal.')
    .version(pkg.version, '-v, --version', 'muestra la versión')
    .option('-p, --perfil <nombre>', 'usar un perfil distinto al activo')
    .helpOption('-h, --help', 'muestra la ayuda')
    .addHelpCommand('ayuda [comando]', 'muestra la ayuda de un comando')
    .showSuggestionAfterError();

  // Sin argumentos: Dashboard inmersivo estilo Claude Code / OpenCode
  program.action(() => {
    try {
      process.stdout.write('\x1b]0;Jash · Asistente Académico\x07');
    } catch {
      /* ignorar */
    }

    console.clear();
    const active = g().perfil || getConfig().activeProfile;
    const divider = () => chalk.hex('#1e293b')('─'.repeat(Math.min(process.stdout.columns || 75, 75)));

    if (!active) {
      console.log(
        chatHud({
          user: 'Nuevo Usuario',
          site: 'Sin conectar',
          model: 'Por configurar',
          overdueCount: 0,
          weekCount: 0,
        })
      );
      console.log(divider());
      console.log(`  ${chalk.hex('#38bdf8').bold('›')} Bienvenido a Jash. Empieza creando tu perfil:`);
      console.log(`    ${chalk.cyan.bold('jash registro')}\n`);
      console.log(`  ${chalk.dim('› Ayuda completa de comandos: jash --help')}`);
      console.log(divider() + '\n');
      return;
    }

    const state = loadState(active);
    const profile = loadProfile(active) || {};
    const overdue = overdueTasks(state);
    const week = upcoming(state, 7, { includeUndated: true });
    const modelLabel = profile.ai ? `${PROVIDERS[profile.ai.provider]?.label || profile.ai.provider} · ${profile.ai.model}` : 'IA';

    console.log(
      chatHud({
        user: state.site?.fullname || profile.moodle?.fullname || active,
        site: state.site?.name || profile.moodle?.sitename || 'Moodle',
        model: modelLabel,
        overdueCount: overdue.length,
        weekCount: week.length,
      })
    );

    console.log(divider());

    if (overdue.length) {
      console.log(chalk.red.bold(`  ⚠ TAREAS VENCIDAS SIN ENTREGAR (${overdue.length}):`));
      for (const t of overdue.slice(0, 4)) {
        console.log(`  🔴 ${chalk.red(t.course)} — ${chalk.bold(t.name)} ${chalk.dim(`#${t.id}`)}`);
      }
      if (overdue.length > 4) {
        console.log(chalk.dim(`     … y ${overdue.length - 4} más (ver todas: jash tareas -v)`));
      }
      console.log();
    }

    if (week.length) {
      console.log(chalk.cyan.bold(`  📅 ENTREGAS PARA ESTA SEMANA (${week.length}):`));
      for (const t of week.slice(0, 5)) {
        const draft = t.local?.state === 'borrador' ? chalk.cyan(' [borrador listo]') : '';
        console.log(`  🟢 ${chalk.bold(t.course)} — ${t.name}${draft} ${chalk.dim(`#${t.id}`)}`);
      }
      if (week.length > 5) {
        console.log(chalk.dim(`     … y ${week.length - 5} más (ver todas: jash tareas -s)`));
      }
      console.log();
    } else if (!overdue.length) {
      console.log(chalk.green('  ✔ Todo al día. No tienes tareas pendientes para esta semana. 🎉\n'));
    }

    console.log(divider());
    console.log(chalk.hex('#38bdf8').bold('  Comandos principales:'));
    console.log(`  ${chalk.cyan.bold('jash chat')}               ${chalk.dim('asistente conversacional en tiempo real')}`);
    console.log(`  ${chalk.cyan.bold('jash tareas')}             ${chalk.dim('tabla completa de pendientes (opciones: -s, -v, -a)')}`);
    console.log(`  ${chalk.cyan.bold('jash borrador --semana')}  ${chalk.dim('generar borradores con IA de toda la semana')}`);
    console.log(`  ${chalk.cyan.bold('jash sync')}               ${chalk.dim('sincronizar tareas nuevas desde Moodle')}`);
    console.log(`  ${chalk.dim('jash --help')}            ${chalk.dim('manual completo de opciones y comandos\n')}`);
  });

  // ----- Cuenta -----
  program.command('registro').description('crea un perfil nuevo (Moodle + IA)').action(registro);
  program.command('login').description('renueva la sesión de Moodle del perfil').action(() => login(g()));
  program.command('config').description('cambia IA, carpeta o Moodle').action(() => config(g()));

  const perfil = program.command('perfil').description('gestiona perfiles de usuario');
  perfil.command('lista').alias('ls').description('lista los perfiles').action(perfilLista);
  perfil.command('usar <nombre>').description('cambia el perfil activo').action(perfilUsar);
  perfil.command('eliminar <nombre>').description('elimina un perfil y sus credenciales').action(perfilEliminar);

  // ----- Tareas -----
  program
    .command('sincronizar')
    .alias('sync')
    .description('descarga cursos y tareas desde Moodle')
    .action(() => sincronizar(g()));

  program
    .command('tareas')
    .alias('t')
    .description('lista tus tareas (usa la caché local)')
    .option('-s, --semana', 'solo las que vencen en los próximos 7 días')
    .option('-v, --vencidas', 'solo las tareas que ya vencieron y no has entregado')
    .option('-a, --todas', 'incluye entregadas y archivadas')
    .option('--sync', 'sincroniza antes de listar')
    .action((opts) => tareas(opts, g()));

  program
    .command('borrador [ids...]')
    .alias('b')
    .description('genera borradores con IA en la carpeta de cada tarea')
    .option('-s, --semana', 'todas las tareas pendientes de los próximos 7 días')
    .option('-i, --indicaciones <texto>', 'indicaciones extra para la IA (ej. "más corto, en primera persona")')
    .option('-f, --forzar', 'rehace borradores que ya existen (con --semana)')
    .action((ids, opts) => borrador(ids, opts, g()));

  program
    .command('abrir <id>')
    .description('abre la carpeta de una tarea')
    .action((id) => abrir(id, g()));

  program
    .command('entregar <id>')
    .description('muestra la vista previa y, si apruebas, sube la entrega a Moodle')
    .option('--final', 'además la envía para calificar (definitivo)')
    .action((id, opts) => entregar(id, opts, g()));

  // ----- Recordatorios -----
  const rec = program
    .command('recordatorios')
    .alias('r')
    .description('muestra las próximas entregas')
    .option('-d, --dias <n>', 'días hacia adelante', '7')
    .option('--sync', 'sincroniza antes de mostrar')
    .option('--notificar', 'envía una notificación del sistema en vez de imprimir')
    .action((opts) => recordatorios(opts, g()));
  rec
    .command('programar')
    .description('programa una notificación diaria (Windows)')
    .option('--hora <HH:MM>', 'hora del aviso', '08:00')
    .action((opts) => programar(opts, g()));
  rec.command('quitar').description('elimina la notificación diaria').action(() => quitar(g()));

  // ----- Chat -----
  program.command('chat').alias('c').description('conversa con tu asistente en la terminal').action(() => chat(g()));

  // ----- MCP Server -----
  program
    .command('mcp')
    .description('inicia el servidor MCP (Model Context Protocol) por stdio para Claude Desktop, Antigravity, etc.')
    .action(() => runMcpServer(g()));

  return program;
}
