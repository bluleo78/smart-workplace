// @vitest-environment jsdom
// 붙여넣은 서명 판정·클래스 서식 풀기(WP-1726) — 설정 서명 카드가 「원본 그대로」 모드로 넘어갈지, 저장 전에 Outlook <style> 규칙을
// 인라인으로 옮겼는지를 고정한다(서버는 <style> 을 지우므로 옮기지 않으면 클래스 서식이 사라진다).
import { describe, expect, test } from 'vitest';

import { SIGNATURE_COPY_ATTR, toPastedSignatureHtml } from './mailSignaturePaste';

/** 서식 있는 서명으로 판정되는가(null 이 아니면 「원본 그대로」). */
const isRich = (html: string) => toPastedSignatureHtml(html) !== null;

/** 「원본 그대로」로 바꾼 HTML — 이 파일의 풀기 테스트는 모두 서식 있는 서명이라 null 이면 실패로 본다. */
function inline(html: string): string {
  const out = toPastedSignatureHtml(html);
  if (out === null) throw new Error('서식 있는 서명으로 판정되지 않았다');
  return out;
}

/** 붙여 넣은 HTML 을 문서로 열어 요소를 찾는다. */
function parse(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

/** Outlook 데스크톱에서 서명을 복사했을 때 클립보드 text/html 과 같은 모양 — 껍데기·조건부 주석·클래스 규칙·o:p. */
const OUTLOOK_DOC =
  '<html xmlns:o="urn:schemas-microsoft-com:office:office"><head><meta charset="utf-8">' +
  '<!--[if gte mso 9]><xml><o:shapedefaults v:ext="edit"/></xml><![endif]-->' +
  '<style><!--\n' +
  '@font-face{font-family:"Malgun Gothic";panose-1:2 11 5 3 2 0 0 2 0 4;}\n' +
  'p.MsoNormal, li.MsoNormal, div.MsoNormal{margin:0cm;font-family:"Malgun Gothic";font-size:10pt;color:#222}\n' +
  '@page WordSection1{size:612.0pt 792.0pt;}\n' +
  '@media print{p.MsoNormal{color:red}}\n' +
  'div.WordSection1{page:WordSection1;}\n' +
  '--></style></head><body lang="KO"><!--StartFragment-->' +
  '<div class="WordSection1"><p class="MsoNormal">홍길동<o:p></o:p></p>' +
  '<p class="MsoNormal" style="color:#1F4E79">개발팀</p></div>' +
  '<!--EndFragment--></body></html>';

describe('toPastedSignatureHtml — 판정', () => {
  test('표·font·클래스+<style>·글자 요소가 아닌 요소의 style·상자 서식이 하나라도 있으면 붙여넣은 서명', () => {
    expect(isRich('<table><tr><td>홍길동</td></tr></table>')).toBe(true);
    expect(isRich('<p><font face="Arial">홍길동</font></p>')).toBe(true);
    expect(isRich(OUTLOOK_DOC)).toBe(true);
    // 편집기가 지우는 div 의 style.
    expect(isRich('<div style="color:#1F4E79">홍길동</div>')).toBe(true);
    // 상자 서식(너비·안쪽 여백·테두리 등)은 글자 요소·문단에 있어도 원본으로 본다.
    expect(isRich('<p style="padding:4px 8px">홍길동</p>')).toBe(true);
    expect(isRich('<p><span style="border-left:2px solid #1F4E79">홍길동</span></p>')).toBe(true);
    expect(isRich('<p><span style="display:inline-block;width:120px">홍길동</span></p>')).toBe(true);
  });

  test('글자·굵게·링크만이면 편집기 그대로', () => {
    expect(isRich('<p>홍길동</p>')).toBe(false);
    expect(isRich('<p><strong>홍길동</strong> <a href="https://example.com">example</a></p>')).toBe(false);
    expect(isRich('')).toBe(false);
  });

  test('글자 요소·문단의 글자 서식 style 만 있으면(크롬 웹 글 복사) 편집기 그대로 — 편집기가 담을 수 있다', () => {
    expect(isRich('<p><span style="color:#1F4E79">홍길동</span></p>')).toBe(false);
    expect(
      isRich(
        '<span style="color: rgb(34, 34, 34); font-family: Arial, sans-serif; font-size: 13px; background-color: rgb(255, 255, 255);">010-1234-5678</span>',
      ),
    ).toBe(false);
    expect(isRich('<p style="margin:0;text-align:center;color:#333"><a href="https://x.com" style="color:#06c">x.com</a></p>')).toBe(false);
    // 이미지 크기 style 은 편집기 이미지가 그대로 담는다.
    expect(isRich('<p><img src="https://example.com/logo.png" style="width:120px;height:40px"></p>')).toBe(false);
  });

  test('<style> 없이 class 만 있거나 <style> 만 있으면 편집기 그대로', () => {
    expect(isRich('<p class="x">홍길동</p>')).toBe(false);
    expect(isRich('<style>p{color:red}</style><p>홍길동</p>')).toBe(false);
  });

  test('이 서명 편집기에서 복사한 HTML(복사 표지)은 표·상자 서식이 있어도 편집기 그대로 — 직접 쓴 서명은 편집기에 남는다', () => {
    expect(isRich(`<p ${SIGNATURE_COPY_ATTR}="" data-pm-slice="1 1 []"><span style="color:#1F4E79">홍길동</span></p>`)).toBe(false);
    expect(
      isRich(`<table ${SIGNATURE_COPY_ATTR}="" data-pm-slice="1 1 []"><tbody><tr><td style="padding:4px">홍길동</td></tr></tbody></table>`),
    ).toBe(false);
  });

  test('ProseMirror 조각 표시(data-pm-slice)만으로는 편집기로 보내지 않는다 — 노트·Notion·Confluence 의 표 서명', () => {
    expect(isRich('<table data-pm-slice="1 1 []"><tr><td>홍길동</td></tr></table>')).toBe(true);
  });
});

describe('toPastedSignatureHtml — 클래스 서식 풀기', () => {
  test('MsoNormal 클래스의 글꼴·크기·색을 요소 인라인 style 로 옮긴다', () => {
    const out = parse(inline(OUTLOOK_DOC));
    const first = out.querySelector('p') as HTMLElement;
    expect(first.textContent).toBe('홍길동');
    expect(first.style.fontFamily).toBe('"Malgun Gothic"');
    expect(first.style.fontSize).toBe('10pt');
    expect(first.style.color).toBe('rgb(34, 34, 34)');
  });

  test('요소 자신의 인라인 선언이 클래스 규칙을 이긴다', () => {
    const out = parse(inline(OUTLOOK_DOC));
    const second = out.querySelectorAll('p')[1] as HTMLElement;
    expect(second.style.color).toBe('rgb(31, 78, 121)');
    // 겹치지 않는 클래스 선언은 그대로 들어온다.
    expect(second.style.fontSize).toBe('10pt');
  });

  test('@media·@page·@font-face 묶음 규칙은 건너뛴다', () => {
    const out = parse(inline(OUTLOOK_DOC));
    // @media print 의 red 가 아니다.
    expect((out.querySelector('p') as HTMLElement).style.color).toBe('rgb(34, 34, 34)');
    expect(inline(OUTLOOK_DOC)).not.toContain('612.0pt');
    expect(inline(OUTLOOK_DOC)).not.toContain('panose');
  });

  test('껍데기·<style>·<meta>·조건부 주석·<o:p> 를 남기지 않고 body 안만 돌려준다', () => {
    const html = inline(OUTLOOK_DOC);
    expect(html).not.toMatch(/<html|<head|<body|<meta|<style|<!--|<o:p|shapedefaults|StartFragment/i);
    expect(html).toContain('홍길동');
    expect(html).toContain('개발팀');
  });

  test('나중 규칙이 앞 규칙을 이긴다', () => {
    const out = parse(inline('<style>p.a{color:#111111}p.a{color:#222222}</style><p class="a">x</p>'));
    expect((out.querySelector('p') as HTMLElement).style.color).toBe('rgb(34, 34, 34)');
  });

  test('잘못된 선택자는 그 선택자만 건너뛰고 같은 묶음의 나머지는 적용한다', () => {
    const out = parse(inline('<style>p:::bad, p.a{color:#222222}</style><p class="a">x</p>'));
    expect((out.querySelector('p') as HTMLElement).style.color).toBe('rgb(34, 34, 34)');
  });

  test('body·html 규칙(물려받는 기본 글꼴·색)은 결과를 감싼 div 의 style 로 옮긴다', () => {
    const html = inline(
      '<html><head><style>body{font-family:Arial;color:#333}p.a{font-size:10pt}</style></head><body><p class="a">x</p></body></html>',
    );
    const wrapper = parse(html).body.firstElementChild as HTMLElement;
    expect(wrapper.tagName).toBe('DIV');
    expect(wrapper.style.fontFamily).toBe('Arial');
    expect(wrapper.style.color).toBe('rgb(51, 51, 51)');
    expect((wrapper.querySelector('p') as HTMLElement).style.fontSize).toBe('10pt');
  });

  test('body·html 규칙이 없으면 감싸지 않는다', () => {
    const html = inline('<style>p.a{color:#222}</style><p class="a">x</p>');
    expect(parse(html).body.firstElementChild?.tagName).toBe('P');
  });

  test('<style> 이 없으면 내용은 그대로', () => {
    expect(inline('<table><tbody><tr><td style="color: red;">x</td></tr></tbody></table>')).toBe(
      '<table><tbody><tr><td style="color: red;">x</td></tr></tbody></table>',
    );
  });
  test('<body style> 의 글꼴·색은 <style> 규칙이 없어도 결과를 감싼 div 로 남긴다', () => {
    const html = inline('<html><body style="font-family:Arial;color:#333"><table><tbody><tr><td>x</td></tr></tbody></table></body></html>');
    const wrapper = parse(html).body.firstElementChild as HTMLElement;
    expect(wrapper.tagName).toBe('DIV');
    expect(wrapper.style.fontFamily).toBe('Arial');
    expect(wrapper.style.color).toBe('rgb(51, 51, 51)');
    expect(wrapper.querySelector('td')?.textContent).toBe('x');
  });

  test('<style> 에 다른 규칙만 있어도 <body style> 은 남긴다', () => {
    const html = inline('<html><head><style>p.a{font-size:10pt}</style></head><body style="color:#333"><p class="a">x</p></body></html>');
    const wrapper = parse(html).body.firstElementChild as HTMLElement;
    expect(wrapper.tagName).toBe('DIV');
    expect(wrapper.style.color).toBe('rgb(51, 51, 51)');
  });

  test('닫는 괄호가 빠진 마지막 규칙도 선언 끝 글자를 잃지 않는다', () => {
    const out = parse(inline('<style>p.a{color:#222222}p.b{font-size:10pt</style><p class="a">x</p><p class="b">y</p>'));
    expect((out.querySelectorAll('p')[1] as HTMLElement).style.fontSize).toBe('10pt');
  });
});
