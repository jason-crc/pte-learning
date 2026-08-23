import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { WordSeed } from './types.js';

interface RawWord {
  slug?: unknown;
  word?: unknown;
  phonetic?: unknown;
  partOfSpeech?: unknown;
  meaningZh?: unknown;
  example?: unknown;
  exampleZh?: unknown;
  tags?: unknown;
}

export function loadWords(path = resolve(process.cwd(), 'data/words.json')): WordSeed[] {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  if (!Array.isArray(raw)) throw new Error(`${path} 必须包含一个 JSON 数组`);

  const seen = new Set<string>();
  return raw.map((value, index) => {
    if (!value || typeof value !== 'object') throw new Error(`words.json 第 ${index + 1} 项格式错误`);
    const item = value as RawWord;
    const required = ['slug', 'word', 'meaningZh'] as const;
    for (const field of required) {
      if (typeof item[field] !== 'string' || !item[field].trim()) {
        throw new Error(`words.json 第 ${index + 1} 项缺少 ${field}`);
      }
    }
    const slug = String(item.slug).trim();
    if (seen.has(slug)) throw new Error(`words.json 中存在重复 slug: ${slug}`);
    seen.add(slug);

    return {
      slug,
      word: String(item.word).trim(),
      phonetic: typeof item.phonetic === 'string' ? item.phonetic.trim() : '',
      partOfSpeech: typeof item.partOfSpeech === 'string' ? item.partOfSpeech.trim() : '',
      meaningZh: String(item.meaningZh).trim(),
      example: typeof item.example === 'string' ? item.example.trim() : '',
      exampleZh: typeof item.exampleZh === 'string' ? item.exampleZh.trim() : '',
      tags: Array.isArray(item.tags) ? item.tags.filter((tag): tag is string => typeof tag === 'string') : [],
    };
  });
}
