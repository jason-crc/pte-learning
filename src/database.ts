import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import type {
  Delivery,
  MessageIdentity,
  Progress,
  ReviewOutcome,
  ReviewResult,
  StudyItem,
  Subscriber,
  UserStats,
  WordSeed,
} from './types.js';
import { localTimeParts } from './time.js';

type Row = Record<string, unknown>;

export class LearningDatabase {
  private readonly db: Database.Database;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  seedWords(words: WordSeed[]): void {
    const statement = this.db.prepare(`
      INSERT INTO items (
        slug, word, phonetic, part_of_speech, meaning_zh, example, example_zh, tags_json, enabled
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
      ON CONFLICT(slug) DO UPDATE SET
        word = excluded.word,
        phonetic = excluded.phonetic,
        part_of_speech = excluded.part_of_speech,
        meaning_zh = excluded.meaning_zh,
        example = excluded.example,
        example_zh = excluded.example_zh,
        tags_json = excluded.tags_json
    `);

    this.transaction(() => {
      for (const word of words) {
        statement.run(
          word.slug,
          word.word,
          word.phonetic,
          word.partOfSpeech,
          word.meaningZh,
          word.example,
          word.exampleZh,
          JSON.stringify(word.tags),
        );
      }
    });
  }

  subscribe(
    userOpenId: string,
    chatId: string,
    now = Date.now(),
    options: { displayName?: string; messageIdentity?: MessageIdentity } = {},
  ): void {
    this.transaction(() => {
      const current = this.db.prepare(`
        SELECT chat_id, display_name, message_identity
        FROM subscribers WHERE user_open_id = ?
      `).get(userOpenId) as Row | undefined;

      if (current && String(current.chat_id) !== chatId) {
        this.db.prepare(`
          UPDATE deliveries
          SET dismissed_at = ?
          WHERE user_open_id = ?
            AND dismissed_at IS NULL
            AND NOT EXISTS (
              SELECT 1
              FROM reviews r
              WHERE r.user_open_id = deliveries.user_open_id
                AND r.item_id = deliveries.item_id
                AND r.message_id = deliveries.message_id
            )
        `).run(now, userOpenId);
      }

      const displayName = options.displayName ?? String(current?.display_name ?? '');
      const messageIdentity = options.messageIdentity ?? String(current?.message_identity ?? 'bot');
      this.db.prepare(`
        INSERT INTO subscribers (
          user_open_id, chat_id, display_name, message_identity, enabled, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, 1, ?, ?)
        ON CONFLICT(user_open_id) DO UPDATE SET
          chat_id = excluded.chat_id,
          display_name = excluded.display_name,
          message_identity = excluded.message_identity,
          enabled = 1,
          updated_at = excluded.updated_at
      `).run(userOpenId, chatId, displayName, messageIdentity, now, now);
    });
  }

  unsubscribe(userOpenId: string, now = Date.now()): boolean {
    const result = this.db.prepare(`
      UPDATE subscribers SET enabled = 0, updated_at = ?
      WHERE user_open_id = ? AND enabled = 1
    `).run(now, userOpenId);
    return Number(result.changes) > 0;
  }

  listActiveSubscribers(): Subscriber[] {
    const rows = this.db.prepare(`
      SELECT user_open_id, chat_id, display_name, message_identity, enabled, created_at, updated_at
      FROM subscribers WHERE enabled = 1 ORDER BY created_at
    `).all() as Row[];
    return rows.map(mapSubscriber);
  }

  getSubscriber(userOpenId: string): Subscriber | undefined {
    const row = this.db.prepare(`
      SELECT user_open_id, chat_id, display_name, message_identity, enabled, created_at, updated_at
      FROM subscribers WHERE user_open_id = ?
    `).get(userOpenId) as Row | undefined;
    return row ? mapSubscriber(row) : undefined;
  }

  getItem(id: number): StudyItem | undefined {
    const row = this.db.prepare('SELECT * FROM items WHERE id = ? AND enabled = 1').get(id) as Row | undefined;
    return row ? mapItem(row) : undefined;
  }

  nextItem(userOpenId: string, now = Date.now()): StudyItem | undefined {
    const row = this.db.prepare(`
      SELECT i.*
      FROM items i
      LEFT JOIN progress p
        ON p.item_id = i.id AND p.user_open_id = ?
      WHERE i.enabled = 1
        AND (p.item_id IS NULL OR p.due_at <= ?)
        AND NOT EXISTS (
          SELECT 1
          FROM deliveries d
          LEFT JOIN reviews r
            ON r.message_id = d.message_id
            AND r.user_open_id = d.user_open_id
            AND r.item_id = d.item_id
          WHERE d.user_open_id = ?
            AND d.item_id = i.id
            AND r.id IS NULL
            AND d.created_at > ?
        )
      ORDER BY
        CASE WHEN p.item_id IS NULL THEN 1 ELSE 0 END,
        COALESCE(p.due_at, i.id),
        i.id
      LIMIT 1
    `).get(userOpenId, now, userOpenId, now - 24 * 60 * 60 * 1000) as Row | undefined;
    return row ? mapItem(row) : undefined;
  }

  recordDelivery(delivery: Delivery): boolean {
    const result = this.db.prepare(`
      INSERT OR IGNORE INTO deliveries (
        user_open_id, chat_id, item_id, message_id, delivery_key, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      delivery.userOpenId,
      delivery.chatId,
      delivery.itemId,
      delivery.messageId,
      delivery.deliveryKey,
      delivery.createdAt,
    );
    return Number(result.changes) > 0;
  }

  hasDeliveryKey(deliveryKey: string): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM deliveries WHERE delivery_key = ?').get(deliveryKey));
  }

  hasPendingDelivery(userOpenId: string): boolean {
    return this.getPendingDelivery(userOpenId) !== undefined;
  }

  getPendingDelivery(userOpenId: string): Delivery | undefined {
    const row = this.db.prepare(`
      SELECT d.user_open_id, d.chat_id, d.item_id, d.message_id,
             d.delivery_key, d.created_at, d.dismissed_at
      FROM deliveries d
      WHERE d.user_open_id = ?
        AND d.dismissed_at IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM reviews r
          WHERE r.user_open_id = d.user_open_id
            AND r.item_id = d.item_id
            AND r.message_id = d.message_id
        )
      ORDER BY d.created_at DESC
      LIMIT 1
    `).get(userOpenId) as Row | undefined;
    return row ? mapDelivery(row) : undefined;
  }

  nextAutomaticPushAt(userOpenId: string, intervalMinutes: number): number | undefined {
    const row = this.db.prepare(`
      SELECT
        s.updated_at,
        (SELECT MAX(r.reviewed_at) FROM reviews r WHERE r.user_open_id = s.user_open_id) AS last_reviewed_at
      FROM subscribers s
      WHERE s.user_open_id = ? AND s.enabled = 1
    `).get(userOpenId) as Row | undefined;
    if (!row) return undefined;

    const subscriptionUpdatedAt = Number(row.updated_at);
    const lastReviewedAt = row.last_reviewed_at == null ? 0 : Number(row.last_reviewed_at);
    return Math.max(subscriptionUpdatedAt, lastReviewedAt) + intervalMinutes * 60 * 1000;
  }

  hasDispatchKey(dispatchKey: string): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM dispatches WHERE dispatch_key = ?').get(dispatchKey));
  }

  markDispatched(dispatchKey: string, now = Date.now()): void {
    this.db.prepare(`
      INSERT OR IGNORE INTO dispatches (dispatch_key, created_at) VALUES (?, ?)
    `).run(dispatchKey, now);
  }

  getDelivery(messageId: string): Delivery | undefined {
    const row = this.db.prepare(`
      SELECT user_open_id, chat_id, item_id, message_id, delivery_key, created_at, dismissed_at
      FROM deliveries WHERE message_id = ?
    `).get(messageId) as Row | undefined;
    return row ? mapDelivery(row) : undefined;
  }

  getProgress(userOpenId: string, itemId: number): Progress | undefined {
    const row = this.db.prepare(`
      SELECT * FROM progress WHERE user_open_id = ? AND item_id = ?
    `).get(userOpenId, itemId) as Row | undefined;
    return row ? mapProgress(row) : undefined;
  }

  recordReview(input: {
    userOpenId: string;
    itemId: number;
    messageId: string;
    result: ReviewResult;
    reviewedAt?: number;
    knownIntervalsDays: number[];
    unknownRetryMinutes: number;
  }): ReviewOutcome {
    const reviewedAt = input.reviewedAt ?? Date.now();
    let outcome: ReviewOutcome | undefined;

    this.transaction(() => {
      const inserted = this.db.prepare(`
        INSERT OR IGNORE INTO reviews (user_open_id, item_id, result, message_id, reviewed_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(input.userOpenId, input.itemId, input.result, input.messageId, reviewedAt);

      const current = this.getProgress(input.userOpenId, input.itemId);
      if (Number(inserted.changes) === 0) {
        outcome = {
          created: false,
          result: current?.lastResult ?? input.result,
          dueAt: current?.dueAt ?? reviewedAt,
          knownStreak: current?.knownStreak ?? 0,
        };
        return;
      }

      const knownStreak = input.result === 'known' ? (current?.knownStreak ?? 0) + 1 : 0;
      const intervalDays = input.knownIntervalsDays[
        Math.min(Math.max(knownStreak - 1, 0), input.knownIntervalsDays.length - 1)
      ] ?? 1;
      const dueAt = input.result === 'known'
        ? reviewedAt + intervalDays * 24 * 60 * 60 * 1000
        : reviewedAt + input.unknownRetryMinutes * 60 * 1000;

      this.db.prepare(`
        INSERT INTO progress (
          user_open_id, item_id, known_streak, due_at, last_result, last_reviewed_at,
          known_count, unknown_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_open_id, item_id) DO UPDATE SET
          known_streak = excluded.known_streak,
          due_at = excluded.due_at,
          last_result = excluded.last_result,
          last_reviewed_at = excluded.last_reviewed_at,
          known_count = progress.known_count + excluded.known_count,
          unknown_count = progress.unknown_count + excluded.unknown_count
      `).run(
        input.userOpenId,
        input.itemId,
        knownStreak,
        dueAt,
        input.result,
        reviewedAt,
        input.result === 'known' ? 1 : 0,
        input.result === 'unknown' ? 1 : 0,
      );

      outcome = { created: true, result: input.result, dueAt, knownStreak };
    });

    if (!outcome) throw new Error('复习记录写入失败');
    return outcome;
  }

  stats(userOpenId: string, timezone: string, now = Date.now()): UserStats {
    const totalItems = Number((this.db.prepare('SELECT COUNT(*) AS count FROM items WHERE enabled = 1').get() as Row).count);
    const progress = this.db.prepare(`
      SELECT
        COUNT(*) AS learned_items,
        SUM(CASE WHEN due_at <= ? THEN 1 ELSE 0 END) AS due_items,
        COALESCE(SUM(known_count), 0) AS known_reviews,
        COALESCE(SUM(unknown_count), 0) AS unknown_reviews
      FROM progress WHERE user_open_id = ?
    `).get(now, userOpenId) as Row;
    const reviews = this.db.prepare(`
      SELECT reviewed_at FROM reviews WHERE user_open_id = ?
    `).all(userOpenId) as Row[];
    const today = localTimeParts(new Date(now), timezone).date;
    const todayReviews = reviews.filter(
      (row) => localTimeParts(new Date(Number(row.reviewed_at)), timezone).date === today,
    ).length;

    return {
      totalItems,
      learnedItems: Number(progress.learned_items ?? 0),
      dueItems: Number(progress.due_items ?? 0),
      totalReviews: reviews.length,
      todayReviews,
      knownReviews: Number(progress.known_reviews ?? 0),
      unknownReviews: Number(progress.unknown_reviews ?? 0),
    };
  }

  private transaction(fn: () => void): void {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      fn();
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slug TEXT NOT NULL UNIQUE,
        word TEXT NOT NULL,
        phonetic TEXT NOT NULL DEFAULT '',
        part_of_speech TEXT NOT NULL DEFAULT '',
        meaning_zh TEXT NOT NULL,
        example TEXT NOT NULL DEFAULT '',
        example_zh TEXT NOT NULL DEFAULT '',
        tags_json TEXT NOT NULL DEFAULT '[]',
        enabled INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS subscribers (
        user_open_id TEXT PRIMARY KEY,
        chat_id TEXT NOT NULL,
        display_name TEXT NOT NULL DEFAULT '',
        message_identity TEXT NOT NULL DEFAULT 'bot',
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS progress (
        user_open_id TEXT NOT NULL,
        item_id INTEGER NOT NULL REFERENCES items(id),
        known_streak INTEGER NOT NULL DEFAULT 0,
        due_at INTEGER NOT NULL,
        last_result TEXT NOT NULL CHECK(last_result IN ('known', 'unknown')),
        last_reviewed_at INTEGER NOT NULL,
        known_count INTEGER NOT NULL DEFAULT 0,
        unknown_count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (user_open_id, item_id)
      );

      CREATE TABLE IF NOT EXISTS reviews (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_open_id TEXT NOT NULL,
        item_id INTEGER NOT NULL REFERENCES items(id),
        result TEXT NOT NULL CHECK(result IN ('known', 'unknown')),
        message_id TEXT NOT NULL,
        reviewed_at INTEGER NOT NULL,
        UNIQUE(user_open_id, item_id, message_id)
      );

      CREATE TABLE IF NOT EXISTS deliveries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_open_id TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        item_id INTEGER NOT NULL REFERENCES items(id),
        message_id TEXT NOT NULL UNIQUE,
        delivery_key TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        dismissed_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS dispatches (
        dispatch_key TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_progress_due ON progress(user_open_id, due_at);
      CREATE INDEX IF NOT EXISTS idx_reviews_user_time ON reviews(user_open_id, reviewed_at);
      CREATE INDEX IF NOT EXISTS idx_deliveries_user_item ON deliveries(user_open_id, item_id);
    `);

    const subscriberColumns = this.db.prepare('PRAGMA table_info(subscribers)').all() as Row[];
    if (!subscriberColumns.some((column) => String(column.name) === 'display_name')) {
      this.db.exec("ALTER TABLE subscribers ADD COLUMN display_name TEXT NOT NULL DEFAULT ''");
    }
    if (!subscriberColumns.some((column) => String(column.name) === 'message_identity')) {
      this.db.exec("ALTER TABLE subscribers ADD COLUMN message_identity TEXT NOT NULL DEFAULT 'bot'");
    }

    const deliveryColumns = this.db.prepare('PRAGMA table_info(deliveries)').all() as Row[];
    if (!deliveryColumns.some((column) => String(column.name) === 'dismissed_at')) {
      this.db.exec('ALTER TABLE deliveries ADD COLUMN dismissed_at INTEGER');
    }
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_deliveries_pending
      ON deliveries(user_open_id, dismissed_at, created_at);
    `);
  }
}

function mapItem(row: Row): StudyItem {
  return {
    id: Number(row.id),
    slug: String(row.slug),
    word: String(row.word),
    phonetic: String(row.phonetic),
    partOfSpeech: String(row.part_of_speech),
    meaningZh: String(row.meaning_zh),
    example: String(row.example),
    exampleZh: String(row.example_zh),
    tags: JSON.parse(String(row.tags_json)) as string[],
    enabled: Boolean(row.enabled),
  };
}

function mapSubscriber(row: Row): Subscriber {
  return {
    userOpenId: String(row.user_open_id),
    chatId: String(row.chat_id),
    displayName: String(row.display_name ?? ''),
    messageIdentity: String(row.message_identity ?? 'bot') as MessageIdentity,
    enabled: Boolean(row.enabled),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function mapProgress(row: Row): Progress {
  return {
    userOpenId: String(row.user_open_id),
    itemId: Number(row.item_id),
    knownStreak: Number(row.known_streak),
    dueAt: Number(row.due_at),
    lastResult: String(row.last_result) as ReviewResult,
    lastReviewedAt: Number(row.last_reviewed_at),
    knownCount: Number(row.known_count),
    unknownCount: Number(row.unknown_count),
  };
}

function mapDelivery(row: Row): Delivery {
  return {
    userOpenId: String(row.user_open_id),
    chatId: String(row.chat_id),
    itemId: Number(row.item_id),
    messageId: String(row.message_id),
    deliveryKey: String(row.delivery_key),
    createdAt: Number(row.created_at),
    dismissedAt: row.dismissed_at == null ? undefined : Number(row.dismissed_at),
  };
}
