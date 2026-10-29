// 촬영 도구의 순수 함수(좌표 변환·합집합·병합)와 촬영 기록기 테스트. 브라우저는 필요 없다(가짜 page·locator).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { clampBox, createShotRecorder, toOriginalBox } from './lib/capture-kit.mjs';
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
