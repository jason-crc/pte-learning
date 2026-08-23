import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { localTimeParts } from '../src/time.js';

describe('localTimeParts', () => {
  it('按 Asia/Shanghai 计算定时槽', () => {
    const parts = localTimeParts(new Date('2026-08-19T04:20:15.000Z'), 'Asia/Shanghai');
    assert.deepEqual(parts, { date: '2026-08-19', time: '12:20' });
  });
});
