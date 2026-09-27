import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { LearningDatabase } from '../src/database.js';
import type { WordSeed } from '../src/types.js';

const words: WordSeed[] = [
  {
    slug: 'allocate',
    word: 'allocate',
    phonetic: '/ˈæləkeɪt/',
    partOfSpeech: 'v.',
    meaningZh: '分配',
    example: 'Allocate enough time.',
    exampleZh: '分配足够的时间。',
    tags: ['academic'],
  },
  {
    slug: 'coherent',
    word: 'coherent',
    phonetic: '/kəʊˈhɪərənt/',
    partOfSpeech: 'adj.',
    meaningZh: '连贯的',
    example: 'Write a coherent essay.',
    exampleZh: '写一篇连贯的文章。',
    tags: ['writing'],
  },
];

describe('LearningDatabase', () => {
  let database: LearningDatabase;

  beforeEach(() => {
    database = new LearningDatabase(':memory:');
    database.seedWords(words);
  });

  afterEach(() => database.close());

  it('优先给出单词，并暂时跳过尚未回答的卡片', () => {
    const now = Date.UTC(2026, 7, 19, 2, 0, 0);
    const first = database.nextItem('ou_user', now);
    assert.equal(first?.word, 'allocate');
    database.recordDelivery({
      userOpenId: 'ou_user',
      chatId: 'oc_chat',
      itemId: first!.id,
      messageId: 'om_first',
      deliveryKey: 'manual:first',
      createdAt: now,
    });

    assert.equal(database.nextItem('ou_user', now)?.word, 'coherent');
    assert.equal(database.nextItem('ou_user', now + 25 * 60 * 60 * 1000)?.word, 'allocate');
  });

  it('认识时逐步拉长间隔，不认识时重置并很快复习', () => {
    const item = database.nextItem('ou_user')!;
    const start = Date.UTC(2026, 7, 19, 2, 0, 0);
    const intervals = [1, 3, 7];

    const first = database.recordReview({
      userOpenId: 'ou_user', itemId: item.id, messageId: 'om_1', result: 'known',
      reviewedAt: start, knownIntervalsDays: intervals, unknownRetryMinutes: 20,
    });
    assert.equal(first.knownStreak, 1);
    assert.equal(first.dueAt, start + 24 * 60 * 60 * 1000);

    const second = database.recordReview({
      userOpenId: 'ou_user', itemId: item.id, messageId: 'om_2', result: 'known',
      reviewedAt: first.dueAt, knownIntervalsDays: intervals, unknownRetryMinutes: 20,
    });
    assert.equal(second.knownStreak, 2);
    assert.equal(second.dueAt, first.dueAt + 3 * 24 * 60 * 60 * 1000);

    const unknown = database.recordReview({
      userOpenId: 'ou_user', itemId: item.id, messageId: 'om_3', result: 'unknown',
      reviewedAt: second.dueAt, knownIntervalsDays: intervals, unknownRetryMinutes: 20,
    });
    assert.equal(unknown.knownStreak, 0);
    assert.equal(unknown.dueAt, second.dueAt + 20 * 60 * 1000);
  });

  it('同一张卡重复点击只记录一次', () => {
    const item = database.nextItem('ou_user')!;
    const input = {
      userOpenId: 'ou_user', itemId: item.id, messageId: 'om_same', result: 'known' as const,
      reviewedAt: Date.UTC(2026, 7, 19), knownIntervalsDays: [1, 3], unknownRetryMinutes: 20,
    };
    assert.equal(database.recordReview(input).created, true);
    assert.equal(database.recordReview(input).created, false);
    assert.equal(database.stats('ou_user', 'Asia/Shanghai', input.reviewedAt).totalReviews, 1);
  });

  it('保存订阅状态和时间槽幂等键', () => {
    database.subscribe('ou_user', 'oc_chat', 100);
    database.subscribe('ou_user', 'oc_new_chat', 200);
    assert.deepEqual(database.listActiveSubscribers().map((subscriber) => subscriber.chatId), ['oc_new_chat']);

    database.markDispatched('slot:1', 300);
    database.markDispatched('slot:1', 400);
    assert.equal(database.hasDispatchKey('slot:1'), true);
    assert.equal(database.unsubscribe('ou_user', 500), true);
    assert.equal(database.listActiveSubscribers().length, 0);
  });

  it('未回答卡片会阻止后续推送，并从回答时间重新计算五分钟', () => {
    const subscribedAt = Date.UTC(2026, 7, 19, 2, 0, 0);
    database.subscribe('ou_user', 'oc_chat', subscribedAt);
    assert.equal(database.nextAutomaticPushAt('ou_user', 5), subscribedAt + 5 * 60 * 1000);

    const item = database.nextItem('ou_user', subscribedAt)!;
    database.recordDelivery({
      userOpenId: 'ou_user', chatId: 'oc_chat', itemId: item.id,
      messageId: 'om_pending', deliveryKey: 'scheduled:first', createdAt: subscribedAt,
    });
    assert.equal(database.hasPendingDelivery('ou_user'), true);
    assert.equal(database.getPendingDelivery('ou_user')?.messageId, 'om_pending');

    const reviewedAt = subscribedAt + 12 * 60 * 1000;
    database.recordReview({
      userOpenId: 'ou_user', itemId: item.id, messageId: 'om_pending', result: 'known',
      reviewedAt, knownIntervalsDays: [1, 3], unknownRetryMinutes: 20,
    });
    assert.equal(database.hasPendingDelivery('ou_user'), false);
    assert.equal(database.nextAutomaticPushAt('ou_user', 5), reviewedAt + 5 * 60 * 1000);
  });

  it('切换投递会话时放弃旧会话里的待回答卡片', () => {
    const now = Date.UTC(2026, 7, 19, 2, 0, 0);
    database.subscribe('ou_user', 'oc_private', now);
    const item = database.nextItem('ou_user', now)!;
    database.recordDelivery({
      userOpenId: 'ou_user', chatId: 'oc_private', itemId: item.id,
      messageId: 'om_old_chat', deliveryKey: 'scheduled:old', createdAt: now,
    });

    database.subscribe('ou_user', 'oc_group', now + 1);

    assert.equal(database.hasPendingDelivery('ou_user'), false);
    assert.equal(database.getDelivery('om_old_chat')?.dismissedAt, now + 1);
    assert.equal(database.listActiveSubscribers()[0]?.chatId, 'oc_group');
  });

  it('同一群里的两名学习者分别维护待答卡和认识状态', () => {
    const now = Date.UTC(2026, 7, 19, 2, 0, 0);
    database.subscribe('ou_alice', 'oc_group', now, { displayName: 'Alice' });
    database.subscribe('ou_bob', 'oc_group', now, { displayName: 'Bob' });

    const aliceItem = database.nextItem('ou_alice', now)!;
    const bobItem = database.nextItem('ou_bob', now)!;
    assert.equal(aliceItem.word, 'allocate');
    assert.equal(bobItem.word, 'allocate');

    database.recordDelivery({
      userOpenId: 'ou_alice', chatId: 'oc_group', itemId: aliceItem.id,
      messageId: 'om_alice', deliveryKey: 'scheduled:alice', createdAt: now,
    });
    database.recordDelivery({
      userOpenId: 'ou_bob', chatId: 'oc_group', itemId: bobItem.id,
      messageId: 'om_bob', deliveryKey: 'scheduled:bob', createdAt: now,
    });

    database.recordReview({
      userOpenId: 'ou_alice', itemId: aliceItem.id, messageId: 'om_alice', result: 'known',
      reviewedAt: now + 1, knownIntervalsDays: [1, 3], unknownRetryMinutes: 20,
    });

    assert.equal(database.hasPendingDelivery('ou_alice'), false);
    assert.equal(database.hasPendingDelivery('ou_bob'), true);
    assert.equal(database.getProgress('ou_alice', aliceItem.id)?.lastResult, 'known');
    assert.equal(database.getProgress('ou_bob', bobItem.id), undefined);
    assert.deepEqual(
      database.listActiveSubscribers().map(({ displayName, chatId }) => ({ displayName, chatId })),
      [
        { displayName: 'Alice', chatId: 'oc_group' },
        { displayName: 'Bob', chatId: 'oc_group' },
      ],
    );
  });
});
