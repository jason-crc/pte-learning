import type { AppConfig } from './config.js';
import type { LearningDatabase } from './database.js';
import type { Logger } from './logger.js';
import type { Delivery } from './types.js';

interface StudySender {
  sendStudyItem(userOpenId: string, chatId: string, deliveryKey: string): Promise<boolean>;
  sendPendingReminder(
    userOpenId: string,
    chatId: string,
    delivery: Delivery,
    reminderKey: string,
  ): Promise<void>;
}

export class PushScheduler {
  private timer?: NodeJS.Timeout;
  private ticking = false;

  constructor(
    private readonly config: AppConfig,
    private readonly database: LearningDatabase,
    private readonly bot: StudySender,
    private readonly logger: Logger,
  ) {}

  start(): void {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), 20_000);
    this.logger.info('定时推送已启动', {
      intervalMinutes: this.config.pushIntervalMinutes,
      pendingReminderMinutes: this.config.pendingReminderMinutes,
      waitForReply: true,
    });
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async tick(now = new Date()): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      for (const subscriber of this.database.listActiveSubscribers()) {
        const pending = this.database.getPendingDelivery(subscriber.userOpenId);
        if (pending) {
          await this.remindIfDue(subscriber.userOpenId, subscriber.chatId, pending, now.getTime());
          continue;
        }
        const nextPushAt = this.database.nextAutomaticPushAt(
          subscriber.userOpenId,
          this.config.pushIntervalMinutes,
        );
        if (nextPushAt === undefined || now.getTime() < nextPushAt) continue;

        const key = `scheduled:${subscriber.userOpenId}:${nextPushAt}`;
        if (this.database.hasDeliveryKey(key)) continue;
        try {
          await this.bot.sendStudyItem(subscriber.userOpenId, subscriber.chatId, key);
        } catch (error) {
          this.logger.error('定时推送失败', {
            userOpenId: subscriber.userOpenId,
            nextPushAt,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } finally {
      this.ticking = false;
    }
  }

  private async remindIfDue(
    userOpenId: string,
    chatId: string,
    delivery: Delivery,
    now: number,
  ): Promise<void> {
    const intervalMs = this.config.pendingReminderMinutes * 60 * 1000;
    const elapsed = now - delivery.createdAt;
    if (elapsed < intervalMs) return;

    const slot = Math.floor(elapsed / intervalMs);
    const key = `pending-reminder:${delivery.messageId}:${slot}`;
    if (this.database.hasDispatchKey(key)) return;

    try {
      await this.bot.sendPendingReminder(userOpenId, chatId, delivery, key);
      this.database.markDispatched(key, now);
    } catch (error) {
      this.logger.error('待回答提醒发送失败', {
        userOpenId,
        messageId: delivery.messageId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
