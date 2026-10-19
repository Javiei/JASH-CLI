import chalk from 'chalk';

const dateFmt = new Intl.DateTimeFormat('es', {
  weekday: 'short',
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

/** @param {number} ts Unix timestamp en segundos */
export function formatDate(ts) {
  if (!ts) return 'sin fecha';
  return dateFmt.format(new Date(ts * 1000));
}

export function relative(ts) {
  if (!ts) return chalk.dim('—');
  const diff = ts * 1000 - Date.now();
  const abs = Math.abs(diff);
  const h = Math.round(abs / 36e5);
  const d = Math.round(abs / 864e5);
  const txt = h < 1 ? 'menos de 1 h' : h < 48 ? `${h} h` : `${d} días`;
  return diff < 0 ? `vencida hace ${txt}` : `en ${txt}`;
}

export function urgencyColor(ts) {
  if (!ts) return chalk.dim;
  const hours = (ts * 1000 - Date.now()) / 36e5;
  if (hours < 0) return chalk.gray;
  if (hours < 24) return chalk.redBright;
  if (hours < 72) return chalk.yellowBright;
  return chalk.greenBright;
}

const MOODLE_STATUS = {
  new: chalk.red('sin entregar'),
  draft: chalk.yellow('borrador en Moodle'),
  submitted: chalk.green('entregada'),
  reopened: chalk.yellow('reabierta'),
};

export function moodleStatusLabel(s) {
  return MOODLE_STATUS[s] || chalk.dim(s || '¿?');
}

const LOCAL_STATE = {
  pendiente: chalk.dim('pendiente'),
  borrador: chalk.cyan('borrador listo'),
  entregado: chalk.green('subido por Jash'),
};

export function localStateLabel(s) {
  return LOCAL_STATE[s] || chalk.dim(s || 'pendiente');
}

export function banner() {
  const b1 = chalk.hex('#67e8f9').bold; // cyan brillante
  const b2 = chalk.hex('#38bdf8').bold; // azul cielo
  const b3 = chalk.hex('#0ea5e9').bold; // azul eléctrico
  const b4 = chalk.hex('#0284c7').bold; // azul intenso
  const b5 = chalk.hex('#2563eb').bold; // azul cobalto
  const b6 = chalk.hex('#1d4ed8').bold; // azul profundo

  const frame = chalk.hex('#1e3a8a');
  const k1 = chalk.hex('#38bdf8').bold; // 宿 (tareas)
  const k2 = chalk.hex('#60a5fa').bold; // 題
  const k3 = chalk.hex('#93c5fd').bold; // 智 (sabiduría / IA)
  const k4 = chalk.hex('#bfdbfe').bold; // 慧

  const sub = chalk.hex('#38bdf8');
  const dim = chalk.dim;

  return [
    '',
    b1('      ██╗ █████╗ ███████╗██╗  ██╗') + frame('   ┌───┐'),
    b2('      ██║██╔══██╗██╔════╝██║  ██║') + frame('   │ ') + k1('宿') + frame(' │'),
    b3('      ██║███████║███████╗███████║') + frame('   │ ') + k2('題') + frame(' │'),
    b4(' ██   ██║██╔══██║╚════██║██╔══██║') + frame('   │ ') + k3('智') + frame(' │'),
    b5(' ╚█████╔╝██║  ██║███████║██║  ██║') + frame('   │ ') + k4('慧') + frame(' │'),
    b6('  ╚════╝ ╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝') + frame('   └───┘'),
    `   ${sub('›')} ${sub('Tu asistente de tareas')} ${dim('·')} ${dim('Moodle + IA')}`,
    '',
  ].join('\n');
}

/** HUD inmersivo estilo Claude Code / OpenCode para la sesión de chat interactiva. */
export function chatHud({ user = 'Estudiante', site = 'Moodle', model = 'IA', overdueCount = 0, weekCount = 0 } = {}) {
  const b1 = chalk.hex('#67e8f9').bold;
  const b2 = chalk.hex('#38bdf8').bold;
  const b3 = chalk.hex('#0ea5e9').bold;
  const b4 = chalk.hex('#0284c7').bold;
  const b5 = chalk.hex('#2563eb').bold;
  const b6 = chalk.hex('#1d4ed8').bold;

  const frame = chalk.hex('#1e3a8a');
  const k1 = chalk.hex('#38bdf8').bold;
  const k2 = chalk.hex('#60a5fa').bold;
  const k3 = chalk.hex('#93c5fd').bold;
  const k4 = chalk.hex('#bfdbfe').bold;

  const green = chalk.hex('#4ade80');
  const yellow = chalk.hex('#facc15');
  const red = chalk.hex('#f87171');
  const purple = chalk.hex('#c084fc');
  const dim = chalk.dim;
  const tag = chalk.hex('#38bdf8');

  const statusText = overdueCount > 0
    ? red.bold(`⚠ ${overdueCount} vencida${overdueCount > 1 ? 's' : ''}`) + ' ' + dim('·') + ' ' + yellow(`${weekCount} esta semana`)
    : green.bold(`✔ Al día`) + ' ' + dim('·') + ' ' + tag(`${weekCount} esta semana`);

  const truncate = (s, len) => (s && s.length > len ? s.slice(0, len - 1) + '…' : s || '');

  return [
    '',
    b1('      ██╗ █████╗ ███████╗██╗  ██╗') + frame('   ┌───┐') + '   ' + green('● Online') + ' ' + dim('·') + ' ' + tag(truncate(site, 24)),
    b2('      ██║██╔══██╗██╔════╝██║  ██║') + frame('   │ ') + k1('宿') + frame(' │') + '   ' + purple('⚡ ') + chalk.white(truncate(model, 26)),
    b3('      ██║███████║███████╗███████║') + frame('   │ ') + k2('題') + frame(' │') + '   ' + dim('👤 ') + chalk.cyan.bold(truncate(user, 20)),
    b4(' ██   ██║██╔══██║╚════██║██╔══██║') + frame('   │ ') + k3('智') + frame(' │') + '   ' + statusText,
    b5(' ╚█████╔╝██║  ██║███████║██║  ██║') + frame('   │ ') + k4('慧') + frame(' │') + '   ' + dim('──────────────────────────────────'),
    b6('  ╚════╝ ╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝') + frame('   └───┘') + '   ' + dim('Habla con Jash en lenguaje natural'),
    '',
  ].join('\n');
}

export const ok = (msg) => console.log(`${chalk.green('✔')} ${msg}`);
export const info = (msg) => console.log(`${chalk.cyan('ℹ')} ${msg}`);
export const warn = (msg) => console.log(`${chalk.yellow('⚠')} ${msg}`);
