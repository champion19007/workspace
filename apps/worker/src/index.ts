import { parseConfig } from '@workspace/core';
import { buildWorker } from './server.js';

async function main() {
  const config = parseConfig(process.env);
  const worker = buildWorker(config);

  let isShuttingDown = false;
  const gracefulShutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    worker.app.log.info({ signal }, 'Received termination signal, shutting down worker cleanly (<= 25s limit)');

    const forceExitTimeout = setTimeout(() => {
      worker.app.log.error('Worker graceful shutdown timed out after 25s, forcing process exit');
      process.exit(1);
    }, 25_000);

    try {
      await worker.stop();
      clearTimeout(forceExitTimeout);
      worker.app.log.info('Worker shutdown completed successfully');
      process.exit(0);
    } catch (err) {
      clearTimeout(forceExitTimeout);
      worker.app.log.error({ err }, 'Error during worker shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => void gracefulShutdown('SIGINT'));

  try {
    await worker.start();
  } catch (err) {
    worker.app.log.fatal({ err }, 'Fatal error during worker startup');
    process.exit(1);
  }
}

void main();
