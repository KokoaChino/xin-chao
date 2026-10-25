import { readFile, writeFile, mkdir, rename, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { DOMParser } from 'linkedom';
import type { CatalogIndex, Character, WikiCatalogItem } from '../src/types';
import { fetchWikiCatalog, fetchWikiCharacter, parseWikiCharacter, parseWikiResponse, toSummary, wikiBadgeFromContent } from '../src/data/wiki';

Object.assign(globalThis, { DOMParser });

const output = resolve('public/data');
const argumentsList = process.argv.slice(2);
const cachePosition = argumentsList.indexOf('--cache-dir');
const cataloguePosition = argumentsList.indexOf('--catalogue');
const cacheDirectory = cachePosition >= 0 ? argumentsList[cachePosition + 1] : undefined;
const cataloguePath = cataloguePosition >= 0 ? argumentsList[cataloguePosition + 1] : undefined;
if (Boolean(cacheDirectory) !== Boolean(cataloguePath)) {
  throw new Error('离线重建需要同时提供 --cache-dir 与 --catalogue');
}
const sourceMode = cacheDirectory ? 'validated-local-response-cache' : 'anonymous-live-api';
const generatedAt = new Date().toISOString();
let catalogue: WikiCatalogItem[];
if (cataloguePath) {
  const response = parseWikiResponse(await readFile(cataloguePath, 'utf8'));
  const result = response.results as { records: { entryId: string | number; name: string; content?: unknown }[]; total: number };
  if (!Array.isArray(result?.records) || result.records.length !== Number(result.total)) {
    throw new Error('缓存目录不完整');
  }
  catalogue = result.records.map((record) => ({ id: String(record.entryId), name: record.name, wikiBadge: wikiBadgeFromContent(record.content) }));
} else {
  catalogue = await fetchWikiCatalog();
}
if (!catalogue.length || new Set(catalogue.map((item) => item.id)).size !== catalogue.length) {
  throw new Error('角色目录为空或包含重复 ID');
}

const characters: Character[] = new Array(catalogue.length);
const failures: string[] = [];
let nextIndex = 0;
let completed = 0;
async function worker() {
  while (nextIndex < catalogue.length) {
    const index = nextIndex++;
    const item = catalogue[index];
    try {
      if (cacheDirectory) {
        const path = join(cacheDirectory, `${item.id}.json`);
        const response = parseWikiResponse(await readFile(path, 'utf8'));
        characters[index] = parseWikiCharacter(response, item, (await stat(path)).mtime.toISOString());
      } else {
        characters[index] = await fetchWikiCharacter(item);
      }
      completed += 1;
      if (completed % 10 === 0 || completed === catalogue.length) console.log(`角色资料 ${completed}/${catalogue.length}`);
    } catch (error) {
      failures.push(`${item.name} (${item.id}): ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
await Promise.all(Array.from({ length: 3 }, () => worker()));
if (failures.length) throw new Error(`未发布不完整快照：\n${failures.join('\n')}`);

// Validate the full batch before publishing either the index or a character file.
for (const character of characters) {
  if (!character.avatar.url || !character.hero || !character.description) {
    throw new Error(`${character.name}：基础资料校验失败`);
  }
  try {
    const previous = JSON.parse(await readFile(join(output, 'characters', `${character.id}.json`), 'utf8')) as Character;
    for (const field of ['archives', 'treasures', 'stories', 'outfits', 'voices'] as const) {
      if (previous[field].length > 0 && character[field].length === 0) {
        throw new Error(`${character.name}：${field} 从 ${previous[field].length} 变为空，需人工核对后再发布`);
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

await mkdir(join(output, 'characters'), { recursive: true });
for (const character of characters) {
  const file = join(output, 'characters', `${character.id}.json`);
  await writeFile(`${file}.next`, JSON.stringify(character) + '\n', 'utf8');
  await rename(`${file}.next`, file);
}
const index: CatalogIndex = { schemaVersion: 1, generatedAt, characters: characters.map(toSummary) };
await writeFile(join(output, 'index.json.next'), JSON.stringify(index) + '\n', 'utf8');
await rename(join(output, 'index.json.next'), join(output, 'index.json'));

const allVoices = characters.flatMap((character) => character.voices);
const countBy = (values: string[]) => values.reduce<Record<string, number>>((counts, key) => {
  counts[key] = (counts[key] || 0) + 1;
  return counts;
}, {});
const report = {
  generatedAt,
  sourceMode,
  source: 'https://wiki.kurobbs.com/mc/home',
  entryCount: characters.length,
  identityCount: new Set(characters.map((character) => character.identityId)).size,
  previewCharacters: characters.filter((character) => character.isPreview).map((character) => character.name),
  sourceSnapshotEarliest: [...characters.map((character) => character.fetchedAt)].sort()[0],
  sourceSnapshotLatest: [...characters.map((character) => character.fetchedAt)].sort().at(-1),
  archives: characters.reduce((count, character) => count + character.archives.length, 0),
  treasures: characters.reduce((count, character) => count + character.treasures.length, 0),
  stories: characters.reduce((count, character) => count + character.stories.length, 0),
  voiceCount: allVoices.length,
  voiceLanguages: countBy(allVoices.map((voice) => voice.language)),
  voiceCategories: countBy(allVoices.map((voice) => voice.category)),
  uniqueAudioUrls: new Set(allVoices.map((voice) => voice.url)).size,
  artworks: characters.reduce((count, character) => count + character.artworks.length, 0),
  outfits: characters.flatMap((character) => character.outfits.map((outfit) => ({
    character: character.name,
    name: outfit.name,
    images: outfit.images.length,
    voices: outfit.voices.length,
  }))),
  limitations: [
    '语种按实际非空音频链接统计，空白语种标签不视为已收录。',
    '媒体保留官方远程链接，未将全量图片和音频打包到项目。',
    '已有图片原始尺寸来自已核验素材清单，新增素材无已知尺寸时不编造。',
    '来源缺失项目通过每位角色的 syncWarnings 明确记录。',
    '语音 URL 已完整收录，收录不代表逐段播放验证。',
    '人物数据只包含展示字段，不包含编辑者、账号、评分和登录凭据。',
  ],
};
await writeFile(join(output, 'collection-report.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log(JSON.stringify(report, null, 2));
