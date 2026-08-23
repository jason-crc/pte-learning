import type { AppConfig } from './config.js';
import { PteBot } from './bot.js';
import { LearningDatabase } from './database.js';
import { Logger } from './logger.js';
import { loadWords } from './words.js';

export function createRuntime(config: AppConfig): {
  database: LearningDatabase;
  logger: Logger;
  bot: PteBot;
} {
  const { database, logger } = createDataRuntime(config);
  const bot = new PteBot(config, database, logger);
  return { database, logger, bot };
}

export function createDataRuntime(config: AppConfig): {
  database: LearningDatabase;
  logger: Logger;
} {
  const logger = new Logger(config.logLevel);
  const database = new LearningDatabase(config.databasePath);
  const words = loadWords();
  database.seedWords(words);
  logger.info('学习数据已加载', { words: words.length, database: config.databasePath });
  return { database, logger };
}
