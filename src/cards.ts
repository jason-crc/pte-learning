import type { ReviewResult, StudyItem, UserStats } from './types.js';

type Card = Record<string, unknown>;

export function studyCard(item: StudyItem): Card {
  const details = [item.phonetic, item.partOfSpeech].filter(Boolean).join('  ·  ');
  return {
    config: { wide_screen_mode: true, update_multi: false },
    header: {
      template: 'blue',
      title: { tag: 'plain_text', content: 'PTE 碎片学习 · 单词' },
    },
    elements: [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**${escapeMarkdown(item.word)}**${details ? `\n${escapeMarkdown(details)}` : ''}`,
        },
      },
      { tag: 'hr' },
      {
        tag: 'div',
        text: { tag: 'plain_text', content: '先在脑中回忆它的含义，再选择：' },
      },
      {
        tag: 'action',
        layout: 'bisected',
        actions: [
          {
            tag: 'button',
            type: 'primary',
            text: { tag: 'plain_text', content: '认识' },
            value: { action: 'review', item_id: String(item.id), result: 'known' },
          },
          {
            tag: 'button',
            type: 'danger',
            text: { tag: 'plain_text', content: '不认识' },
            value: { action: 'review', item_id: String(item.id), result: 'unknown' },
          },
        ],
      },
      {
        tag: 'note',
        elements: [{ tag: 'plain_text', content: '不用纠结，诚实作答才能让复习节奏更准。' }],
      },
    ],
  };
}

export function answerCard(input: {
  item: StudyItem;
  result: ReviewResult;
  dueText: string;
  showNextButton?: boolean;
  autoPushMinutes?: number;
}): Card {
  const known = input.result === 'known';
  const elements: Record<string, unknown>[] = [
    {
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `**${escapeMarkdown(input.item.word)}**  ${escapeMarkdown(input.item.phonetic)}  ${escapeMarkdown(input.item.partOfSpeech)}`.trim(),
      },
    },
    {
      tag: 'div',
      text: { tag: 'lark_md', content: `**释义：** ${escapeMarkdown(input.item.meaningZh)}` },
    },
  ];

  if (input.item.example) {
    elements.push({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `**例句：** ${escapeMarkdown(input.item.example)}${
          input.item.exampleZh ? `\n${escapeMarkdown(input.item.exampleZh)}` : ''
        }`,
      },
    });
  }

  elements.push({
    tag: 'note',
    elements: [{ tag: 'plain_text', content: `下次复习：${input.dueText}` }],
  });

  if (input.autoPushMinutes !== undefined) {
    elements.push({
      tag: 'note',
      elements: [{
        tag: 'plain_text',
        content: `已完成回答，${input.autoPushMinutes} 分钟后自动推送下一张学习卡。`,
      }],
    });
  }

  if (input.showNextButton !== false) {
    elements.push({
      tag: 'action',
      actions: [
        {
          tag: 'button',
          type: 'primary',
          text: { tag: 'plain_text', content: '再来一个' },
          value: {
            action: 'next',
            item_id: String(input.item.id),
            result: input.result,
          },
        },
      ],
    });
  }

  return {
    config: { wide_screen_mode: true, update_multi: false },
    header: {
      template: known ? 'green' : 'orange',
      title: {
        tag: 'plain_text',
        content: known ? '答得不错，记忆已加固' : '现在认识了，很快再见一次',
      },
    },
    elements,
  };
}

export function statsCard(stats: UserStats): Card {
  const attempts = stats.knownReviews + stats.unknownReviews;
  const accuracy = attempts === 0 ? 0 : Math.round((stats.knownReviews / attempts) * 100);
  return {
    config: { wide_screen_mode: true },
    header: {
      template: 'turquoise',
      title: { tag: 'plain_text', content: 'PTE 学习统计' },
    },
    elements: [
      {
        tag: 'div',
        fields: [
          { is_short: true, text: { tag: 'lark_md', content: `**今日复习**\n${stats.todayReviews} 次` } },
          { is_short: true, text: { tag: 'lark_md', content: `**累计复习**\n${stats.totalReviews} 次` } },
          { is_short: true, text: { tag: 'lark_md', content: `**已学单词**\n${stats.learnedItems}/${stats.totalItems}` } },
          { is_short: true, text: { tag: 'lark_md', content: `**当前待复习**\n${stats.dueItems} 个` } },
        ],
      },
      { tag: 'hr' },
      {
        tag: 'note',
        elements: [{ tag: 'plain_text', content: `认识率 ${accuracy}% · 数据来自你的真实点击记录` }],
      },
    ],
  };
}

function escapeMarkdown(value: string): string {
  return value.replace(/([*_`~])/g, '\\$1');
}
