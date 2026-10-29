// 산문 검사(prose-rules·ui-strings)의 순수 함수 테스트.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractUiStrings } from './lib/ui-strings.mjs';
import { checkProse, findUnclosedEmphasis } from './lib/prose-rules.mjs';

test('extractUiStrings reads literals, template parts and jsx text', () => {
  const src = "const a = '담당자'; const b = `${n}개 선택됨`; return <Button>저장</Button>; const en = 'save'";
  const out = extractUiStrings(src);
  for (const s of ['담당자', '개 선택됨', '저장']) assert.ok(out.includes(s), s);
  assert.ok(!out.includes('save'));
});

test('checkProse accepts bold that matches ui substring', () => {
  const r = checkProse('01-a.md', '**AI 위임 작업**', new Set(['AI 위임 작업 목록']));
  assert.equal(r.unverified.length, 0);
  assert.equal(r.errors.length, 0);
});

test('checkProse lists unknown bold text', () => {
  const r = checkProse('01-a.md', '**없는 버튼**', new Set(['저장']));
  assert.equal(r.unverified.length, 1);
});

test('checkProse ignores bold inside fenced code', () => {
  const r = checkProse('01-a.md', '```\n**없는 버튼**\n```', new Set());
  assert.equal(r.unverified.length, 0);
});

test('findUnclosedEmphasis flags punctuation before closing stars', () => {
  assert.equal(findUnclosedEmphasis('**설정(관리)**을').length, 1);
  assert.equal(findUnclosedEmphasis('**담당자**를').length, 0);
  assert.equal(checkProse('a.md', '**설정(관리)**을', new Set()).errors.length, 1);
});

test('checkProse requires blank quote line after admonition label', () => {
  assert.equal(checkProse('a.md', '> **참고**\n> 내용', new Set()).errors.length, 1);
  assert.equal(checkProse('a.md', '> **참고**\n>\n> 내용', new Set()).errors.length, 0);
});

test('checkProse flags zero-padded chapter refs', () => {
  assert.equal(checkProse('a.md', '자세한 것은 04장 을 본다', new Set()).errors.length, 1);
});

test('checkProse flags unwritten TODO markers', () => {
  const r = checkProse('a.md', '> TODO(집필) 내용', new Set());
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /^\[미집필\] a\.md:1 /);
});

test('checkProse does not fire admonition error at EOF or before an empty line', () => {
  assert.equal(checkProse('a.md', '> **참고**', new Set()).errors.length, 0);
  assert.equal(checkProse('a.md', '> **참고**\n', new Set()).errors.length, 0);
  assert.equal(checkProse('a.md', '> **참고**\n\n본문', new Set()).errors.length, 0);
});

test('checkProse ignores three-digit chapter numbers', () => {
  assert.equal(checkProse('a.md', '101장', new Set()).errors.length, 0);
});

test('checkProse ignores bold and chapter refs inside inline code', () => {
  const r = checkProse('a.md', '예: `**없는 버튼**` 과 `04장`', new Set());
  assert.equal(r.errors.length + r.unverified.length, 0);
});

test('checkProse requires exact match for short bold', () => {
  const ui = new Set(['저장하기']);
  assert.equal(checkProse('a.md', '**저장**', ui).unverified.length, 1);
  assert.equal(checkProse('a.md', '**저장하기**', ui).unverified.length, 0);
  assert.equal(checkProse('a.md', '**저장**', new Set(['저장'])).unverified.length, 0);
});
