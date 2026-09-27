import type { ReviewResult, StudyItem, UserStats } from './types.js';

type Card = Record<string, unknown>;

export function studyCard(item: StudyItem, learnerName?: string): Card {
  const details = [item.phonetic, item.partOfSpeech].filter(Boolean).join('  ·  ');
  return {
    schema: '2.0',
    config: {
      update_multi: true,
      width_mode: 'default',
      summary: { content: `${learnerName ? `${learnerName} · ` : ''}${item.word}` },
    },
    header: {
      template: 'blue',
      title: { tag: 'plain_text', content: 'PTE 碎片学习 · 单词' },
      ...(learnerName
        ? { subtitle: { tag: 'plain_text', content: `本卡学员：${learnerName}` } }
        : {}),
      icon: { tag: 'standard_icon', token: 'todo_colorful' },
      text_tag_list: [
        { tag: 'text_tag', text: { tag: 'plain_text', content: '待回答' }, color: 'blue' },
      ],
    },
    body: {
      direction: 'vertical',
      padding: '12px 12px 20px 12px',
      vertical_spacing: '12px',
      elements: [
      {
        tag: 'column_set',
        flex_mode: 'none',
        columns: [{
          tag: 'column',
          width: 'weighted',
          weight: 1,
          background_style: 'blue-50',
          padding: '12px',
          vertical_spacing: '4px',
          elements: [
            ...(learnerName ? [{
              tag: 'markdown',
              content: `<font color='grey'>给 ${escapeMarkdown(learnerName)}</font>`,
              text_size: 'notation',
            }] : []),
            {
              tag: 'markdown',
              content: `# **${escapeMarkdown(item.word)}**${details ? `\n${escapeMarkdown(details)}` : ''}`,
            },
          ],
        }],
      },
      {
        tag: 'markdown',
        content: '先在脑中回忆它的含义，再选择：',
      },
      {
        tag: 'column_set',
        flex_mode: 'bisect',
        horizontal_spacing: '12px',
        columns: [
          buttonColumn('认识', 'primary_filled', {
            action: 'review', item_id: String(item.id), result: 'known',
          }),
          buttonColumn('不认识', 'default', {
            action: 'review', item_id: String(item.id), result: 'unknown',
          }),
        ],
      },
      {
        tag: 'markdown',
        content: "<font color='grey'>不用纠结，诚实作答才能让复习节奏更准。</font>",
        text_size: 'notation',
      },
      ],
    },
  };
}

export function answerCard(input: {
  item: StudyItem;
  result: ReviewResult;
  dueText: string;
  showNextButton?: boolean;
  autoPushMinutes?: number;
  learnerName?: string;
}): Card {
  const known = input.result === 'known';
  const color = known ? 'green' : 'orange';
  const meaningLines = [`**释义：** ${escapeMarkdown(input.item.meaningZh)}`];
  if (input.item.example) {
    meaningLines.push(
      `**例句：** ${escapeMarkdown(input.item.example)}${
        input.item.exampleZh ? `\n${escapeMarkdown(input.item.exampleZh)}` : ''
      }`,
    );
  }

  const statusLines = [`**下次复习：** ${escapeMarkdown(input.dueText)}`];
  if (input.autoPushMinutes !== undefined) {
    statusLines.push(`已完成回答，${input.autoPushMinutes} 分钟后自动推送下一张学习卡。`);
  }

  const elements: Record<string, unknown>[] = [
    {
      tag: 'column_set',
      flex_mode: 'none',
      columns: [{
        tag: 'column',
        width: 'weighted',
        weight: 1,
        background_style: `${color}-50`,
        padding: '12px',
        vertical_spacing: '4px',
        elements: [
          ...(input.learnerName ? [{
            tag: 'markdown',
            content: `<font color='grey'>${escapeMarkdown(input.learnerName)} 的学习结果</font>`,
            text_size: 'notation',
          }] : []),
          {
            tag: 'markdown',
            content: `## **${escapeMarkdown(input.item.word)}**\n${escapeMarkdown(
              [input.item.phonetic, input.item.partOfSpeech].filter(Boolean).join('  ·  '),
            )}`.trim(),
          },
        ],
      }],
    },
    {
      tag: 'markdown',
      content: meaningLines.join('\n\n'),
    },
    {
      tag: 'column_set',
      flex_mode: 'none',
      columns: [{
        tag: 'column',
        width: 'weighted',
        weight: 1,
        background_style: `${color}-50`,
        padding: '12px',
        elements: [{
          tag: 'markdown',
          content: statusLines.join('\n'),
          text_size: 'notation',
        }],
      }],
    },
  ];

  if (input.showNextButton !== false) {
    elements.push({
      tag: 'button',
      type: 'primary_filled',
      width: 'fill',
      text: { tag: 'plain_text', content: '再来一个' },
      behaviors: [{
        type: 'callback',
        value: {
            action: 'next',
            item_id: String(input.item.id),
            result: input.result,
        },
      }],
    });
  }

  return {
    schema: '2.0',
    config: { update_multi: true, width_mode: 'default' },
    header: {
      template: color,
      title: {
        tag: 'plain_text',
        content: known ? '答得不错，记忆已加固' : '现在认识了，很快再见一次',
      },
      ...(input.learnerName
        ? { subtitle: { tag: 'plain_text', content: `学员：${input.learnerName}` } }
        : {}),
      icon: { tag: 'standard_icon', token: 'todo_colorful' },
    },
    body: {
      direction: 'vertical',
      padding: '12px 12px 20px 12px',
      vertical_spacing: '12px',
      elements,
    },
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

function buttonColumn(
  text: string,
  type: 'primary_filled' | 'default',
  value: Record<string, string>,
): Record<string, unknown> {
  return {
    tag: 'column',
    elements: [{
      tag: 'button',
      type,
      width: 'fill',
      text: { tag: 'plain_text', content: text },
      behaviors: [{ type: 'callback', value }],
    }],
  };
}
