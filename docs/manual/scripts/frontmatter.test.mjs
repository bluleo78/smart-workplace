// 매뉴얼 프론트매터 파서·검증기 테스트.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFrontmatter, partOrderErrors, validateFrontmatter } from './lib/frontmatter.mjs';
import { BOOKS } from './lib/books.mjs';

test('parseFrontmatter reads scalars, numbers and bracket lists', () => {
  const raw =
    '---\nslug: ai-collaboration\ntitle: AI 와 함께 일하기\npart: 1\naudience: [member, admin]\nroutes: [/me/ai-tasks]\n---\n\n# 제목\n';
  const { meta, body } = parseFrontmatter(raw);
  assert.deepEqual(meta, {
    slug: 'ai-collaboration',
    title: 'AI 와 함께 일하기',
    part: 1,
    audience: ['member', 'admin'],
    routes: ['/me/ai-tasks'],
  });
  assert.equal(body, '\n# 제목\n');
});

test('validateFrontmatter requires part only when book has parts', () => {
  const meta = { slug: 'ai', title: 'T', audience: ['member'], routes: [] };
  const raw = '---\nslug: ai\n---\n';
  const u = validateFrontmatter(meta, { file: '01-ai.md', book: BOOKS.user, raw });
  assert.equal(u.length, 1);
  assert.match(u[0], /part/);
  const o = validateFrontmatter(meta, { file: '01-ai.md', book: BOOKS.operator, raw });
  assert.deepEqual(o, []);
});

test('validateFrontmatter rejects multi-line routes and unknown audience', () => {
  const base = { slug: 'a', title: 'T', part: 1, audience: ['member'], routes: [] };
  const multi = validateFrontmatter(base, {
    file: '01-a.md',
    book: BOOKS.user,
    raw: '---\nslug: a\nroutes:\n  - /a\n---\n',
  });
  assert.ok(multi.some((m) => m.includes('한 줄 대괄호')));
  const bad = validateFrontmatter({ ...base, audience: ['guest'] }, {
    file: '01-a.md',
    book: BOOKS.user,
    raw: '---\nslug: a\n---\n',
  });
  assert.ok(bad.some((m) => m.includes('guest')));
});

test('validateFrontmatter requires slug to match file name', () => {
  const meta = { slug: 'ai', title: 'T', part: 1, audience: ['member'], routes: [] };
  const errs = validateFrontmatter(meta, {
    file: '04-ai-collaboration.md',
    book: BOOKS.user,
    raw: '---\nslug: ai\n---\n',
  });
  assert.ok(errs.some((m) => m.includes('slug')));
});

test('validateFrontmatter accepts operator audience', () => {
  // 운영자 매뉴얼 장은 audience: [operator] 를 쓴다.
  const meta = { slug: 'ai', title: 'T', audience: ['operator'], routes: [] };
  const raw = '---\nslug: ai\n---\n';
  assert.deepEqual(validateFrontmatter(meta, { file: '01-ai.md', book: BOOKS.operator, raw }), []);
});

test('validateFrontmatter ignores a routes line in the body', () => {
  // 본문 예시의 `routes:` 줄은 프론트매터가 아니므로 여러 줄 YAML 오류가 아니다.
  const raw = '---\nslug: a\ntitle: T\npart: 1\naudience: [member]\nroutes: [/a]\n---\n\nroutes:\n';
  const { meta } = parseFrontmatter(raw);
  assert.deepEqual(validateFrontmatter(meta, { file: '01-a.md', book: BOOKS.user, raw }), []);
});

test('parseFrontmatter keeps numeric-looking slug and title as strings', () => {
  const raw = '---\nslug: 404\ntitle: 2026\npart: 5\naudience: [member]\n---\n';
  const { meta } = parseFrontmatter(raw);
  assert.equal(meta.slug, '404');
  assert.equal(meta.title, '2026');
  assert.equal(meta.part, 5);
  assert.deepEqual(validateFrontmatter(meta, { file: '09-404.md', book: BOOKS.user, raw }), []);
});

test('partOrderErrors flags a chapter whose part goes backwards', () => {
  const ch = (file, part) => ({ file, meta: { part } });
  assert.deepEqual(partOrderErrors([ch('01-a.md', 1), ch('02-b.md', 2), ch('03-c.md', 2)]), []);
  assert.deepEqual(partOrderErrors([ch('01-a.md', 2), ch('02-b.md', 1), ch('03-c.md', 2)]), [
    '02-b.md part 1 이 앞 장(part 2)보다 작습니다',
  ]);
});
