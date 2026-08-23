import { randomUUID } from 'node:crypto';
import type { AppConfig } from './config.js';
import { answerCard, statsCard, studyCard } from './cards.js';
import type { LearningDatabase } from './database.js';
import {
  LarkCliChannel,
  type LarkCardActionEvent,
  type LarkMessageEvent,
} from './larkCli.js';
import type { Logger } from './logger.js';
import { formatDueAt } from './time.js';
import type { ReviewResult } from './types.js';

interface CardValue {
  action: 'review' | 'next';
  item_id: string;
  result?: ReviewResult;
}

export class PteBot {
  readonly channel: LarkCliChannel;
  private readonly sendingUsers = new Set<string>();

  constructor(
    private readonly config: AppConfig,
    private readonly database: LearningDatabase,
    private readonly logger: Logger,
  ) {
    this.channel = new LarkCliChannel({
      bin: config.larkCliBin,
      profile: config.larkCliProfile,
      cwd: process.cwd(),
    }, logger);
    this.channel.onMessage((message) => this.handleMessage(message));
    this.channel.onCardAction((event) => this.handleCardAction(event));
    this.channel.onError((error) => this.logger.error('飞书通道错误', error));
  }

  async connect(): Promise<void> {
    await this.channel.connect();
    this.logger.info('飞书机器人已连接', { bot: this.channel.botName, transport: 'lark-cli' });
  }

  async disconnect(): Promise<void> {
    await this.channel.disconnect();
  }

  async sendStudyItem(
    userOpenId: string,
    chatId: string,
    deliveryKey = `manual:${userOpenId}:${randomUUID()}`,
  ): Promise<boolean> {
    if (this.database.hasDeliveryKey(deliveryKey)) return false;
    const scheduled = deliveryKey.startsWith('scheduled:');
    if (this.sendingUsers.has(userOpenId) || this.database.hasPendingDelivery(userOpenId)) {
      if (!scheduled) {
        await this.channel.sendText(
          chatId,
          '上一张学习卡片还没回答。完成“认识 / 不认识”后，我才会开始下一次 5 分钟倒计时。',
          `pending:${deliveryKey}`,
        );
      }
      return false;
    }

    this.sendingUsers.add(userOpenId);
    try {
      const item = this.database.nextItem(userOpenId);
      if (!item) {
        if (!scheduled) {
          await this.channel.sendText(
            chatId,
            '你目前没有到期的单词，稍后再来吧。',
            `empty:${deliveryKey}`,
          );
        }
        return false;
      }

      const messageId = await this.channel.sendCard(chatId, studyCard(item), deliveryKey);
      const recorded = this.database.recordDelivery({
        userOpenId,
        chatId,
        itemId: item.id,
        messageId,
        deliveryKey,
        createdAt: Date.now(),
      });
      if (!recorded) {
        this.logger.warn('消息已发送但投递记录未写入', { messageId, deliveryKey });
      }
      return true;
    } finally {
      this.sendingUsers.delete(userOpenId);
    }
  }

  async sendNowForAll(): Promise<{ sent: number; skipped: number }> {
    let sent = 0;
    let skipped = 0;
    for (const subscriber of this.database.listActiveSubscribers()) {
      try {
        if (await this.sendStudyItem(subscriber.userOpenId, subscriber.chatId)) sent += 1;
        else skipped += 1;
      } catch (error) {
        skipped += 1;
        this.logger.error('立即推送失败', { userOpenId: subscriber.userOpenId, error: errorMessage(error) });
      }
    }
    return { sent, skipped };
  }

  private async handleMessage(message: LarkMessageEvent): Promise<void> {
    if (message.senderType !== 'user' || !this.isAllowed(message.senderId)) return;

    if (message.chatType !== 'p2p') {
      await this.channel.sendText(
        message.chatId,
        '为了让学习进度只属于你，请私聊我并发送“开始学习”。',
        `group-hint:${message.messageId}`,
      );
      return;
    }

    const command = normalizeCommand(message.content);
    this.logger.debug('收到学习命令', { command, userOpenId: message.senderId });

    if (['开始', '开始学习', '订阅'].includes(command)) {
      this.database.subscribe(message.senderId, message.chatId);
      await this.channel.sendText(
        message.chatId,
        `订阅成功。每次回答后，我会等待 ${this.config.pushIntervalMinutes} 分钟再发下一张；未回答时不会继续推送。回复“停止”可随时暂停。`,
        `subscribe:${message.messageId}`,
      );
      await this.sendStudyItem(message.senderId, message.chatId, `start-card:${message.messageId}`);
      return;
    }

    if (['停止', '暂停', '取消订阅'].includes(command)) {
      const changed = this.database.unsubscribe(message.senderId);
      await this.channel.sendText(
        message.chatId,
        changed ? '已暂停定时推送。你的学习记录会保留，发送“开始学习”即可恢复。' : '当前没有开启定时推送。',
        `unsubscribe:${message.messageId}`,
      );
      return;
    }

    if (['来一个', '再来一个', '单词', '继续'].includes(command)) {
      await this.sendStudyItem(message.senderId, message.chatId, `manual-card:${message.messageId}`);
      return;
    }

    if (['统计', '进度', '学习统计'].includes(command)) {
      await this.channel.sendCard(
        message.chatId,
        statsCard(this.database.stats(message.senderId, this.config.timezone)),
        `stats:${message.messageId}`,
      );
      return;
    }

    await this.channel.sendText(
      message.chatId,
      '我能理解这些指令：\n开始学习 — 开启定时推送\n来一个 — 立即学习\n统计 — 查看进度\n停止 — 暂停推送',
      `help:${message.messageId}`,
    );
  }

  private async handleCardAction(event: LarkCardActionEvent): Promise<void> {
    if (!this.isAllowed(event.operatorId)) return;
    const value = parseCardValue(event.action.value);
    if (!value) {
      this.logger.warn('忽略无法识别的卡片操作', { messageId: event.messageId });
      return;
    }

    const delivery = this.database.getDelivery(event.messageId);
    if (!delivery || delivery.userOpenId !== event.operatorId || delivery.itemId !== Number(value.item_id)) {
      this.logger.warn('忽略不属于当前用户的卡片操作', {
        messageId: event.messageId,
        userOpenId: event.operatorId,
      });
      return;
    }

    const item = this.database.getItem(delivery.itemId);
    if (!item) return;

    if (value.action === 'review' && (value.result === 'known' || value.result === 'unknown')) {
      const outcome = this.database.recordReview({
        userOpenId: delivery.userOpenId,
        itemId: delivery.itemId,
        messageId: delivery.messageId,
        result: value.result,
        knownIntervalsDays: this.config.knownIntervalsDays,
        unknownRetryMinutes: this.config.unknownRetryMinutes,
      });
      await this.channel.updateCard(event, answerCard({
        item,
        result: outcome.result,
        dueText: formatDueAt(outcome.dueAt, this.config.timezone),
        autoPushMinutes: this.config.pushIntervalMinutes,
      }));
      this.logger.info('已记录复习', {
        item: item.word,
        result: outcome.result,
        userOpenId: delivery.userOpenId,
        duplicate: !outcome.created,
      });
      return;
    }

    if (value.action === 'next') {
      await this.sendStudyItem(delivery.userOpenId, delivery.chatId, `next-card:${event.eventId}`);
      const progress = this.database.getProgress(delivery.userOpenId, delivery.itemId);
      if (progress) {
        await this.channel.updateCard(event, answerCard({
          item,
          result: progress.lastResult,
          dueText: formatDueAt(progress.dueAt, this.config.timezone),
          showNextButton: false,
        }));
      }
    }
  }

  private isAllowed(openId: string): boolean {
    return this.config.allowedOpenIds.size === 0 || this.config.allowedOpenIds.has(openId);
  }
}

function parseCardValue(raw: unknown): CardValue | undefined {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return undefined;
    }
  }
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  if ((record.action !== 'review' && record.action !== 'next') || typeof record.item_id !== 'string') {
    return undefined;
  }
  if (record.result !== undefined && record.result !== 'known' && record.result !== 'unknown') return undefined;
  return record as unknown as CardValue;
}

function normalizeCommand(content: string): string {
  return content.trim().replace(/^@\S+\s*/, '').replace(/[。！!？?]+$/g, '').trim().toLowerCase();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
