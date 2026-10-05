import { parseConfig } from '@workspace/core';
import { buildServer } from './server.js';

async function main() {
  const config = parseConfig(process.env);
  const server = buildServer(config);

  let isShuttingDown = false;
  const gracefulShutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    server.app.log.info({ signal }, 'Received termination signal, initiating graceful shutdown (<= 25s limit)');

    const forceExitTimeout = setTimeout(() => {
      server.app.log.error('Graceful shutdown timed out after 25s, forcing process exit');
      process.exit(1);
    }, 25_000);

    try {
      await server.close();
      clearTimeout(forceExitTimeout);
      server.app.log.info('Graceful shutdown finished successfully');
      process.exit(0);
    } catch (err) {
      clearTimeout(forceExitTimeout);
      server.app.log.error({ err }, 'Error during graceful shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => void gracefulShutdown('SIGINT'));

  try {
    await server.start();
  } catch (err) {
    server.app.log.fatal({ err }, 'Fatal error during API startup');
    process.exit(1);
  }
}

void main();
