// 매뉴얼 그림 지시문(자르기·번호 표식) 테스트.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFigureLine, cropRect, renderFigure, markInside, validateFigure, FULL_WIDTH_PX, CROP_PAD_PX } from './lib/figure.mjs';

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

test('renderFigure places mark outside the box unless it touches the frame edge', () => {
  // 상자 a 는 원본 왼쪽 위 끝에 붙어 여백이 잘려 바깥 자리가 없다 → 안쪽. 상자 c 는 여유가 있다 → 바깥(기본).
  const two = { w: 2880, h: 1620, boxes: { a: { x: 0, y: 0, w: 200, h: 100 }, c: { x: 300, y: 300, w: 100, h: 100 } } };
  const html = renderFigure({ alt: '', src: 'shots/user/t.png', shotId: 't', crop: ['a', 'c'], marks: ['a', 'c'] }, { t: two });
  const marks = [...html.matchAll(/<span class="mark"([^>]*)>(\d)</g)].map((m) => [m[2], /data-inside/.test(m[1])]);
  assert.deepEqual(marks, [['1', true], ['2', false]]);
});

test('markInside needs room outside the box', () => {
  // 자른 폭 1400(= FULL_WIDTH_PX)이면 번호 원 자리는 원본 20 x 1400 / 600 ≈ 46.7px(좁은 컨테이너까지 덮는 보수값).
  // 본문 단 657px 기준(≈42.6px)이면 바깥으로 갔을 45px 도 안쪽에 둔다.
  const crop = { x: 0, y: 0, w: 1400, h: 800 };
  assert.equal(markInside({ x: 45, y: 100, w: 10, h: 10 }, crop), true);
  assert.equal(markInside({ x: 100, y: 45, w: 10, h: 10 }, crop), true);
  assert.equal(markInside({ x: 50, y: 50, w: 10, h: 10 }, crop), false);
  // 자른 폭이 FULL_WIDTH_PX 보다 넓으면 배율이 작아져 더 큰 여유가 필요하다(2800 → 약 93.3px).
  const wide = { x: 0, y: 0, w: 2800, h: 800 };
  assert.equal(markInside({ x: 90, y: 100, w: 10, h: 10 }, wide), true);
  assert.equal(markInside({ x: 100, y: 100, w: 10, h: 10 }, wide), false);
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
