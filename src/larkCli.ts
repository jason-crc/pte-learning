import { createHash } from 'node:crypto';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { Logger } from './logger.js';
import type { MessageIdentity } from './types.js';

export interface LarkCliOptions {
  bin: string;
  profile?: string;
  cwd?: string;
}

export interface LarkMessageEvent {
  eventId: string;
  messageId: string;
  chatId: string;
  chatType: 'p2p' | 'group';
  content: string;
  messageType: string;
  senderId: string;
  senderType: 'user' | 'bot';
  createTime: number;
}

export interface LarkCardActionEvent {
  eventId: string;
  messageId: string;
  chatId: string;
  operatorId: string;
  token: string;
  action: {
    value: unknown;
    tag: string;
    name?: string;
  };
}

interface AuthStatus {
  identities?: {
    bot?: {
      available?: boolean;
      verified?: boolean;
      appName?: string;
    };
  };
}

type JsonObject = Record<string, unknown>;

export class LarkCliChannel {
  private readonly consumers: EventConsumer[] = [];
  private messageHandler?: (event: LarkMessageEvent) => void | Promise<void>;
  private cardActionHandler?: (event: LarkCardActionEvent) => void | Promise<void>;
  private errorHandler?: (error: Error) => void;
  botName = '飞书机器人';

  constructor(
    private readonly options: LarkCliOptions,
    private readonly logger: Logger,
  ) {}

  onMessage(handler: (event: LarkMessageEvent) => void | Promise<void>): void {
    this.messageHandler = handler;
  }

  onCardAction(handler: (event: LarkCardActionEvent) => void | Promise<void>): void {
    this.cardActionHandler = handler;
  }

  onError(handler: (error: Error) => void): void {
    this.errorHandler = handler;
  }

  async connect(): Promise<void> {
    const status = await this.runJson(['auth', 'status', '--verify']) as AuthStatus;
    const bot = status.identities?.bot;
    if (!bot?.available || !bot.verified) {
      throw new Error('lark-cli 的 bot 身份不可用，请先运行 lark-cli auth status --verify');
    }
    this.botName = bot.appName || this.botName;

    const messageConsumer = this.makeConsumer('im.message.receive_v1', async (raw) => {
      const event = parseMessageEvent(raw);
      if (event && this.messageHandler) await this.messageHandler(event);
    });
    const cardConsumer = this.makeConsumer('card.action.trigger', async (raw) => {
      const event = parseCardActionEvent(raw);
      if (event && this.cardActionHandler) await this.cardActionHandler(event);
    });
    this.consumers.push(messageConsumer, cardConsumer);

    try {
      await Promise.all(this.consumers.map((consumer) => consumer.start()));
    } catch (error) {
      await this.disconnect();
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    await Promise.all(this.consumers.map((consumer) => consumer.stop()));
    this.consumers.length = 0;
  }

  async sendText(
    chatId: string,
    content: string,
    idempotencyKey: string,
    identity: MessageIdentity = 'bot',
  ): Promise<string> {
    const result = await this.runJson([
      'im', '+messages-send',
      '--chat-id', chatId,
      '--text', content,
      '--as', identity,
      '--idempotency-key', stableIdempotencyKey(idempotencyKey),
      '--json',
    ], undefined, 3);
    return requireMessageId(result);
  }

  async sendCard(
    chatId: string,
    card: Record<string, unknown>,
    idempotencyKey: string,
    identity: MessageIdentity = 'bot',
  ): Promise<string> {
    const result = await this.runJson([
      'im', '+messages-send',
      '--chat-id', chatId,
      '--content', JSON.stringify(card),
      '--msg-type', 'interactive',
      '--as', identity,
      '--idempotency-key', stableIdempotencyKey(idempotencyKey),
      '--json',
    ], undefined, 3);
    return requireMessageId(result);
  }

  async updateCard(event: LarkCardActionEvent, card: Record<string, unknown>): Promise<void> {
    const personalizedCard = card.schema === '2.0'
      ? card
      : { ...card, open_ids: [event.operatorId] };
    const body = JSON.stringify({
      token: event.token,
      card: personalizedCard,
    });
    await this.runJson([
      'api', 'POST', '/open-apis/interactive/v1/card/update',
      '--as', 'bot',
      '--data', '-',
      '--json',
    ], body, 1);
  }

  private makeConsumer(eventKey: string, handler: (raw: JsonObject) => Promise<void>): EventConsumer {
    return new EventConsumer({
      eventKey,
      bin: this.options.bin,
      argsPrefix: this.argsPrefix(),
      cwd: this.options.cwd,
      logger: this.logger,
      handler,
      onError: (error) => this.emitError(error),
    });
  }

  private async runJson(args: string[], stdin?: string, maxAttempts = 1): Promise<unknown> {
    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await runJsonProcess(this.options.bin, [...this.argsPrefix(), ...args], {
          cwd: this.options.cwd,
          stdin,
        });
      } catch (error) {
        lastError = toError(error);
        if (attempt < maxAttempts) {
          await delay(250 * 2 ** (attempt - 1));
        }
      }
    }
    throw lastError ?? new Error('lark-cli 调用失败');
  }

  private argsPrefix(): string[] {
    return this.options.profile ? ['--profile', this.options.profile] : [];
  }

  private emitError(error: Error): void {
    if (this.errorHandler) this.errorHandler(error);
    else this.logger.error('lark-cli 通道错误', error);
  }
}

interface EventConsumerOptions {
  eventKey: string;
  bin: string;
  argsPrefix: string[];
  cwd?: string;
  logger: Logger;
  handler: (event: JsonObject) => Promise<void>;
  onError: (error: Error) => void;
}

class EventConsumer {
  private child?: ChildProcessWithoutNullStreams;
  private stopping = false;
  private restartTimer?: NodeJS.Timeout;
  private restartAttempt = 0;
  private closePromise?: Promise<void>;

  constructor(private readonly options: EventConsumerOptions) {}

  async start(): Promise<void> {
    this.stopping = false;
    await this.launch();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = undefined;
    if (!this.child) return;
    this.child.stdin.end();
    await Promise.race([this.closePromise, delay(5_000)]);
    if (this.child && !this.child.killed) this.child.kill('SIGTERM');
  }

  private async launch(): Promise<void> {
    const child = spawn(this.options.bin, [
      ...this.options.argsPrefix,
      'event', 'consume', this.options.eventKey,
      '--as', 'bot',
    ], {
      cwd: this.options.cwd,
      env: {
        ...process.env,
        LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1',
        LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;

    let stdoutBuffer = '';
    let stderrBuffer = '';
    let ready = false;
    let startupError: Error | undefined;
    let settleReady: (() => void) | undefined;
    let rejectReady: ((error: Error) => void) | undefined;
    const readyPromise = new Promise<void>((resolve, reject) => {
      settleReady = resolve;
      rejectReady = reject;
    });
    const readyTimeout = setTimeout(() => {
      if (!ready) rejectReady?.(new Error(`lark-cli 事件消费者启动超时: ${this.options.eventKey}`));
    }, 15_000);

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() ?? '';
      for (const line of lines) {
        const error = this.handleEventLine(line);
        if (error) {
          startupError = error;
          if (!ready) rejectReady?.(error);
          else this.options.onError(error);
        }
      }
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderrBuffer += chunk;
      const lines = stderrBuffer.split('\n');
      stderrBuffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.includes(`[event] ready event_key=${this.options.eventKey}`)) {
          ready = true;
          this.restartAttempt = 0;
          clearTimeout(readyTimeout);
          settleReady?.();
          this.options.logger.info('lark-cli 事件消费者已就绪', { eventKey: this.options.eventKey });
        } else if (line.trim()) {
          this.options.logger.debug('lark-cli 事件消费者状态', {
            eventKey: this.options.eventKey,
            status: sanitizeCliStatus(line),
          });
        }
      }
    });

    this.closePromise = new Promise<void>((resolve) => {
      child.once('close', (code, signal) => {
        clearTimeout(readyTimeout);
        if (this.child === child) this.child = undefined;
        if (!ready) rejectReady?.(startupError ?? new Error(
          `lark-cli 事件消费者启动失败: ${this.options.eventKey} (code=${code}, signal=${signal})`,
        ));
        resolve();
        if (!this.stopping) this.scheduleRestart(code, signal);
      });
    });

    child.once('error', (error) => {
      clearTimeout(readyTimeout);
      rejectReady?.(error);
      this.options.onError(error);
    });

    await readyPromise;
  }

  private handleEventLine(line: string): Error | undefined {
    if (!line.trim()) return undefined;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch {
      return new Error(`lark-cli 返回了无法解析的事件: ${this.options.eventKey}`);
    }
    if (!parsed || typeof parsed !== 'object') return undefined;
    const record = parsed as JsonObject;
    if (record.ok === false) {
      const message = findStringKey(record, 'message', 0) || `lark-cli 无法消费 ${this.options.eventKey}`;
      const hint = findStringKey(record, 'hint', 0);
      return new Error(hint ? `${message}；${hint}` : message);
    }
    void this.options.handler(parsed as JsonObject).catch((error) => this.options.onError(toError(error)));
    return undefined;
  }

  private scheduleRestart(code: number | null, signal: NodeJS.Signals | null): void {
    this.restartAttempt += 1;
    const waitMs = Math.min(30_000, 1_000 * 2 ** Math.min(this.restartAttempt - 1, 5));
    this.options.logger.warn('lark-cli 事件消费者已退出，准备重连', {
      eventKey: this.options.eventKey,
      code,
      signal,
      waitMs,
    });
    this.restartTimer = setTimeout(() => {
      void this.launch().catch((error) => {
        this.options.onError(toError(error));
        if (!this.stopping) this.scheduleRestart(null, null);
      });
    }, waitMs);
  }
}

export function parseMessageEvent(raw: JsonObject): LarkMessageEvent | undefined {
  const messageId = stringValue(raw.message_id ?? raw.id);
  const eventId = stringValue(raw.event_id);
  const chatId = stringValue(raw.chat_id);
  const senderId = stringValue(raw.sender_id);
  const chatType = raw.chat_type;
  const senderType = raw.sender_type;
  if (!messageId || !eventId || !chatId || !senderId) return undefined;
  if (chatType !== 'p2p' && chatType !== 'group') return undefined;
  if (senderType !== 'user' && senderType !== 'bot') return undefined;
  return {
    eventId,
    messageId,
    chatId,
    chatType,
    content: stringValue(raw.content),
    messageType: stringValue(raw.message_type),
    senderId,
    senderType,
    createTime: numberValue(raw.create_time ?? raw.timestamp),
  };
}

export function parseCardActionEvent(raw: JsonObject): LarkCardActionEvent | undefined {
  const eventId = stringValue(raw.event_id);
  const messageId = stringValue(raw.message_id);
  const chatId = stringValue(raw.chat_id);
  const operatorId = stringValue(raw.operator_id);
  const token = stringValue(raw.token);
  if (!eventId || !messageId || !chatId || !operatorId || !token) return undefined;
  return {
    eventId,
    messageId,
    chatId,
    operatorId,
    token,
    action: {
      value: parseMaybeJson(raw.action_value),
      tag: stringValue(raw.action_tag) || 'unknown',
      name: stringValue(raw.action_name) || undefined,
    },
  };
}

export function stableIdempotencyKey(value: string): string {
  return `pte-${createHash('sha256').update(value).digest('hex').slice(0, 40)}`;
}

export function requireMessageId(value: unknown): string {
  const found = findStringKey(value, 'message_id', 0);
  if (!found) throw new Error('lark-cli 发送成功响应中缺少 message_id');
  return found;
}

function findStringKey(value: unknown, key: string, depth: number): string | undefined {
  if (depth > 6 || !value || typeof value !== 'object') return undefined;
  if (!Array.isArray(value)) {
    const record = value as JsonObject;
    if (typeof record[key] === 'string' && record[key]) return record[key];
    for (const child of Object.values(record)) {
      const found = findStringKey(child, key, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  for (const child of value) {
    const found = findStringKey(child, key, depth + 1);
    if (found) return found;
  }
  return undefined;
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numberValue(value: unknown): number {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : Date.now();
}

function sanitizeCliStatus(line: string): string {
  if (line.includes('token')) return '[credential-related status hidden]';
  return line.slice(0, 300);
}

function runJsonProcess(
  bin: string,
  args: string[],
  options: { cwd?: string; stdin?: string },
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: options.cwd,
      env: {
        ...process.env,
        LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1',
        LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1',
      },
      stdio: [options.stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout!.setEncoding('utf8');
    child.stderr!.setEncoding('utf8');
    child.stdout!.on('data', (chunk: string) => {
      if (stdout.length < 2_000_000) stdout += chunk;
    });
    child.stderr!.on('data', (chunk: string) => {
      if (stderr.length < 20_000) stderr += chunk;
    });
    child.once('error', reject);
    child.once('close', (code) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(stdout) as unknown;
      } catch {
        parsed = undefined;
      }
      if (code !== 0) {
        const cliMessage = findStringKey(parsed, 'message', 0);
        reject(new Error(cliMessage || sanitizeCliStatus(stderr.trim()) || `lark-cli 退出码 ${code}`));
        return;
      }
      if (parsed === undefined) {
        reject(new Error('lark-cli 未返回有效 JSON'));
        return;
      }
      resolve(parsed);
    });
    if (options.stdin !== undefined && child.stdin) child.stdin.end(options.stdin);
  });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
