// 한 권 렌더링(renderBook) 테스트: 메모리 픽스처로 마크업 규칙을 확인한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderBook } from './lib/render.mjs';
import { loadChapters } from './lib/chapters.mjs';
import { BOOKS } from './lib/books.mjs';

// 그림 픽스처(Task 2 와 같은 모양).
const boxes = {
  s: { w: 2880, h: 1620, boxes: { a: { x: 100, y: 100, w: 200, h: 100 } } },
};

// 장 픽스처: 두 장 모두 part 1(시작하기).
const mk = (number, slug, title, audience, body, part = 1) => ({
  file: `${String(number).padStart(2, '0')}-${slug}.md`,
  number,
  meta: { slug, title, part, audience },
  body,
});
const ch1 = mk(
  1,
  'intro',
  '소개',
  ['member', 'admin'],
  [
    '',
    '# 본문 첫 제목',
    '',
    '> **이 장에서 할 수 있는 일**',
    '> - 시작한다',
    '',
    '## 첫 절',
    '',
    '[다음 장](02-next.md) 과 [코드](../../apps/x.ts) 를 본다.',
    '',
    '> **참고** 참고 내용',
    '',
    '> **주의** 주의 내용',
    '',
    '> **경고** 경고 내용',
    '',
    '> TODO(캡처) 나중에',
    '',
    '## AI 와 함께 쓰기',
    '',
    'AI 문단입니다.',
    '',
    '## 다른 절',
    '',
    '일반 문단입니다.',
    '',
  ].join('\n'),
);
const ch2 = mk(2, 'next', '다음', ['member'], '\n# 다음 장\n\n본문\n');
const dateOpt = { buildDate: '2026-10-29' };

test('renderBook drops first h1 and uses frontmatter title', () => {
  const html = renderBook(BOOKS.user, [ch1, ch2], boxes, dateOpt);
  assert.match(html, /<section class="chapter" id="ch-intro">/);
  assert.match(html, /<p class="chapter-num">01<\/p>/);
  assert.match(html, /<h1>소개<\/h1>/);
  assert.doesNotMatch(html, /본문 첫 제목/);
});

test('renderBook renders audience badge in Korean', () => {
  const html = renderBook(BOOKS.user, [ch1, ch2], boxes, dateOpt);
  assert.match(html, /<p class="badge">구성원 · 관리자<\/p>/);
});

test('renderBook wraps AI section until next h2', () => {
  const html = renderBook(BOOKS.user, [ch1, ch2], boxes, dateOpt);
  const m = html.match(/<section class="ai-with">([\s\S]*?)<\/section>/);
  assert.ok(m, 'ai-with 섹션이 있어야 한다');
  assert.match(m[1], /AI 문단입니다/);
  assert.doesNotMatch(m[1], /다른 절/);
  assert.match(html, /다른 절[\s\S]*일반 문단입니다/);
});

test('renderBook turns summary quote into aside', () => {
  const html = renderBook(BOOKS.user, [ch1, ch2], boxes, dateOpt);
  assert.match(html, /<aside class="summary">[\s\S]*이 장에서 할 수 있는 일[\s\S]*시작한다[\s\S]*<\/aside>/);
  for (const c of ['note', 'caution', 'warning', 'todo']) {
    assert.match(html, new RegExp(`<blockquote class="adm adm-${c}">`));
  }
});

test('renderBook rewrites chapter links to anchors and strips repo links', () => {
  const html = renderBook(BOOKS.user, [ch1, ch2], boxes, dateOpt);
  assert.match(html, /<a href="#ch-next">다음 장<\/a>/);
  assert.doesNotMatch(html, /apps\/x\.ts/);
  assert.match(html, /코드/);
});

test('renderBook inserts part divider only when part changes', () => {
  const user = renderBook(BOOKS.user, [ch1, ch2], boxes, dateOpt);
  assert.equal((user.match(/class="part-divider"/g) ?? []).length, 1);
  const op = renderBook(BOOKS.operator, [ch1, ch2], boxes, dateOpt);
  assert.equal((op.match(/class="part-divider"/g) ?? []).length, 0);
});

test('renderBook propagates unknown mark key error', () => {
  const bad = mk(1, 'intro', '소개', ['member'], '\n![x](shots/user/s.png){marks=zz}\n');
  assert.throws(() => renderBook(BOOKS.user, [bad], boxes, dateOpt), /알 수 없는 상자 키/);
});

test('renderBook renders cover and toc', () => {
  const html = renderBook(BOOKS.user, [ch1, ch2], boxes, dateOpt);
  assert.match(html, /<section class="cover">[\s\S]*Gen:iA Works 사용자 매뉴얼[\s\S]*2026-10-29/);
  assert.match(html, /<section class="toc">[\s\S]*href="#ch-intro"/);
});

test('renderBook keeps chapter anchors fragment-only and prefixes asset paths', () => {
  const withImg = mk(1, 'intro', '소개', ['member'], '\n![x](shots/user/s.png){marks=a}\n\n![y](shots/user/s.png)\n');
  const html = renderBook(BOOKS.user, [withImg], boxes, { buildDate: 'd', assetBase: '../x/' });
  assert.doesNotMatch(html, /<base/);
  assert.match(html, /<section class="toc">[\s\S]*href="#ch-intro"/);
  assert.match(html, /<img src="\.\.\/x\/shots\/user\/s\.png"/);
  assert.match(html, /<img src="\.\.\/x\/shots\/user\/s\.png"/);
  assert.match(html, /href="\.\.\/x\/styles\/manual\.css"/);
});

test('renderBook labels operator audience as 슈퍼어드민', () => {
  const op = mk(1, 'intro', '소개', ['operator'], '\n본문\n');
  assert.match(renderBook(BOOKS.operator, [op], boxes, dateOpt), /<p class="badge">슈퍼어드민<\/p>/);
});

test('renderBook maps chapter link with sub-anchor and keeps image links', () => {
  const c = mk(1, 'intro', '소개', ['member'], '\n[절](02-next.md#sec) ![i](../img.png)\n');
  const html = renderBook(BOOKS.user, [c, ch2], boxes, dateOpt);
  assert.match(html, /<a href="#ch-next">절<\/a>/);
  assert.match(html, /<img src="\.\.\/img\.png"/);
});

test('renderBook throws on link to a chapter file not in the book', () => {
  const c = mk(1, 'intro', '소개', ['member'], '\n[없음](09-gone.md)\n');
  assert.throws(() => renderBook(BOOKS.user, [c], boxes, dateOpt), /01-intro\.md.*09-gone\.md/);
});

test('renderBook wraps AI section that is last in the chapter', () => {
  const c = mk(1, 'intro', '소개', ['member'], '\n## 앞 절\n\n앞\n\n## AI 와 함께 쓰기\n\n마지막 AI 문단\n');
  const html = renderBook(BOOKS.user, [c], boxes, dateOpt);
  assert.match(html, /<section class="ai-with"><h2>AI 와 함께 쓰기<\/h2>[\s\S]*마지막 AI 문단[\s\S]*<\/section><\/section>/);
});

test('renderBook marks only the ordered list right after a figure as steps', () => {
  const body = ['## 절', '', '![그림](shots/user/s.png){crop=a marks=a}', '', '1. 첫 단계', '2. 둘째 단계', '', '문단', '', '1. 그냥 목록', ''].join('\n');
  const html = renderBook(BOOKS.user, [mk(1, 'intro', '소개', ['member'], body)], boxes, dateOpt);
  assert.match(html, /<\/figure>\s*<ol class="steps">\s*<li>첫 단계/);
  assert.match(html, /<ol>\s*<li>그냥 목록/);
});

test('renderBook leaves tilde-fenced figure lines untouched', () => {
  const body = ['~~~', '![그림](shots/user/zz.png){marks=nope}', '~~~', ''].join('\n');
  const html = renderBook(BOOKS.user, [mk(1, 'intro', '소개', ['member'], body)], boxes, dateOpt);
  assert.doesNotMatch(html, /<figure/);
});

test('loadChapters returns an empty list for a missing directory', async () => {
  assert.deepEqual(await loadChapters({ dir: 'docs/manual/no-such-book' }), []);
});

test('loadChapters returns raw text with parsed chapters', async () => {
  const chapters = await loadChapters(BOOKS.user);
  assert.ok(chapters.length > 0);
  for (const ch of chapters) {
    assert.ok(ch.raw.startsWith('---'), ch.file);
    assert.ok(ch.raw.endsWith(ch.body), ch.file);
    assert.equal(typeof ch.meta.slug, 'string');
  }
});

test('renderBook throws when part numbers go backwards', () => {
  const a = mk(1, 'intro', '소개', ['member'], '\n본문\n', 2);
  const b = mk(2, 'next', '다음', ['member'], '\n본문\n', 1);
  assert.throws(() => renderBook(BOOKS.user, [a, b], boxes, dateOpt), /02-next\.md part 1 이 앞 장\(part 2\)보다 작습니다/);
});

test('stripRepoLinks keeps link text and leaves images and chapter links', async () => {
  const { stripRepoLinks } = await import('./lib/markdown.mjs');
  assert.equal(stripRepoLinks('[코드](../../apps/x.ts) ![i](../img.png) [장](02-b.md)'), '코드 ![i](../img.png) [장](02-b.md)');
});
