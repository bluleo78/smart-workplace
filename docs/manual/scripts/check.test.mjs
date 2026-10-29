// check.mjs 의 순수 함수(분류·그림 줄 검사)와 lib/markdown.mjs(이모지·산문 줄) 테스트.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chapterLinkErrors, checkFigureLine, classify } from './check.mjs';
import { readBoxesDoc } from './lib/boxes-file.mjs';
import { BOOKS } from './lib/books.mjs';
import { parseFigureLine } from './lib/figure.mjs';
import { hasEmoji, proseLines } from './lib/markdown.mjs';

test('classify reports uncovered, ghost and duplicate routes', () => {
  const r = classify(
    [
      { file: '01-a.md', routes: ['/a', '/me/**', '/gone'] },
      { file: '02-b.md', routes: ['/a'] },
    ],
    ['/a', '/me/x', '/lonely'],
  );
  assert.deepEqual(r.uncovered, ['/lonely']);
  assert.deepEqual(r.ghosts, [{ pattern: '/gone', file: '01-a.md' }]);
  assert.deepEqual(r.duplicates, [{ path: '/a', files: ['01-a.md', '02-b.md'] }]);
});

test('hasEmoji allows arrows and dots but flags emoji', () => {
  for (const ok of ['→ ← ↑ ↓', '▸ 항목', 'a · b', '가 — 나']) assert.equal(hasEmoji(ok), false, ok);
  assert.equal(hasEmoji('좋아요 \u{1F600}'), true);
  assert.equal(hasEmoji('x️'), true);
});

test('proseLines skips fenced code and keeps line numbers', () => {
  const raw = ['a', '```', 'code', '```', 'b'].join('\n');
  assert.deepEqual(proseLines(raw), [[1, 'a'], [5, 'b']]);
});

test('proseLines treats tilde fences as code and closes only on the same fence char', () => {
  // ~~~ 블록 안의 ``` 줄은 예시일 뿐 블록을 닫지 않는다.
  const raw = ['a', '~~~', '```', 'code', '~~~', 'b'].join('\n');
  assert.deepEqual(proseLines(raw), [[1, 'a'], [6, 'b']]);
});

// 그림 줄 검사 픽스처: user 책의 샷 s(상자 a 는 좌상단 근처, b 는 우하단 모서리), 크기 없는 샷 nowh.
const boxesDoc = {
  s: { w: 2880, h: 1620, boxes: { a: { x: 100, y: 100, w: 200, h: 100 }, b: { x: 2800, y: 1500, w: 80, h: 120 } } },
  nowh: { boxes: { a: { x: 100, y: 100, w: 200, h: 100 } } },
};
const allExist = () => true;
const check = (line, opts = {}) =>
  checkFigureLine(parseFigureLine(line), { book: BOOKS.user, boxesDoc, exists: allExist, at: '01-a.md:3', ...opts });

test('checkFigureLine passes a valid figure', () => {
  assert.deepEqual(check('![x](shots/user/s.png){crop=a marks=a}'), []);
});

test('checkFigureLine reports a missing png', () => {
  const errs = check('![x](shots/user/s.png)', { exists: () => false });
  assert.deepEqual(errs, ['[그림 없음] 01-a.md:3 shots/user/s.png']);
});

test('checkFigureLine reports a shot missing from boxes.json', () => {
  assert.deepEqual(check('![x](shots/user/zz.png){marks=a}'), ['[표식 그림 없음] 01-a.md:3 zz']);
});

test('checkFigureLine reports unknown crop and mark keys once each', () => {
  const errs = check('![x](shots/user/s.png){crop=q marks=r}');
  assert.deepEqual(errs, ['[표식 키 없음] 01-a.md:3 s:q', '[표식 키 없음] 01-a.md:3 s:r']);
});

test('checkFigureLine reports a mark outside the crop via renderFigure', () => {
  const errs = check('![x](shots/user/s.png){crop=a marks=b}');
  assert.equal(errs.length, 1);
  assert.match(errs[0], /^\[그림 오류\] 01-a\.md:3 .*s:b.*outside the crop/);
});

test('checkFigureLine reports a shot without width and height via renderFigure', () => {
  const errs = check('![x](shots/user/nowh.png){marks=a}');
  assert.equal(errs.length, 1);
  assert.match(errs[0], /^\[그림 오류\] 01-a\.md:3 .*w\/h.*nowh/);
});

test('checkFigureLine reports a figure from another book', () => {
  const errs = checkFigureLine(parseFigureLine('![x](shots/user/s.png)'), {
    book: BOOKS.operator,
    boxesDoc,
    exists: allExist,
    at: '01-a.md:3',
  });
  assert.deepEqual(errs, ['[그림 책 불일치] 01-a.md:3 shots/user/s.png (검사 중인 책: operator)']);
});

test('chapterLinkErrors reports links to chapters missing from the book', () => {
  const files = new Set(['01-a.md', '02-b.md']);
  const line = '[앞](01-a.md) 와 [절](02-b.md#sec) 와 [없음](09-gone.md) 그리고 ![그림](03-img.md)';
  assert.deepEqual(chapterLinkErrors(line, files, '02-b.md:7'), ['[장 링크 없음] 02-b.md:7 09-gone.md']);
});

test('checkFigureLine skips box checks when boxes.json could not be read', () => {
  assert.deepEqual(check('![x](shots/user/zz.png){marks=a}', { boxesDoc: null }), []);
});

test('readBoxesDoc reports a broken boxes.json instead of throwing', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'manual-boxes-'));
  try {
    const file = path.join(dir, 'boxes.json');
    assert.deepEqual(await readBoxesDoc(file), { doc: {}, error: null }); // 아직 촬영 전
    await writeFile(file, '{ "s": ');
    const r = await readBoxesDoc(file);
    assert.equal(r.doc, null);
    assert.match(r.error, /JSON/);
    await writeFile(file, '{"s":{"w":1,"h":1,"boxes":{}}}');
    assert.deepEqual((await readBoxesDoc(file)).doc, { s: { w: 1, h: 1, boxes: {} } });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
