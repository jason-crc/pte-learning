import { loadConfig } from './config.js';
import { createRuntime } from './runtime.js';
import { PushScheduler } from './scheduler.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const runtime = createRuntime(config);
  const scheduler = new PushScheduler(config, runtime.database, runtime.bot, runtime.logger);
  let stopping = false;

  const stop = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    runtime.logger.info(`收到 ${signal}，正在安全退出`);
    scheduler.stop();
    await runtime.bot.disconnect();
    runtime.database.close();
    process.exitCode = 0;
  };

  process.once('SIGINT', () => void stop('SIGINT'));
  process.once('SIGTERM', () => void stop('SIGTERM'));

  await runtime.bot.connect();
  scheduler.start();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
