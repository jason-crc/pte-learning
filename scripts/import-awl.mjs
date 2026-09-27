import { readFile, writeFile } from 'node:fs/promises';

const [datasetPath, headwordsPath, outputPath = 'data/words.json'] = process.argv.slice(2);
if (!datasetPath || !headwordsPath) {
  throw new Error('用法：node scripts/import-awl.mjs <exam-vocab.js> <pte-academic-headwords.tsv> [output]');
}

const [datasetSource, headwordsSource, existingSource] = await Promise.all([
  readFile(datasetPath, 'utf8'),
  readFile(headwordsPath, 'utf8'),
  readFile(outputPath, 'utf8'),
]);

const arrayStart = datasetSource.indexOf('[');
const arrayEnd = datasetSource.lastIndexOf(']');
if (arrayStart < 0 || arrayEnd <= arrayStart) throw new Error('无法解析 exam-vocab.js');

const dataset = JSON.parse(datasetSource.slice(arrayStart, arrayEnd + 1));
const sublists = new Map(
  headwordsSource
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const [sublist, word] = line.split('\t');
      return [word, Number(sublist)];
    }),
);
const pteEntries = dataset.filter((entry) => entry.src?.includes('PTE'));
if (pteEntries.length !== 570 || sublists.size !== 570) {
  throw new Error(`PTE/AWL 源数据数量异常：dataset=${pteEntries.length}, headwords=${sublists.size}`);
}

const existing = JSON.parse(existingSource);
const existingByWord = new Map(existing.map((entry) => [entry.word, entry]));
const imported = pteEntries
  .map((entry) => {
    const word = String(entry.w).toLowerCase();
    const sublist = sublists.get(word);
    if (!sublist) throw new Error(`AWL 子表缺少词条：${word}`);
    const current = existingByWord.get(word);
    const tags = [...new Set([...(current?.tags ?? []), 'pte', 'awl', `awl-${sublist}`])];
    return current
      ? { ...current, tags }
      : {
          slug: word,
          word,
          phonetic: entry.p,
          partOfSpeech: entry.pos,
          meaningZh: entry.zh,
          example: '',
          exampleZh: '',
          tags,
        };
  })
  .sort((left, right) => {
    const sublistDelta = Number(left.tags.find((tag) => /^awl-\d+$/.test(tag))?.slice(4))
      - Number(right.tags.find((tag) => /^awl-\d+$/.test(tag))?.slice(4));
    return sublistDelta || left.word.localeCompare(right.word, 'en');
  });

const importedWords = new Set(imported.map((entry) => entry.word));
const custom = existing.filter((entry) => !importedWords.has(entry.word));
const merged = [...imported, ...custom];
if (new Set(merged.map((entry) => entry.slug)).size !== merged.length) {
  throw new Error('合并后的 slug 不唯一');
}

await writeFile(outputPath, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
console.log(`已生成 ${merged.length} 个词条：AWL/PTE 570 + 自定义补充 ${custom.length}`);
