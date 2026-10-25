import type { JSONContent } from '@tiptap/core';
import { describe, expect, it } from 'vitest';

import { bodyToDoc, serializeToBody } from './mentionSerialize';

// 서식 입력창(WP-101) 본문 ↔ 문서 왕복.
const mentions = [{ id: 7, name: '김철수', kind: 'HUMAN' as const }];
const parse = (body: string) => bodyToDoc(body, mentions, { formatting: true });
const t = (text: string, ...marks: string[]): JSONContent =>
  marks.length > 0 ? { type: 'text', text, marks: marks.map((type) => ({ type })) } : { type: 'text', text };
const p = (...content: JSONContent[]): JSONContent => (content.length > 0 ? { type: 'paragraph', content } : { type: 'paragraph' });
const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content });
const li = (...content: JSONContent[]): JSONContent => ({ type: 'listItem', content });

describe('serializeToBody — 서식', () => {
  it.each([
    ['굵게', doc(p(t('a '), t('b', 'bold'), t(' c'))), 'a **b** c'],
    ['기울임', doc(p(t('x', 'italic'))), '*x*'],
    ['취소선', doc(p(t('x', 'strike'))), '~~x~~'],
    ['밑줄', doc(p(t('x', 'underline'))), '<u>x</u>'],
    ['코드', doc(p(t('a_b', 'code'))), '`a_b`'],
    ['백틱 든 코드', doc(p(t('a`b', 'code'))), '``a`b``'],
    ['굵게+기울임', doc(p(t('x', 'bold', 'italic'))), '***x***'],
    ['마크 안 앞뒤 공백은 밖으로', doc(p(t('a'), t(' b ', 'bold'), t('c'))), 'a **b** c'],
    ['글머리 목록', doc({ type: 'bulletList', content: [li(p(t('a'))), li(p(t('b')))] }), '- a\n- b'],
    ['번호 목록', doc({ type: 'orderedList', attrs: { start: 3 }, content: [li(p(t('a'))), li(p(t('b')))] }), '3. a\n4. b'],
    ['코드 블록', doc({ type: 'codeBlock', content: [t('x = 1\n  y')] }), '```\nx = 1\n  y\n```'],
    ['목록 앞뒤 빈 줄', doc(p(t('a')), { type: 'bulletList', content: [li(p(t('b')))] }, p(t('c'))), 'a\n\n- b\n\nc'],
    ['링크', doc(p({ type: 'text', text: '문서', marks: [{ type: 'link', attrs: { href: 'https://a.com/x' } }] })), '[문서](https://a.com/x)'],
    ['글=주소 링크는 맨 URL', doc(p({ type: 'text', text: 'https://a.com/a_b', marks: [{ type: 'link', attrs: { href: 'https://a.com/a_b' } }] })), 'https://a.com/a_b'],
    ['멘션', doc(p({ type: 'mention', attrs: { id: 7, label: '김철수' }, marks: [{ type: 'bold' }] })), '**<@7>**'],
  ])('%s', (_name, d, md) => {
    expect(serializeToBody(d)).toBe(md);
  });

  it('평문 문서는 이스케이프 없이 친 그대로', () => {
    expect(serializeToBody(doc(p(t('a_b 2*3 1. x')), p(t('- y'))))).toBe('a_b 2*3 1. x\n- y');
  });
});

// 겹친 서식 바로 뒤·앞에 한글이 붙는 경우 — 강조 기호가 꺾쇠·괄호와 글자 사이에 껴도 서식이 살아 돌아와야 한다.
describe('겹친 서식 + 붙은 한글 왕복', () => {
  const m = (type: string, attrs?: Record<string, unknown>) => (attrs ? { type, attrs } : { type });
  const mention = (marks: JSONContent['marks']): JSONContent => ({ type: 'mention', attrs: { id: 7, label: '김철수' }, marks });
  const link = { type: 'link', attrs: { href: 'https://u.com/' } };
  it.each([
    ['굵게+밑줄 뒤 조사', doc(p({ type: 'text', text: '굵게', marks: [m('bold'), m('underline')] }, t('을'))), '**<u>굵게</u>**을'],
    ['취소선 안 굵게 뒤', doc(p({ type: 'text', text: '굵', marks: [m('bold'), m('strike')] }, t('뒤'))), null],
    ['굵게 멘션 뒤 조사', doc(p(mention([m('bold')]), t('님'))), '**<@7>**님'],
    ['글 뒤 굵게 멘션', doc(p(t('글'), mention([m('bold')]))), '글**<@7>**'],
    ['글 뒤 굵게+밑줄', doc(p(t('글'), { type: 'text', text: 'x', marks: [m('bold'), m('underline')] })), '글**<u>x</u>**'],
    ['굵은 링크 뒤 조사 — 링크를 바깥에', doc(p({ type: 'text', text: 'a', marks: [link, m('bold')] }, t('뒤'))), '[**a**](https://u.com/)뒤'],
  ])('%s', (_n, d, md) => {
    const body = serializeToBody(d);
    if (md !== null) expect(body).toBe(md);
    expect(parse(body)).toEqual(d);
  });

  it.each(['~~**굵**~~뒤', '**~~x~~**뒤', '*<u>x</u>*을', '<u>**a**</u>는'])('%j 는 서식으로 읽힌다', (md) => {
    const d = parse(md);
    expect(JSON.stringify(d)).toContain('"marks"');
    expect(serializeToBody(d)).toBe(md);
  });
});

describe('bodyToDoc(formatting) ↔ serializeToBody 왕복', () => {
  it.each([
    'a **b** c',
    '*x* ~~y~~ <u>z</u> `c`',
    '***x***',
    '**a *b***',
    '- a\n- b\n  - c',
    '1. a\n2. b',
    'a\n\n- b\n\nc',
    '```\nx = 1\n\n  y\n```',
    '[문서](https://a.com/x)',
    'https://a.com/a_b_c 확인',
    '**<@7>** 님 <u>확인</u>',
    '첫 줄\n\n\n셋째',
    '**(중요)**는 꼭',
    '**"a"**가',
    'a_b 2*3 #해시 # 제목 > 인용',
  ])('%j', (md) => {
    expect(serializeToBody(parse(md))).toBe(md);
  });

  it('굵게 문서를 본문으로 썼다 다시 읽으면 같은 문서', () => {
    const d = doc(p(t('a '), t('b', 'bold'), t(' '), t('c', 'italic')), p(), p(t('d', 'underline')));
    expect(parse(serializeToBody(d))).toEqual(d);
  });

  it('평문 본문은 기존 bodyToDoc 과 같은 문서', () => {
    const body = '안녕 <@7>\n\n  들여쓰기\na_b https://x.com/a_(b)';
    expect(parse(body)).toEqual(bodyToDoc(body, mentions));
  });

  it('날짜 줄은 목록이 아니다', () => {
    expect(parse('2024. 10. 25. 회의')).toEqual(doc(p(t('2024. 10. 25. 회의'))));
  });
});
