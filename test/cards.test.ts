import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { answerCard, statsCard, studyCard } from '../src/cards.js';
import type { StudyItem } from '../src/types.js';

const item: StudyItem = {
  id: 7,
  slug: 'coherent',
  word: 'coherent',
  phonetic: '/kəʊˈhɪərənt/',
  partOfSpeech: 'adj.',
  meaningZh: '连贯的',
  example: 'The argument is coherent.',
  exampleZh: '这个论点很连贯。',
  tags: ['writing'],
  enabled: true,
};

describe('Feishu cards', () => {
  it('学习卡包含认识与不认识两个回传动作', () => {
    const serialized = JSON.stringify(studyCard(item, '陈睿'));
    assert.match(serialized, /"schema":"2.0"/);
    assert.match(serialized, /陈睿/);
    assert.match(serialized, /"type":"callback"/);
    assert.match(serialized, /"result":"known"/);
    assert.match(serialized, /"result":"unknown"/);
    assert.match(serialized, /"item_id":"7"/);
    assert.doesNotMatch(serialized, /连贯的/);
  });

  it('答案卡展示释义、例句和下一步', () => {
    const serialized = JSON.stringify(answerCard({
      item,
      result: 'unknown',
      dueText: '8月19日 10:20',
      learnerName: '陈睿',
    }));
    assert.match(serialized, /"schema":"2.0"/);
    assert.match(serialized, /陈睿/);
    assert.match(serialized, /连贯的/);
    assert.match(serialized, /The argument is coherent/);
    assert.match(serialized, /再来一个/);
  });

  it('统计卡在没有作答时不会产生 NaN', () => {
    const serialized = JSON.stringify(statsCard({
      totalItems: 10,
      learnedItems: 0,
      dueItems: 0,
      totalReviews: 0,
      todayReviews: 0,
      knownReviews: 0,
      unknownReviews: 0,
    }));
    assert.match(serialized, /认识率 0%/);
    assert.doesNotMatch(serialized, /NaN/);
  });
});
