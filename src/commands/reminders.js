import chalk from 'chalk';
import { openSession } from '../core/session.js';
import { getConfig } from '../core/profiles.js';
import { clientFromSession } from '../moodle/client.js';
import { upcoming, overdueTasks } from '../tasks/sync.js';
import { notify, scheduleDaily, unscheduleDaily } from '../system/notify.js';
import { relative, urgencyColor, formatDate, ok, info } from '../ui/format.js';
import { runSync } from './tasks.js';

/** Resumen compacto de tareas vencidas y próximas (se usa al ejecutar `jash` sin argumentos). */
export function printReminders(state, days = 7) {
  const overdue = overdueTasks(state);
  const list = upcoming(state, days, { includeUndated: true });

  if (overdue.length) {
    console.log(chalk.red.bold(`  ⚠ Vencidas sin entregar (${overdue.length}):`));
    for (const t of overdue.slice(0, 5)) {
      console.log(`  🔴 ${chalk.red(relative(t.duedate).padEnd(14))} ${chalk.bold(t.course)} — ${t.name} ${chalk.dim(`#${t.id}`)}`);
    }
    if (overdue.length > 5) {
      console.log(chalk.dim(`     … y ${overdue.length - 5} más (mira todas con: jash tareas -v)`));
    }
    console.log();
  }

  if (list.length) {
    console.log(chalk.cyan.bold(`  📅 Para esta semana / próximos ${days} días:`));
    for (const t of list) {
      const color = urgencyColor(t.duedate);
      const icon = (t.duedate * 1000 - Date.now()) / 36e5 < 24 ? '🔴' : (t.duedate * 1000 - Date.now()) / 36e5 < 72 ? '🟡' : '🟢';
      const draft = t.local?.state === 'borrador' ? chalk.cyan(' [borrador listo]') : '';
      console.log(`  ${icon} ${color(relative(t.duedate).padEnd(14))} ${chalk.bold(t.course)} — ${t.name}${draft} ${chalk.dim(`#${t.id}`)}`);
    }
  } else if (!overdue.length) {
    console.log(chalk.green(`  Nada pendiente en los próximos ${days} días. 🎉`));
  }
  return list;
}

export async function recordatorios(opts, gopts) {
  const session = await openSession({ profileName: gopts.perfil, needSecrets: Boolean(opts.sync) });
  if (opts.sync) await runSync(session, clientFromSession(session));
  const days = Number(opts.dias) || 7;

  if (opts.notificar) {
    const list = upcoming(session.state, days);
    if (!list.length) return;
    const urgent = list.filter((t) => t.duedate - Date.now() / 1000 < 86400);
    const title = urgent.length
      ? `⚠ ${urgent.length} tarea(s) vencen en menos de 24 h`
      : `${list.length} tarea(s) para los próximos ${days} días`;
    const body = list
      .slice(0, 4)
      .map((t) => `• ${t.course}: ${t.name} (${relative(t.duedate)})`)
      .join('\n');
    await notify(`Jash · ${title}`, body);
    return;
  }

  console.log(chalk.bold(`\n📅 Próximas entregas (${days} días)`));
  printReminders(session.state, days);
  if (session.state.lastSync) {
    console.log(chalk.dim(`\n  Datos de ${new Date(session.state.lastSync).toLocaleString('es')}. Usa --sync para actualizar.`));
  }
}

export async function programar(opts, gopts) {
  const profile = gopts.perfil || getConfig().activeProfile;
  await openSession({ profileName: profile, needSecrets: false }); // valida que exista
  const name = await scheduleDaily(profile, opts.hora);
  ok(`Recordatorio diario programado a las ${opts.hora} (${name}).`);
  info('Usa los datos de la última sincronización. Ejecuta `jash sincronizar` con frecuencia para mantenerlos al día.');
  await notify('Jash', `Así se verán tus recordatorios diarios (${formatDate(Date.now() / 1000)})`);
}

export async function quitar(gopts) {
  const profile = gopts.perfil || getConfig().activeProfile;
  await unscheduleDaily(profile);
  ok('Recordatorio diario eliminado.');
}
