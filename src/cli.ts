import { loadConfig } from './config.js';
import { createDataRuntime, createRuntime } from './runtime.js';

async function main(): Promise<void> {
  const command = process.argv[2];

  if (command === 'stats') {
    const config = loadConfig();
    const runtime = createDataRuntime(config);
    const subscribers = runtime.database.listActiveSubscribers();
    if (subscribers.length === 0) {
      console.log('当前没有已订阅用户。启动机器人后，私聊发送“开始学习”即可订阅。');
    } else {
      for (const subscriber of subscribers) {
        const stats = runtime.database.stats(subscriber.userOpenId, config.timezone);
        console.log(JSON.stringify({ userOpenId: maskId(subscriber.userOpenId), ...stats }, null, 2));
      }
    }
    runtime.database.close();
    return;
  }

  if (command === 'send-now') {
    const config = loadConfig();
    const runtime = createRuntime(config);
    try {
      await runtime.bot.connect();
      const result = await runtime.bot.sendNowForAll();
      console.log(`推送完成：成功 ${result.sent}，跳过/失败 ${result.skipped}`);
    } finally {
      await runtime.bot.disconnect();
      runtime.database.close();
    }
    return;
  }

  throw new Error('未知命令。可用命令：send-now、stats');
}

function maskId(value: string): string {
  return value.length <= 12 ? value : `${value.slice(0, 6)}…${value.slice(-4)}`;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
