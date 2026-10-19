#!/usr/bin/env node
import chalk from 'chalk';
import { buildProgram } from '../src/cli.js';

process.on('unhandledRejection', (err) => handleError(err));

function handleError(err) {
  // Ctrl+C dentro de un prompt de inquirer
  if (err?.name === 'ExitPromptError') {
    console.log(chalk.dim('\n  Cancelado.'));
    process.exit(130);
  }
  if (err?.name === 'JashError') {
    console.error(`${chalk.red('✖')} ${err.message}`);
    if (err.hint) console.error(chalk.dim(`  ${err.hint}`));
    process.exit(1);
  }
  console.error(chalk.red('✖ Error inesperado:'), err?.stack || err);
  process.exit(1);
}

try {
  await buildProgram().parseAsync(process.argv);
} catch (err) {
  handleError(err);
}
