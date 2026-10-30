// 촬영 도구의 순수 함수(좌표 변환·합집합·병합)와 촬영 기록기 테스트. 브라우저는 필요 없다(가짜 page·locator).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { clampBox, createShotRecorder, redactRects, toOriginalBox } from './lib/capture-kit.mjs';
import { unionBoxes } from './lib/figure.mjs';
import { mergeBoxesDoc } from './lib/boxes-file.mjs';

test('toOriginalBox scales and rounds', () => {
  assert.deepEqual(toOriginalBox({ x: 10.4, y: 20.6, width: 100.2, height: 50 }), { x: 21, y: 41, w: 200, h: 100 });
});

test('unionBoxes covers all boxes', () => {
  const u = unionBoxes([
    { x: 10, y: 20, w: 30, h: 40 },
    { x: 100, y: 5, w: 20, h: 10 },
  ]);
  assert.deepEqual(u, { x: 10, y: 5, w: 110, h: 55 });
});

test('mergeBoxesDoc replaces whole shot entries', () => {
  const b = { x: 1, y: 1, w: 1, h: 1 };
  const prev = { s: { w: 1, h: 1, boxes: { old: b } }, t: { w: 1, h: 1, boxes: { keep: b } } };
  const next = { s: { w: 1, h: 1, boxes: { new: b } } };
  const merged = mergeBoxesDoc(prev, next);
  assert.equal('old' in merged.s.boxes, false);
  assert.deepEqual(merged.s.boxes.new, b);
  assert.deepEqual(merged.t, prev.t);
});

test('unknownShotIds lists ids without a scene', async () => {
  const { unknownShotIds } = await import('./lib/capture-kit.mjs');
  const scenes = [{ id: 'a' }, { id: 'b' }];
  assert.deepEqual(unknownShotIds(new Set(['a', 'x', 'y']), scenes), ['x', 'y']);
  assert.deepEqual(unknownShotIds(null, scenes), []);
});

// 가짜 page: 스크린샷은 받은 경로에 작은 파일(내용 = content)을 쓰고, 뷰포트를 알려 준다.
const fakePage = (content = 'new') => ({
  screenshot: async ({ path: p }) => writeFile(p, content),
  viewportSize: () => ({ width: 1440, height: 810 }),
});
// 가짜 locator: first().boundingBox() 가 상자(CSS px) 또는 null 을 Promise 로 돌려준다(실제 API 처럼 .catch 가능해야 한다).
const fakeLocator = (box) => ({ first: () => ({ boundingBox: async () => box }) });

// 기록기가 쓰는 폴더는 매번 새 임시 폴더다 — 실제 docs/manual/shots 를 건드리지 않게 반드시 dir 을 넘긴다.
async function withTempDir(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'manual-rec-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('createShotRecorder discards entries of a failed scene', async () => {
  await withTempDir(async (dir) => {
    const keep = { w: 1, h: 1, boxes: {} };
    await writeFile(path.join(dir, 'boxes.json'), JSON.stringify({ old: keep }));
    const rec = createShotRecorder({ book: 'user', dir });
    const log = console.log;
    console.log = () => {}; // shoot 의 진행 출력을 시험 결과에 섞지 않는다
    try {
      // 성공한 장면: 좌표가 확정된다.
      await rec.begin();
      await rec.mark('ok', 'k', fakeLocator({ x: 10, y: 20, width: 30, height: 40 }));
      await rec.shoot(fakePage(), 'ok');
      await rec.commit();
      // 실패한 장면: 새 샷과, 앞 장면이 확정한 샷에 덧붙인 키 모두 버려져야 한다.
      await rec.begin();
      await rec.mark('bad', 'k', fakeLocator({ x: 1, y: 1, width: 1, height: 1 }));
      await rec.mark('ok', 'extra', fakeLocator({ x: 1, y: 1, width: 1, height: 1 }));
      await assert.rejects(rec.mark('bad', 'gone', fakeLocator(null)), /bad:gone/);
      await rec.discard();
      await rec.save();
    } finally {
      console.log = log;
    }
    const saved = JSON.parse(await readFile(path.join(dir, 'boxes.json'), 'utf8'));
    assert.deepEqual(Object.keys(saved).sort(), ['ok', 'old']);
    assert.deepEqual(saved.old, keep);
    assert.deepEqual(saved.ok, { w: 2880, h: 1620, boxes: { k: { x: 20, y: 40, w: 60, h: 80 } } });
  });
});

/** pad(CSS px)는 상자를 사방으로 넓히고(원본 px = pad x 배율 2), 넓힌 상자도 그림 경계로 자른다. */
test('createShotRecorder mark grows the box by pad and clamps it to the image', async () => {
  await withTempDir(async (dir) => {
    const rec = createShotRecorder({ book: 'user', dir });
    const log = console.log;
    console.log = () => {};
    try {
      await rec.begin();
      await rec.mark('p', 'mid', fakeLocator({ x: 10, y: 20, width: 30, height: 40 }), { pad: 4 });
      await rec.mark('p', 'edge', fakeLocator({ x: 0, y: 0, width: 10, height: 10 }), { pad: 4 });
      await rec.shoot(fakePage(), 'p');
      await rec.commit();
      await rec.save();
    } finally {
      console.log = log;
    }
    const saved = JSON.parse(await readFile(path.join(dir, 'boxes.json'), 'utf8'));
    assert.deepEqual(saved.p.boxes.mid, { x: 12, y: 32, w: 76, h: 96 });
    assert.deepEqual(saved.p.boxes.edge, { x: 0, y: 0, w: 28, h: 28 });
  });
});

test('createShotRecorder does not write boxes.json when nothing was committed', async () => {
  await withTempDir(async (dir) => {
    const rec = createShotRecorder({ book: 'user', dir });
    await rec.begin();
    await rec.mark('s', 'k', fakeLocator({ x: 1, y: 1, width: 1, height: 1 }));
    await rec.discard();
    await rec.save();
    await assert.rejects(readFile(path.join(dir, 'boxes.json')), { code: 'ENOENT' });
  });
});

test('createShotRecorder keeps old png when the scene fails', async () => {
  await withTempDir(async (dir) => {
    await writeFile(path.join(dir, 's.png'), 'old');
    const rec = createShotRecorder({ book: 'user', dir });
    const log = console.log;
    console.log = () => {};
    try {
      // 실패한 장면: 새로 찍은 그림은 임시 파일로만 남았다가 discard 에서 지워진다.
      await rec.begin();
      await rec.shoot(fakePage('failed'), 's');
      await rec.discard();
      assert.equal(await readFile(path.join(dir, 's.png'), 'utf8'), 'old');
      assert.deepEqual((await readdir(dir)).sort(), ['s.png']);
      // 성공한 장면: commit 이 임시 파일을 제 이름으로 옮긴다.
      await rec.begin();
      await rec.shoot(fakePage('ok'), 's');
      assert.equal(await readFile(path.join(dir, 's.png'), 'utf8'), 'old'); // 확정 전에는 그대로
      await rec.commit();
    } finally {
      console.log = log;
    }
    assert.equal(await readFile(path.join(dir, 's.png'), 'utf8'), 'ok');
    assert.deepEqual((await readdir(dir)).sort(), ['s.png']);
  });
});

test('clampBox trims to image bounds and rejects boxes fully outside', () => {
  assert.deepEqual(clampBox({ x: -10, y: 1500, w: 100, h: 500 }, 2880, 1620), { x: 0, y: 1500, w: 90, h: 120 });
  assert.equal(clampBox({ x: 3000, y: 0, w: 10, h: 10 }, 2880, 1620), null);
});

test('createShotRecorder clamps marks to the viewport and rejects offscreen targets', async () => {
  await withTempDir(async (dir) => {
    const rec = createShotRecorder({ book: 'user', dir });
    await rec.begin();
    // 아래로 화면 밖까지 이어진 요소: 그림 경계(1620)에서 자른다.
    await rec.mark('s', 'long', fakeLocator({ x: 10, y: 700, width: 100, height: 400 }));
    // 완전히 화면 밖(스크롤 아래)인 요소는 화면에 없는 것과 같다.
    await assert.rejects(rec.mark('s', 'below', fakeLocator({ x: 10, y: 900, width: 10, height: 10 })), /s:below 표시 대상이 화면에 없다/);
    await rec.commit();
    await rec.save();
    const saved = JSON.parse(await readFile(path.join(dir, 'boxes.json'), 'utf8'));
    assert.deepEqual(saved.s.boxes, { long: { x: 20, y: 1400, w: 200, h: 220 } });
  });
});

test('createShotRecorder rolls back pngs when a rename fails during commit', async () => {
  await withTempDir(async (dir) => {
    await writeFile(path.join(dir, 'a.png'), 'old-a');
    await writeFile(path.join(dir, 'b.png'), 'old-b');
    // 두 번째 그림(b)의 새 PNG 를 들이는 이동만 실패시킨다 — a 는 이미 바뀐 뒤라 되돌려야 한다.
    const failingRename = async (from, to) => {
      if (from.endsWith('b.png.tmp')) throw Object.assign(new Error('디스크 오류'), { code: 'EIO' });
      return rename(from, to);
    };
    const rec = createShotRecorder({ book: 'user', dir, fs: { access, rename: failingRename, rm } });
    const log = console.log;
    console.log = () => {};
    try {
      await rec.begin();
      await rec.shoot(fakePage('new-a'), 'a');
      await rec.shoot(fakePage('new-b'), 'b');
      await assert.rejects(rec.commit(), /디스크 오류/);
      await rec.discard(); // capture.mjs 처럼 실패한 장면은 버린다
      await rec.save();
    } finally {
      console.log = log;
    }
    assert.equal(await readFile(path.join(dir, 'a.png'), 'utf8'), 'old-a');
    assert.equal(await readFile(path.join(dir, 'b.png'), 'utf8'), 'old-b');
    // .bak·.tmp 가 남지 않고, 확정된 좌표가 없으니 boxes.json 도 쓰지 않는다.
    assert.deepEqual((await readdir(dir)).sort(), ['a.png', 'b.png']);
  });
});

test('createShotRecorder commit fails before touching pngs when a staged file is missing', async () => {
  await withTempDir(async (dir) => {
    await writeFile(path.join(dir, 'a.png'), 'old-a');
    const rec = createShotRecorder({ book: 'user', dir });
    const log = console.log;
    console.log = () => {};
    try {
      await rec.begin();
      // 스크린샷이 파일을 남기지 않은 경우(가짜 page 가 아무것도 쓰지 않음).
      await rec.shoot({ screenshot: async () => {}, viewportSize: () => ({ width: 1440, height: 810 }) }, 'a');
      await assert.rejects(rec.commit(), { code: 'ENOENT' });
    } finally {
      console.log = log;
    }
    assert.equal(await readFile(path.join(dir, 'a.png'), 'utf8'), 'old-a');
  });
});

test('createShotRecorder save refuses to overwrite a corrupt boxes.json', async () => {
  await withTempDir(async (dir) => {
    // 깨진 파일을 빈 문서로 보고 덮어쓰면 다른 샷 좌표가 조용히 사라진다 — 오류로 멈춰야 한다.
    await writeFile(path.join(dir, 'boxes.json'), '{ "old": ');
    const rec = createShotRecorder({ book: 'user', dir });
    await rec.begin();
    await rec.mark('s', 'k', fakeLocator({ x: 1, y: 1, width: 1, height: 1 }));
    await rec.commit();
    await assert.rejects(rec.save(), /boxes\.json 을 읽지 못해 덮어쓰지 않습니다/);
    assert.equal(await readFile(path.join(dir, 'boxes.json'), 'utf8'), '{ "old": ');
  });
});

// 책별 촬영 설정: 운영자 콘솔은 플랫폼 API·data-testid 아이디 칸, 사용자 앱은 /api/v1·placeholder 아이디 칸(WP-1195).
test('BOOKS capture config picks api base and login field per book', async () => {
  const { BOOKS } = await import('./lib/books.mjs');
  assert.equal(BOOKS.user.capture.apiBase, '/api/v1');
  assert.equal(BOOKS.operator.capture.apiBase, '/api/platform');
  assert.equal(BOOKS.user.capture.usernameSelector, 'input[placeholder="아이디를 입력하세요"]');
  assert.equal(BOOKS.operator.capture.usernameSelector, '[data-testid="login-username"]');
});

// 책 설정 뷰포트(운영자 900x810): shoot 전에 mark 한 상자도 그 그림 크기(원본 1800x1620)로 잘린다(WP-1195).
/** 장면이 뷰포트를 바꾸면(모바일 390 폭) 표식은 책 기본 뷰포트가 아니라 지금 페이지 뷰포트로 잘린다. */
test('createShotRecorder clamps marks to the page viewport when a scene resizes it', async () => {
  await withTempDir(async (dir) => {
    const rec = createShotRecorder({ book: 'user', dir });
    const page = { ...fakePage(), viewportSize: () => ({ width: 390, height: 844 }) };
    const loc = { ...fakeLocator({ x: 0, y: 100, width: 394, height: 20 }), page: () => page };
    const log = console.log;
    console.log = () => {};
    try {
      await rec.begin();
      await rec.mark('m', 'bar', loc, { pad: 4 });
      await rec.shoot(page, 'm');
      await rec.commit();
      await rec.save();
    } finally {
      console.log = log;
    }
    const saved = JSON.parse(await readFile(path.join(dir, 'boxes.json'), 'utf8'));
    assert.deepEqual(saved.m, { w: 780, h: 1688, boxes: { bar: { x: 0, y: 192, w: 780, h: 56 } } });
  });
});

test('createShotRecorder clamps marks to the book viewport', async () => {
  await withTempDir(async (dir) => {
    const rec = createShotRecorder({ book: 'operator', dir, viewport: { width: 900, height: 810 } });
    const log = console.log;
    console.log = () => {};
    try {
      await rec.begin();
      await rec.mark('s', 'wide', fakeLocator({ x: 800, y: 10, width: 300, height: 20 }));
      await rec.shoot({ ...fakePage(), viewportSize: () => ({ width: 900, height: 810 }) }, 's');
      await rec.commit();
      await rec.save();
    } finally {
      console.log = log;
    }
    const saved = JSON.parse(await readFile(path.join(dir, 'boxes.json'), 'utf8'));
    assert.deepEqual(saved.s, { w: 1800, h: 1620, boxes: { wide: { x: 1600, y: 20, w: 200, h: 40 } } });
  });
});

// 사용자 책은 뷰포트를 지정하지 않는다 — 기록기·컨텍스트가 1440x810 으로 돌아가야 한다(WP-1195).
test('user book has no viewport and falls back to 1440x810', async () => {
  const { BOOKS } = await import('./lib/books.mjs');
  const { newShotContext } = await import('./lib/capture-kit.mjs');
  assert.equal(BOOKS.user.capture.viewport, undefined);
  // 컨텍스트: viewport 가 undefined 면 기본 뷰포트로 열고, 모든 문서에 촬영 스타일(토스트 숨김·애니메이션 0초)을 넣는다.
  let opts;
  let style;
  const context = { addInitScript: async (_fn, css) => (style = css) };
  assert.equal(await newShotContext({ newContext: async (o) => ((opts = o), context) }, BOOKS.user.capture.viewport), context);
  assert.deepEqual(opts.viewport, { width: 1440, height: 810 });
  assert.equal(opts.deviceScaleFactor, 2);
  assert.match(style, /\[data-sonner-toaster\] \{ display: none !important; \}/);
  assert.match(style, /animation-duration: 0s !important/);
  assert.match(style, /transition-duration: 0s !important/);
  // 기록기: shoot 전에 mark 한 상자는 2880x1620 경계로 잘린다.
  await withTempDir(async (dir) => {
    const rec = createShotRecorder({ book: 'user', dir, viewport: BOOKS.user.capture.viewport });
    await rec.begin();
    await rec.mark('s', 'k', fakeLocator({ x: 1400, y: 800, width: 100, height: 100 }));
    await rec.commit();
    await rec.save();
    const saved = JSON.parse(await readFile(path.join(dir, 'boxes.json'), 'utf8'));
    assert.deepEqual(saved.s, { w: 2880, h: 1620, boxes: { k: { x: 2800, y: 1600, w: 80, h: 20 } } });
  });
});

// 한 장면이 여러 그림을 찍으면 shots 로 밝힌다 — 그림 id 로 골라도 그 장면이 돌아야 한다(WP-1195).
test('selectScenes and unknownShotIds resolve declared shot ids to their scene', async () => {
  const { selectScenes, unknownShotIds } = await import('./lib/capture-kit.mjs');
  // shots 가 없는 장면은 장면 id 하나만 찍는다.
  const scenes = [{ id: 'a' }, { id: 'p7', shots: ['p7', 'p8', 'p6'] }];
  assert.deepEqual(unknownShotIds(new Set(['a']), scenes), []);
  assert.deepEqual(selectScenes(null, scenes), scenes);
  assert.deepEqual(selectScenes(new Set(['p8']), scenes).map((s) => s.id), ['p7']);
  assert.deepEqual(selectScenes(new Set(['p6', 'a']), scenes).map((s) => s.id), ['a', 'p7']);
  assert.deepEqual(unknownShotIds(new Set(['p6', 'p9', 'a']), scenes), ['p9']);
});

// 다시 찍은 샷은 빈 항목에서 시작한다 — 예전 확정본의 다른 w/h 와 남은 키가 섞이면 안 된다(WP-1195).
test('createShotRecorder starts a reshot from an empty entry', async () => {
  await withTempDir(async (dir) => {
    const old = { w: 2880, h: 1620, boxes: { stale: { x: 1, y: 1, w: 1, h: 1 }, k: { x: 9, y: 9, w: 9, h: 9 } } };
    await writeFile(path.join(dir, 'boxes.json'), JSON.stringify({ s: old }));
    const rec = createShotRecorder({ book: 'operator', dir, viewport: { width: 900, height: 810 } });
    const log = console.log;
    console.log = () => {};
    try {
      // 같은 실행에서 앞 장면이 확정한 샷을 다시 찍어도 그 장면의 키가 섞이지 않는다.
      await rec.begin();
      await rec.mark('s', 'first', fakeLocator({ x: 1, y: 1, width: 1, height: 1 }));
      await rec.commit();
      await rec.begin();
      await rec.mark('s', 'k', fakeLocator({ x: 10, y: 20, width: 30, height: 40 }));
      await rec.shoot({ ...fakePage(), viewportSize: () => ({ width: 900, height: 810 }) }, 's');
      await rec.commit();
      await rec.save();
    } finally {
      console.log = log;
    }
    const saved = JSON.parse(await readFile(path.join(dir, 'boxes.json'), 'utf8'));
    assert.deepEqual(saved.s, { w: 1800, h: 1620, boxes: { k: { x: 20, y: 40, w: 60, h: 80 } } });
  });
});

// 결정적 촬영: shoot 은 입력 커서를 숨긴 채 찍는다(토스트·애니메이션은 촬영 컨텍스트 스타일이 맡는다 — newShotContext)(WP-1195).
test('shoot hides the caret', async () => {
  await withTempDir(async (dir) => {
    let opts;
    const page = { screenshot: async (o) => { opts = o; await writeFile(o.path, 'x'); }, viewportSize: () => ({ width: 1440, height: 810 }) };
    const rec = createShotRecorder({ book: 'user', dir });
    const log = console.log;
    console.log = () => {};
    try {
      await rec.begin();
      await rec.shoot(page, 's');
    } finally {
      console.log = log;
    }
    assert.equal(opts.caret, 'hide');
    assert.equal(opts.animations, undefined); // 애니메이션은 컨텍스트 스타일이 0초로 만든다
    await rec.discard();
  });
});

// redactRects: 실제 계정 장면은 원본 PNG 에서 자르기 영역 밖을 가린다 — 남길 영역(원본 px) 둘레의 네 띠를 CSS px 로 돌려준다.
test('redactRects_whenKeepInside_returnsFourBandsInCssPx', () => {
  const rects = redactRects({ x: 200, y: 100, w: 400, h: 300 }, 2880, 1620, 2);
  assert.deepEqual(rects, [
    { x: 0, y: 0, w: 1440, h: 50 },
    { x: 0, y: 200, w: 1440, h: 610 },
    { x: 0, y: 50, w: 100, h: 150 },
    { x: 300, y: 50, w: 1140, h: 150 },
  ]);
});

// 남길 영역이 그림 가장자리에 붙으면 넓이 0 인 띠는 빠진다(빈 덮개를 만들지 않는다).
test('redactRects_whenKeepTouchesEdges_dropsEmptyBands', () => {
  const rects = redactRects({ x: 0, y: 0, w: 2880, h: 400 }, 2880, 1620, 2);
  assert.deepEqual(rects, [{ x: 0, y: 200, w: 1440, h: 610 }]);
});

// once 장면(실제 AI 호출 — 결과가 매번 달라짐)은 전체 재촬영에서 빠지고, 이름을 적었을 때만 돈다.
test('selectScenes_whenOnceScene_skipsInFullRunButRunsWhenNamed', async () => {
  const { selectScenes } = await import('./lib/capture-kit.mjs');
  const scenes = [{ id: 'a' }, { id: 'ai', once: true }];
  assert.deepEqual(selectScenes(null, scenes).map((s) => s.id), ['a']);
  assert.deepEqual(selectScenes(new Set(['ai']), scenes).map((s) => s.id), ['ai']);
});
