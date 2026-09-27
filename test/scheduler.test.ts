import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AppConfig } from '../src/config.js';
import { LearningDatabase } from '../src/database.js';
import { Logger } from '../src/logger.js';
import { PushScheduler } from '../src/scheduler.js';
import type { WordSeed } from '../src/types.js';

const word: WordSeed = {
  slug: 'allocate', word: 'allocate', phonetic: '', partOfSpeech: 'v.', meaningZh: '分配',
  example: '', exampleZh: '', tags: [],
};

const secondWord: WordSeed = {
  slug: 'coherent', word: 'coherent', phonetic: '', partOfSpeech: 'adj.', meaningZh: '连贯的',
  example: '', exampleZh: '', tags: [],
};

describe('PushScheduler', () => {
  it('未回答时每三十分钟提醒，回答后等待五分钟再推送', async () => {
    const database = new LearningDatabase(':memory:');
    database.seedWords([word, secondWord]);
    const subscribedAt = Date.parse('2026-08-19T04:20:00.000Z');
    database.subscribe('ou_user', 'oc_chat', subscribedAt);
    let calls = 0;
    let reminders = 0;
    const bot = {
      async sendStudyItem(user: string, chat: string, key: string): Promise<boolean> {
        calls += 1;
        database.recordDelivery({
          userOpenId: user,
          chatId: chat,
          itemId: database.nextItem(user)!.id,
          messageId: `om_${calls}`,
          deliveryKey: key,
          createdAt: calls === 1 ? subscribedAt + 5 * 60 * 1000 : subscribedAt + 75 * 60 * 1000,
        });
        return true;
      },
      async sendPendingReminder(): Promise<void> {
        reminders += 1;
      },
    };
    const config = {
      pushIntervalMinutes: 5,
      pendingReminderMinutes: 30,
      timezone: 'Asia/Shanghai',
    } as AppConfig;
    const scheduler = new PushScheduler(config, database, bot, new Logger('error'));

    await scheduler.tick(new Date(subscribedAt + 5 * 60 * 1000 - 1));
    assert.equal(calls, 0);

    await scheduler.tick(new Date(subscribedAt + 5 * 60 * 1000));
    assert.equal(calls, 1);

    await scheduler.tick(new Date(subscribedAt + 35 * 60 * 1000 - 1));
    assert.equal(calls, 1);
    assert.equal(reminders, 0);

    await scheduler.tick(new Date(subscribedAt + 35 * 60 * 1000));
    assert.equal(reminders, 1);
    await scheduler.tick(new Date(subscribedAt + 35 * 60 * 1000));
    assert.equal(reminders, 1);
    await scheduler.tick(new Date(subscribedAt + 65 * 60 * 1000));
    assert.equal(reminders, 2);

    const reviewedAt = subscribedAt + 70 * 60 * 1000;
    database.recordReview({
      userOpenId: 'ou_user', itemId: database.getDelivery('om_1')!.itemId,
      messageId: 'om_1', result: 'known', reviewedAt,
      knownIntervalsDays: [1, 3], unknownRetryMinutes: 20,
    });
    await scheduler.tick(new Date(reviewedAt + 5 * 60 * 1000 - 1));
    assert.equal(calls, 1);

    await scheduler.tick(new Date(reviewedAt + 5 * 60 * 1000));
    assert.equal(calls, 2);
    await scheduler.tick(new Date(reviewedAt + 5 * 60 * 1000));
    assert.equal(calls, 2);
    assert.equal(reminders, 2);
    database.close();
  });
});
