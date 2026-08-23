import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  parseCardActionEvent,
  parseMessageEvent,
  requireMessageId,
  stableIdempotencyKey,
} from '../src/larkCli.js';

describe('lark-cli adapter', () => {
  it('解析普通消息事件', () => {
    const event = parseMessageEvent({
      type: 'im.message.receive_v1',
      event_id: 'evt_1',
      message_id: 'om_1',
      chat_id: 'oc_1',
      chat_type: 'p2p',
      content: '开始学习',
      message_type: 'text',
      sender_id: 'ou_1',
      sender_type: 'user',
      create_time: '1787462400000',
    });
    assert.deepEqual(event, {
      eventId: 'evt_1',
      messageId: 'om_1',
      chatId: 'oc_1',
      chatType: 'p2p',
      content: '开始学习',
      messageType: 'text',
      senderId: 'ou_1',
      senderType: 'user',
      createTime: 1787462400000,
    });
  });

  it('解析卡片点击及 JSON action_value', () => {
    const event = parseCardActionEvent({
      type: 'card.action.trigger',
      event_id: 'evt_card',
      message_id: 'om_card',
      chat_id: 'oc_1',
      operator_id: 'ou_1',
      token: 'temporary-update-token',
      action_tag: 'button',
      action_value: '{"action":"review","item_id":"7","result":"known"}',
    });
    assert.equal(event?.eventId, 'evt_card');
    assert.deepEqual(event?.action.value, { action: 'review', item_id: '7', result: 'known' });
  });

  it('生成稳定且符合 50 字符限制的幂等键', () => {
    const first = stableIdempotencyKey('scheduled:ou_user:2026-08-23:12:20');
    const second = stableIdempotencyKey('scheduled:ou_user:2026-08-23:12:20');
    assert.equal(first, second);
    assert.ok(first.length <= 50);
    assert.notEqual(first, stableIdempotencyKey('scheduled:ou_user:2026-08-23:18:20'));
  });

  it('从 lark-cli 嵌套响应中提取 message_id', () => {
    assert.equal(requireMessageId({ code: 0, data: { message_id: 'om_sent' } }), 'om_sent');
    assert.throws(() => requireMessageId({ code: 0, data: {} }), /缺少 message_id/);
  });
});
