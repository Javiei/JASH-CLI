import { Command } from 'commander';
import chalk from 'chalk';
import { createRequire } from 'node:module';
import { getConfig, loadState } from './core/profiles.js';
import { banner } from './ui/format.js';
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

  // Sin argumentos: banner + resumen rápido y limpio
  program.action(() => {
    console.log(banner());
    const active = g().perfil || getConfig().activeProfile;
    if (!active) {
      console.log(`  ${chalk.hex('#38bdf8')('›')} Crea tu perfil con: ${chalk.cyan.bold('jash registro')}`);
      console.log(`  ${chalk.dim('› Ayuda completa: jash --help')}\n`);
    } else {
      const state = loadState(active);
      const site = state.site ? ` · ${state.site.name}` : '';
      console.log(`  ${chalk.green('●')} Perfil: ${chalk.bold(active)}${chalk.dim(site)}\n`);
      if (state.lastSync) {
        printReminders(state, 7);
      } else {
        console.log(`  ${chalk.hex('#38bdf8')('›')} Ejecuta ${chalk.cyan.bold('jash sincronizar')} para descargar tus tareas.`);
      }
      console.log(`\n  ${chalk.dim('Comandos:')} ${chalk.cyan('jash tareas')} ${chalk.dim('·')} ${chalk.cyan('jash borrador --semana')} ${chalk.dim('·')} ${chalk.cyan('jash chat')} ${chalk.dim('·')} ${chalk.dim('jash --help')}\n`);
    }
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
