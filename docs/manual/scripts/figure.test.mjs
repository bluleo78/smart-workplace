// 매뉴얼 그림 지시문(자르기·번호 표식) 테스트.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFigureLine, cropRect, renderFigure, markRoom, placeMarks, validateFigure, FULL_WIDTH_PX, CROP_PAD_PX } from './lib/figure.mjs';

// 테스트용 boxes.json 픽스처: 원본 2880x1620, 상자 a(좌상단 근처)·b(우하단 모서리).
const doc = {
  s: {
    w: 2880,
    h: 1620,
    boxes: { a: { x: 100, y: 100, w: 200, h: 100 }, b: { x: 2800, y: 1500, w: 80, h: 120 } },
  },
};

test('parseFigureLine reads crop union and marks', () => {
  assert.deepEqual(parseFigureLine('![담당자](shots/user/s.png){crop=a+b marks=a,b}'), {
    alt: '담당자',
    src: 'shots/user/s.png',
    shotId: 's',
    crop: ['a', 'b'],
    marks: ['a', 'b'],
  });
  const plain = parseFigureLine('![전체](shots/user/s.png)');
  assert.deepEqual(plain.crop, []);
  assert.deepEqual(plain.marks, []);
  assert.equal(parseFigureLine('일반 문장입니다.'), null);
  assert.equal(parseFigureLine('- ![x](shots/user/s.png)'), null);
});

test('cropRect pads the union', () => {
  assert.deepEqual(cropRect(doc.s, ['a'], 32), { x: 68, y: 68, w: 264, h: 164 });
});

test('cropRect clamps padding to image bounds', () => {
  const r = cropRect(doc.s, ['b'], 32);
  assert.equal(r.x + r.w, 2880);
  assert.equal(r.y + r.h, 1620);
});

test('cropRect returns full image when no keys', () => {
  assert.deepEqual(cropRect(doc.s, []), { x: 0, y: 0, w: 2880, h: 1620 });
});

test('renderFigure numbers marks in order', () => {
  const html = renderFigure(
    { alt: '설명', src: 'shots/user/s.png', shotId: 's', crop: [], marks: ['b', 'a'] },
    doc,
  );
  const nums = [...html.matchAll(/class="mark"[^>]*>([^<]*)</g)].map((m) => m[1]);
  assert.deepEqual(nums, ['1', '2']);
  // 자르지 않았으므로 프레임 = 원본. 첫 표식 위치는 b 의 퍼센트.
  const left = Math.round((2800 / 2880) * 100 * 1000) / 1000;
  const top = Math.round((1500 / 1620) * 100 * 1000) / 1000;
  assert.match(html, new RegExp(`left:${left}%;top:${top}%`));
  assert.match(html, /<figcaption>설명<\/figcaption>/);
});

test('renderFigure throws on unknown mark key', () => {
  assert.throws(
    () => renderFigure({ alt: '', src: 'shots/user/s.png', shotId: 's', crop: [], marks: ['zz'] }, doc),
    /s:zz/,
  );
});

test('parseFigureLine rejects unknown attribute', () => {
  assert.throws(() => parseFigureLine('![x](shots/user/s.png){corp=a}'), /corp/);
});

test('renderFigure throws when mark is outside crop', () => {
  assert.throws(
    () => renderFigure({ alt: '', src: 'shots/user/s.png', shotId: 's', crop: ['a'], marks: ['b'] }, doc),
    /s:b.*outside the crop/,
  );
});

test('renderFigure positions image and marks relative to crop', () => {
  const html = renderFigure(
    { alt: '', src: 'shots/user/s.png', shotId: 's', crop: ['a'], marks: ['a'] },
    doc,
  );
  assert.match(html, /width:972\.973%/);
  assert.match(html, /left:-17\.568%/);
  assert.match(html, /top:-26\.531%/);
  assert.match(html, /class="mark-box" style="left:16\.216%;top:24\.49%/);
});

test('renderFigure scales narrow crops to a common text size', () => {
  // 자른 폭이 FULL_WIDTH_PX 보다 좁으면 그 비율만큼의 단 폭, 넓으면 단 폭(100%)에서 멈춘다.
  const narrow = { w: 2880, h: 1620, boxes: { n: { x: 400, y: 400, w: 640 - 2 * CROP_PAD_PX, h: 200 } } };
  const nHtml = renderFigure({ alt: '', src: 'shots/user/n.png', shotId: 'n', crop: ['n'], marks: [] }, { n: narrow });
  const expected = Math.round((640 / FULL_WIDTH_PX) * 100 * 1000) / 1000;
  assert.match(nHtml, new RegExp(`<figure class="shot" style="width:${expected}%">`));
  const wide = renderFigure({ alt: '', src: 'shots/user/s.png', shotId: 's', crop: [], marks: [] }, doc);
  assert.match(wide, /<figure class="shot" style="width:100%">/);
});

// 표식 번호 자리를 뽑아 [번호, data-pos] 로 돌려준다.
const markPositions = (html) => [...html.matchAll(/<span class="mark" data-pos="(\w+)">(\d)</g)].map((m) => [m[2], m[1]]);

test('renderFigure puts the mark at the top-left outside the box by default', () => {
  const s = { w: 2880, h: 1620, boxes: { c: { x: 300, y: 300, w: 100, h: 100 } } };
  const html = renderFigure({ alt: '', src: 'shots/user/t.png', shotId: 't', crop: ['c'], marks: ['c'] }, { t: s });
  assert.deepEqual(markPositions(html), [['1', 'tl']]);
});

test('placeMarks moves to the side when there is no room above or left', () => {
  // 원본 왼쪽 끝(x=0)에 붙은 상자는 왼쪽 자리가 없다 → 오른쪽 위(tr). 위로도 붙어 있으면 오른쪽 가운데(r).
  const shot = { w: 2880, h: 1620, boxes: { a: { x: 0, y: 300, w: 100, h: 100 }, b: { x: 0, y: 0, w: 100, h: 200 } } };
  const full = { x: 0, y: 0, w: 2880, h: 1620 };
  assert.deepEqual(placeMarks(shot, ['a'], full), [{ key: 'a', pos: 'tr' }]);
  assert.deepEqual(placeMarks(shot, ['b'], full), [{ key: 'b', pos: 'r' }]);
});

test('placeMarks skips spots that cover another marked box or badge', () => {
  // 세로로 촘촘한 두 상자(레일 아이콘처럼): 아래 상자의 오른쪽 위 자리는 위 상자 번호와 겹쳐 오른쪽 가운데로 간다.
  const shot = {
    w: 2880,
    h: 1620,
    boxes: { up: { x: 0, y: 600, w: 80, h: 60 }, down: { x: 0, y: 670, w: 80, h: 60 }, side: { x: 400, y: 300, w: 100, h: 100 }, near: { x: 450, y: 440, w: 300, h: 50 } },
  };
  const full = { x: 0, y: 0, w: 2880, h: 1620 };
  assert.deepEqual(placeMarks(shot, ['up', 'down'], full).map((m) => m.pos), ['tr', 'r']);
  // near 의 왼쪽 위 자리는 side 상자를 덮으므로 다음 후보(왼쪽 가운데)로 간다.
  assert.deepEqual(placeMarks(shot, ['side', 'near'], full).map((m) => m.pos), ['tl', 'l']);
});

test('placeMarks ignores a marked container that wraps the box', () => {
  // 컨테이너 안 상자의 번호는 컨테이너 안에 놓일 수밖에 없다 — 컨테이너와 겹치는 것은 문제로 보지 않는다.
  const shot = { w: 2880, h: 1620, boxes: { box: { x: 200, y: 200, w: 800, h: 600 }, inner: { x: 400, y: 400, w: 100, h: 50 } } };
  const crop = { x: 100, y: 100, w: 1000, h: 800 };
  assert.deepEqual(placeMarks(shot, ['box', 'inner'], crop).map((m) => m.pos), ['tl', 'tl']);
});

test('validateFigure reports a mark with no free spot and accepts key!inside', () => {
  // 원본 전체가 상자인 그림: 바깥 자리가 하나도 없다 → 그림 오류. !inside 로 안쪽 오른쪽 위에 두면 통과한다.
  const shot = { t: { w: 2880, h: 1620, boxes: { all: { x: 0, y: 0, w: 2880, h: 1620 } } } };
  const fig = { alt: '', src: 'shots/user/t.png', shotId: 't', crop: [], marks: ['all'] };
  const [p] = validateFigure(fig, shot);
  assert.equal(p.kind, 'figure');
  assert.match(p.message, /t:all.*all!inside/);
  assert.deepEqual(validateFigure({ ...fig, marks: ['all!inside'] }, shot), []);
  assert.deepEqual(markPositions(renderFigure({ ...fig, marks: ['all!inside'] }, shot)), [['1', 'in']]);
  assert.match(validateFigure({ ...fig, marks: ['all!inner'] }, shot)[0].message, /알 수 없는 표식 옵션/);
  assert.match(validateFigure({ ...fig, marks: ['all@up'] }, shot)[0].message, /알 수 없는 표식 옵션/);
});

test('placeMarks honours an explicit @position and validates it', () => {
  // 자동이면 왼쪽 위(tl)지만 @r 이면 오른쪽 가운데. 프레임 밖인 자리를 고르면 그림 오류다.
  const shot = { t: { w: 2880, h: 1620, boxes: { c: { x: 300, y: 300, w: 100, h: 100 }, e: { x: 0, y: 300, w: 100, h: 100 } } } };
  const full = { x: 0, y: 0, w: 2880, h: 1620 };
  assert.deepEqual(placeMarks(shot.t, ['c@r'], full), [{ key: 'c', pos: 'r' }]);
  const fig = { alt: '', src: 'shots/user/t.png', shotId: 't', crop: [], marks: ['e@l'] };
  assert.match(validateFigure(fig, shot)[0].message, /e@l/);
  assert.deepEqual(markPositions(renderFigure({ ...fig, marks: ['c@br'] }, shot)), [['1', 'br']]);
});

test('markRoom grows when the crop is wider than the column', () => {
  // 자른 폭 1400(= FULL_WIDTH_PX)이면 번호 원 자리는 원본 20 x 1400 / 600 ≈ 46.7px(좁은 컨테이너까지 덮는 보수값).
  assert.ok(Math.abs(markRoom(1400) - 46.67) < 0.01);
  assert.equal(markRoom(700), markRoom(1400));
  assert.ok(Math.abs(markRoom(2800) - 93.33) < 0.01);
});

test('cropRect widens the padding for wide crops so a mark fits outside', () => {
  // 자른 폭이 넓으면 번호 원 자리가 48 보다 커진다 — 여백을 그만큼 늘려 바깥 자리를 남긴다.
  const s = { w: 2880, h: 1620, boxes: { wide: { x: 400, y: 400, w: 1800, h: 200 } } };
  const c = cropRect(s, ['wide']);
  const pad = 400 - c.x;
  assert.ok(pad >= markRoom(c.w) && pad > CROP_PAD_PX);
  // 좁은 자르기는 기본 여백 그대로다.
  const narrow = { w: 2880, h: 1620, boxes: { n: { x: 400, y: 400, w: 600, h: 200 } } };
  assert.equal(cropRect(narrow, ['n']).x, 400 - CROP_PAD_PX);
});

test('renderFigure throws when the shot has no width or height', () => {
  const noSize = { n: { boxes: { a: { x: 0, y: 0, w: 10, h: 10 } } } };
  assert.throws(
    () => renderFigure({ alt: '', src: 'shots/user/n.png', shotId: 'n', crop: [], marks: [] }, noSize),
    /w\/h.*n/,
  );
});

test('validateFigure collects every problem with its kind', () => {
  // 다른 책 경로 + 모르는 키 두 개: 키 문제는 키마다 한 번, 키가 틀리면 자르기 검사는 하지 않는다.
  const fig = { alt: '', src: 'shots/user/s.png', shotId: 's', crop: ['q'], marks: ['q', 'r'] };
  assert.deepEqual(
    validateFigure(fig, doc, { book: 'operator' }).map((p) => [p.kind, p.subject]),
    [['book', 'shots/user/s.png (검사 중인 책: operator)'], ['key', 's:q'], ['key', 's:r']],
  );
  // 표식 두 개가 모두 자르기 밖이면 둘 다 보고한다(빌드는 첫 것만 던진다).
  const two = { s: { ...doc.s, boxes: { ...doc.s.boxes, c: { x: 2700, y: 1400, w: 10, h: 10 } } } };
  const outside = validateFigure({ ...fig, crop: ['a'], marks: ['b', 'c'] }, two);
  assert.deepEqual(outside.map((p) => p.kind), ['figure', 'figure']);
  assert.deepEqual(validateFigure({ ...fig, crop: ['a'], marks: ['a'] }, doc, { book: 'user' }), []);
});
