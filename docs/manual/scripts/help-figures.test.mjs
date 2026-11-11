// 도움말 그림 이미지 생성의 순수 부분 테스트(WP-1504 Task 3).
// 해시(낡음 판정)·찍을 페이지 HTML·할 일 계획·검사용 상태·그림 id 규칙을 본다. Chromium 으로 찍는 부분(CLI)은 실제 생성으로 확인한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  FIGURE_IMAGE_VERSION,
  COLUMN_CSS_PX,
  collectFigures,
  figureHash,
  figurePage,
  planFigures,
  figureState,
  manifestText,
  figureInputs,
  readFigureOutput,
} from './lib/help-figures.mjs';
import { collectFigures as bundleCollectFigures } from './lib/help-bundle.mjs';

// 원본 2880x1620(1440 뷰포트 2배 촬영) 샷 두 개짜리 boxes.json 픽스처.
const boxesDoc = {
  'a-1': {
    w: 2880,
    h: 1620,
    boxes: {
      small: { x: 200, y: 200, w: 604, h: 300 }, // 여백 48 을 더하면 자른 폭 700
      side: { x: 900, y: 300, w: 200, h: 100 },
    },
  },
  'b-1': { w: 2880, h: 1620, boxes: { x: { x: 10, y: 10, w: 100, h: 100 } } },
};
const fig = { alt: '그림', src: 'shots/user/a-1.png', shotId: 'a-1', crop: ['small'], marks: ['small'] };
const bytes = Buffer.from('png-bytes');
const base = { shotBytes: bytes, shot: boxesDoc['a-1'], fig };

test('figureHash 는 샷 바이트·boxes 항목·crop·marks 중 하나만 바뀌어도 달라진다', () => {
  const h = figureHash(base);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(figureHash(base), h, '같은 입력이면 같은 해시');
  assert.notEqual(figureHash({ ...base, shotBytes: Buffer.from('png-bytes2') }), h);
  const movedShot = { ...boxesDoc['a-1'], boxes: { ...boxesDoc['a-1'].boxes, side: { x: 901, y: 300, w: 200, h: 100 } } };
  assert.notEqual(figureHash({ ...base, shot: movedShot }), h);
  assert.notEqual(figureHash({ ...base, fig: { ...fig, crop: ['small', 'side'] } }), h);
  assert.notEqual(figureHash({ ...base, fig: { ...fig, marks: ['small!inside'] } }), h);
});

test('figureHash 는 alt·키 순서에는 같다', () => {
  const h = figureHash(base);
  // alt 는 그림에 찍히지 않는다(figcaption 을 찍지 않음).
  assert.equal(figureHash({ ...base, fig: { ...fig, alt: '다른 설명' } }), h);
  // boxes.json 의 키 순서가 바뀌어도(다시 찍기로 순서만 바뀜) 같은 그림이다.
  const reordered = { boxes: { side: boxesDoc['a-1'].boxes.side, small: boxesDoc['a-1'].boxes.small }, h: 1620, w: 2880 };
  assert.equal(figureHash({ ...base, shot: reordered }), h);
});

test('figureHash 는 FIGURE_IMAGE_VERSION 이 들어간다', () => {
  assert.equal(typeof FIGURE_IMAGE_VERSION, 'number');
  assert.notEqual(figureHash({ ...base, version: FIGURE_IMAGE_VERSION + 1 }), figureHash(base));
});

test('figurePage: 좁은 자르기는 단 폭에 비례하고 DSF 로 원본 px 로 되돌린다', () => {
  assert.equal(COLUMN_CSS_PX, 657);
  const p = figurePage(fig, boxesDoc, { shotHref: 'file:///shots/a-1.png', cssHref: 'file:///manual.css' });
  // 자른 폭 700 → 프레임은 단 폭의 700/1400, DSF 는 1400/657 — 결과 PNG 폭 = 700px.
  assert.ok(Math.abs(p.frameCssWidth - 657 * 0.5) < 1e-9);
  assert.equal(p.deviceScaleFactor, 1400 / 657);
  assert.ok(Math.abs(p.frameCssWidth * p.deviceScaleFactor - 700) < 1e-6);
  assert.match(p.html, /<span class="mark" data-pos="[a-z]+">1<\/span>/);
  assert.match(p.html, /<link rel="stylesheet" href="file:\/\/\/manual\.css">/);
  assert.match(p.html, /<img src="file:\/\/\/shots\/a-1\.png"/);
  // figcaption 은 찍지 않는다(alt 는 묶음 데이터로 따로 있다).
  assert.doesNotMatch(p.html, /<figcaption/);
});

test('figurePage: 단 폭보다 넓은 자르기는 프레임 657, DSF 자른폭/657', () => {
  const full = { ...fig, crop: [], marks: [] };
  const p = figurePage(full, boxesDoc, { shotHref: 's.png', cssHref: 'm.css' });
  assert.equal(p.frameCssWidth, 657);
  assert.equal(p.deviceScaleFactor, 2880 / 657);
});

test('figurePage: HTML 속성에 넣는 경로를 이스케이프한다', () => {
  const p = figurePage(fig, boxesDoc, { shotHref: 'a"b.png', cssHref: 'c"d.css' });
  assert.match(p.html, /href="c&quot;d\.css"/);
  assert.match(p.html, /src="a&quot;b\.png"/);
});

test('planFigures: 해시·파일·manifest 로 render/fresh/remove 를 가른다', () => {
  const figures = [{ id: 'same' }, { id: 'changed' }, { id: 'nofile' }, { id: 'new' }, { id: 'nosrc' }];
  const manifest = {
    same: { hash: 'h1', w: 1, h: 1 },
    changed: { hash: 'old', w: 1, h: 1 },
    nofile: { hash: 'h3', w: 1, h: 1 },
    gone: { hash: 'x', w: 1, h: 1 },
  };
  // nosrc 는 원본 샷이 없어 해시를 못 냈다 — 어느 목록에도 넣지 않는다(CLI 가 건너뜀 목록으로 보인다).
  const hashes = { same: 'h1', changed: 'h2', nofile: 'h3', new: 'h4' };
  const existingFiles = new Set(['same', 'changed', 'orphan']);
  const plan = planFigures({ figures, manifest, hashes, existingFiles });
  assert.deepEqual(plan.fresh, ['same']);
  assert.deepEqual(plan.render, ['changed', 'nofile', 'new']);
  // manifest 에만 있는 id, 파일만 남은 id 모두 지운다(정렬).
  assert.deepEqual(plan.remove, ['gone', 'orphan']);
});

test('planFigures: all 이면 해시가 같아도 모두 다시 만든다', () => {
  const plan = planFigures({
    figures: [{ id: 'a' }],
    manifest: { a: { hash: 'h', w: 1, h: 1 } },
    hashes: { a: 'h' },
    existingFiles: new Set(['a']),
    all: true,
  });
  assert.deepEqual(plan, { render: ['a'], remove: [], fresh: [] });
});

test('figureState: 파일 없는 그림은 missing, 해시가 다른 그림은 stale', () => {
  const state = figureState({
    figures: [{ id: 'ok' }, { id: 'old' }, { id: 'absent' }, { id: 'nomanifest' }, { id: 'nosrc' }],
    manifest: { ok: { hash: 'a' }, old: { hash: 'b' }, nosrc: { hash: 'z' } },
    hashes: { ok: 'a', old: 'c', absent: 'd', nomanifest: 'e' },
    existingFiles: new Set(['ok', 'old', 'nomanifest', 'nosrc']),
  });
  assert.deepEqual(state.missing, ['absent']);
  // manifest 항목이 없는 PNG 도 무엇으로 만들었는지 모르므로 오래됨. 해시를 못 낸 그림(nosrc)은 판정하지 않는다.
  assert.deepEqual(state.stale, ['old', 'nomanifest']);
});

test('manifestText: 키 정렬·끝 줄바꿈으로 결정적이다', () => {
  const text = manifestText({ b: { hash: 'y', w: 2, h: 3 }, a: { hash: 'x', w: 1, h: 1 } });
  assert.equal(text, '{\n  "a": {\n    "hash": "x",\n    "w": 1,\n    "h": 1\n  },\n  "b": {\n    "hash": "y",\n    "w": 2,\n    "h": 3\n  }\n}\n');
});

test('collectFigures: 묶음 생성과 같은 함수이고 같은 샷 두 번째는 ~2', () => {
  assert.equal(collectFigures, bundleCollectFigures);
  const line = '![그림](shots/user/a-1.png){crop=small}';
  const chapters = [
    { file: '01-a.md', number: 1, meta: { slug: 'a', title: 'A' }, body: `# A\n\n${line}\n\n## 절\n\n${line}\n` },
    { file: '02-b.md', number: 2, meta: { slug: 'b', title: 'B' }, body: `# B\n\n${line}\n` },
  ];
  assert.deepEqual(
    collectFigures(chapters).map((f) => f.id),
    ['a-1', 'a-1~2', 'a-1~3'],
  );
});

test('figureInputs: 원본이 있으면 figureHash 와 같은 해시, 없거나 상자가 틀리면 skipped', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'help-fig-in-'));
  t.after(() => rm(dir, { recursive: true, force: true })); // 임시 폴더를 남기지 않는다
  await mkdir(path.join(dir, 'shots', 'user'), { recursive: true });
  await writeFile(path.join(dir, 'shots', 'user', 'a-1.png'), bytes);
  const figures = [
    { id: 'a-1', fig, file: '01-a.md', line: 3 },
    { id: 'b-1', fig: { ...fig, src: 'shots/user/b-1.png', shotId: 'b-1', crop: [], marks: [] }, file: '01-a.md', line: 5 },
    { id: 'a-1~2', fig: { ...fig, marks: ['nope'] }, file: '01-a.md', line: 7 },
  ];
  const r = await figureInputs(figures, boxesDoc, { manualDir: dir, book: 'user' });
  assert.deepEqual(r.hashes, { 'a-1': figureHash(base) });
  assert.equal(r.skipped.length, 2);
  assert.match(r.skipped[0], /^b-1 \(01-a\.md:5\) 원본 샷이 없습니다/);
  assert.match(r.skipped[1], /^a-1~2 \(01-a\.md:7\)/);
});

test('figureInputs: 다른 샷의 boxes 항목이 바뀌어도 이 그림 해시는 같다(그 샷 항목만 해시에 넣는다)', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'help-fig-other-'));
  t.after(() => rm(dir, { recursive: true, force: true })); // 임시 폴더를 남기지 않는다
  await mkdir(path.join(dir, 'shots', 'user'), { recursive: true });
  await writeFile(path.join(dir, 'shots', 'user', 'a-1.png'), bytes);
  const figures = [{ id: 'a-1', fig, file: '01-a.md', line: 3 }];
  const before = await figureInputs(figures, boxesDoc, { manualDir: dir, book: 'user' });
  // b-1 상자를 옮기고, 다시 a-1 의 상자를 옮겨 대조군으로 쓴다 — 앞의 것은 같고 뒤의 것은 달라야 진짜로 샷별로 나눈 것이다.
  const otherChanged = { ...boxesDoc, 'b-1': { ...boxesDoc['b-1'], boxes: { x: { x: 11, y: 10, w: 100, h: 100 } } } };
  const after = await figureInputs(figures, otherChanged, { manualDir: dir, book: 'user' });
  assert.equal(after.hashes['a-1'], before.hashes['a-1']);
  const selfChanged = { ...boxesDoc, 'a-1': { ...boxesDoc['a-1'], boxes: { ...boxesDoc['a-1'].boxes, side: { x: 901, y: 300, w: 200, h: 100 } } } };
  const changed = await figureInputs(figures, selfChanged, { manualDir: dir, book: 'user' });
  assert.notEqual(changed.hashes['a-1'], before.hashes['a-1']);
});

test('readFigureOutput: manifest·PNG 목록, 폴더가 없으면 비어 있다', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'help-fig-out-'));
  t.after(() => rm(dir, { recursive: true, force: true })); // 임시 폴더를 남기지 않는다
  await writeFile(path.join(dir, 'manifest.json'), JSON.stringify({ x: { hash: 'h', w: 1, h: 1 } }));
  await writeFile(path.join(dir, 'x.png'), 'p');
  await writeFile(path.join(dir, 'y~2.png'), 'p');
  await writeFile(path.join(dir, 'note.txt'), 't');
  const r = await readFigureOutput(dir);
  assert.deepEqual(r.manifest, { x: { hash: 'h', w: 1, h: 1 } });
  assert.deepEqual([...r.existingFiles].sort(), ['x', 'y~2']);
  const empty = await readFigureOutput(path.join(dir, 'none'));
  assert.deepEqual(empty, { manifest: {}, existingFiles: new Set() });
});
