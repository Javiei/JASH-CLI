import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { JASH_HOME } from '../core/paths.js';
import { JashError } from '../core/errors.js';

const BIN = fileURLToPath(new URL('../../bin/jash.js', import.meta.url));
const TASK_NAME = (profile) => `Jash Recordatorios (${profile})`;

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { windowsHide: true }, (err, stdout, stderr) =>
      err ? reject(new Error(stderr?.toString().trim() || err.message)) : resolve(stdout.toString()),
    );
  });
}

const xmlEscape = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Notificación nativa del sistema operativo (toast en Windows, Centro de notificaciones en macOS, notify-send en Linux). */
export async function notify(title, message) {
  try {
    if (process.platform === 'win32') {
      const xml = `<toast><visual><binding template="ToastGeneric"><text>${xmlEscape(title)}</text><text>${xmlEscape(message)}</text></binding></visual></toast>`;
      const script = [
        '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null',
        '[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] > $null',
        '$x = New-Object Windows.Data.Xml.Dom.XmlDocument',
        `$x.LoadXml('${xml.replace(/'/g, "''")}')`,
        '$t = [Windows.UI.Notifications.ToastNotification]::new($x)',
        "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe').Show($t)",
      ].join('; ');
      const encoded = Buffer.from(script, 'utf16le').toString('base64');
      await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded]);
    } else if (process.platform === 'darwin') {
      await run('osascript', ['-e', `display notification ${JSON.stringify(message)} with title ${JSON.stringify(title)}`]);
    } else {
      await run('notify-send', [title, message]);
    }
    return true;
  } catch {
    return false;
  }
}

/** Programa un aviso diario (Programador de tareas de Windows). Lee la caché local: no necesita tu contraseña. */
export async function scheduleDaily(profile, time = '08:00') {
  if (!/^\d{2}:\d{2}$/.test(time)) throw new JashError('La hora debe tener formato HH:MM (ej. 07:30).');
  if (process.platform !== 'win32') {
    const line = `${time.split(':')[1]} ${time.split(':')[0]} * * * "${process.execPath}" "${BIN}" recordatorios --notificar --perfil ${profile}`;
    throw new JashError('La programación automática solo está implementada en Windows.', {
      hint: `En macOS/Linux añade esta línea con \`crontab -e\`:\n  ${line}`,
    });
  }
  // Un .vbs permite ejecutar node sin que aparezca una ventana de consola.
  const vbs = path.join(JASH_HOME, `recordatorio-${profile}.vbs`);
  fs.mkdirSync(JASH_HOME, { recursive: true });
  fs.writeFileSync(
    vbs,
    `CreateObject("WScript.Shell").Run """${process.execPath}"" ""${BIN}"" recordatorios --notificar --perfil ${profile}", 0, False\r\n`,
    'utf8',
  );
  await run('schtasks', ['/Create', '/F', '/SC', 'DAILY', '/ST', time, '/TN', TASK_NAME(profile), '/TR', `wscript.exe "${vbs}"`]);
  return TASK_NAME(profile);
}

export async function unscheduleDaily(profile) {
  if (process.platform !== 'win32') throw new JashError('Solo disponible en Windows. En macOS/Linux edita `crontab -e`.');
  try {
    await run('schtasks', ['/Delete', '/F', '/TN', TASK_NAME(profile)]);
  } catch {
    throw new JashError('No había un recordatorio programado para este perfil.');
  }
  fs.rmSync(path.join(JASH_HOME, `recordatorio-${profile}.vbs`), { force: true });
}
