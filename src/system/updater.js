import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { createRequire } from 'node:module';
import chalk from 'chalk';
import ora from 'ora';
import { JASH_HOME } from '../core/paths.js';

const pkg = createRequire(import.meta.url)('../../package.json');
const CHECK_FILE = path.join(JASH_HOME, 'update-check.json');
const REPO_URL = 'https://github.com/Javiei/JASH-CLI.git';
const REMOTE_PKG_URL = 'https://raw.githubusercontent.com/Javiei/JASH-CLI/main/package.json';
const CHECK_INTERVAL_MS = 2 * 60 * 60 * 1000; // Revisar cada 2 horas

function semverGt(remote, local) {
  const r = String(remote || '0').split('.').map(Number);
  const l = String(local || '0').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((r[i] || 0) > (l[i] || 0)) return true;
    if ((r[i] || 0) < (l[i] || 0)) return false;
  }
  return false;
}

/**
 * Revisa si hay una versión más reciente en GitHub.
 * @param {object} [opts]
 * @param {boolean} [opts.force=false] Ignorar caché de tiempo
 */
export async function checkForUpdate({ force = false } = {}) {
  try {
    let cache = null;
    if (fs.existsSync(CHECK_FILE)) {
      try {
        cache = JSON.parse(fs.readFileSync(CHECK_FILE, 'utf8'));
      } catch {
        /* ignorar */
      }
    }

    const now = Date.now();
    if (!force && cache && now - cache.lastCheck < CHECK_INTERVAL_MS) {
      if (cache.hasUpdate && semverGt(cache.remoteVersion, pkg.version)) {
        return { hasUpdate: true, current: pkg.version, latest: cache.remoteVersion };
      }
      return { hasUpdate: false, current: pkg.version };
    }

    // Petición con timeout corto de 2s y cache-busting para no usar caché de GitHub CDN
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);

    const res = await fetch(`${REMOTE_PKG_URL}?t=${now}`, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) return { hasUpdate: false, current: pkg.version };

    const remotePkg = await res.json();
    const hasUpdate = semverGt(remotePkg.version, pkg.version);

    try {
      fs.mkdirSync(JASH_HOME, { recursive: true });
      fs.writeFileSync(
        CHECK_FILE,
        JSON.stringify({ lastCheck: now, hasUpdate, remoteVersion: remotePkg.version }, null, 2),
        'utf8'
      );
    } catch {
      /* ignorar */
    }

    return { hasUpdate, current: pkg.version, latest: remotePkg.version };
  } catch {
    return { hasUpdate: false, current: pkg.version };
  }
}

/**
 * Ejecuta la actualización de Jash descargando e instalando la última versión de GitHub.
 */
export async function updateSelf() {
  console.log(chalk.bold('\n🔄 Actualizando Jash CLI desde GitHub…'));
  const sp = ora({ text: 'Instalando última versión (npm install -g)...', color: 'cyan' }).start();

  return new Promise((resolve) => {
    exec(`npm install -g ${REPO_URL}`, (err, stdout, stderr) => {
      if (err) {
        sp.fail('No se pudo actualizar automáticamente.');
        console.error(chalk.red(`\nDetalle del error:\n${stderr || err.message}`));
        console.log(chalk.dim(`\nPuedes intentar ejecutar manualmente en tu terminal:`));
        console.log(chalk.cyan(`npm install -g ${REPO_URL}\n`));
        resolve(false);
        return;
      }

      // Limpiar caché de comprobación
      try {
        if (fs.existsSync(CHECK_FILE)) fs.unlinkSync(CHECK_FILE);
      } catch {
        /* ignorar */
      }

      sp.succeed(chalk.green.bold('¡Jash se ha actualizado con éxito a la última versión! 🎉'));
      console.log(chalk.dim('\nEjecuta `jash` para disfrutar las mejoras.\n'));
      resolve(true);
    });
  });
}

/**
 * Si hay una actualización disponible, la aplica automáticamente mostrando el estado al usuario.
 */
export async function autoUpdateIfAvailable() {
  try {
    const update = await checkForUpdate();
    if (update.hasUpdate) {
      console.log(
        chalk.hex('#38bdf8')(
          `\n  ⚡ ¡Nueva actualización disponible! (${chalk.dim(update.current)} → ${chalk.green.bold('v' + update.latest)})`
        )
      );
      console.log(chalk.dim('  🔄 Aplicando actualización automática desde GitHub...\n'));
      await updateSelf();
      return true;
    }
  } catch {
    /* si falla la comprobación en segundo plano, no interrumpir al usuario */
  }
  return false;
}

