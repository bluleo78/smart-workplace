// @vitest-environment jsdom
// 서명 편집기 복사 표지(WP-1726 코드 리뷰) — 서명 편집기에서 복사한 HTML 에 표지가 붙어, 되붙여도 「원본 그대로」로 넘어가지 않고
// 편집기에 남는지 고정한다(직접 쓴 서명은 편집기에 남아야 한다 — 색 글자·표가 있어도).
import { getSchema } from '@tiptap/core';
import { DOMParser as PMDOMParser } from '@tiptap/pm/model';
import { describe, expect, test } from 'vitest';

import { SIGNATURE_COPY_ATTR, toPastedSignatureHtml } from '@/lib/mailSignaturePaste';

import { signatureClipboardSerializer, signatureEditorExtensions } from './signatureEditorExtensions';

const schema = getSchema(signatureEditorExtensions);

/** HTML 을 서명 편집기 스키마 문서로 읽는다. */
function docOf(html: string) {
  const el = document.createElement('div');
  el.innerHTML = html;
  return PMDOMParser.fromSchema(schema).parse(el);
}

/** 문서 전체를 복사 직렬화기로 클립보드 HTML 처럼 만든다. */
function copiedHtml(html: string): string {
  const frag = signatureClipboardSerializer(schema).serializeFragment(docOf(html).content);
  const wrap = document.createElement('div');
  wrap.append(frag);
  return wrap.innerHTML;
}

describe('signatureClipboardSerializer', () => {
  test('첫 최상위 요소에만 복사 표지를 단다', () => {
    const wrap = document.createElement('div');
    wrap.innerHTML = copiedHtml('<p>홍길동</p><p>개발팀</p>');
    const [first, second] = Array.from(wrap.children);
    expect(first.hasAttribute(SIGNATURE_COPY_ATTR)).toBe(true);
    expect(second.hasAttribute(SIGNATURE_COPY_ATTR)).toBe(false);
  });

  test('색 글자·표가 든 직접 쓴 서명을 복사해 되붙이면 편집기에 남는다(원본 모드가 아니다)', () => {
    const html = copiedHtml(
      '<p><span style="color:#1F4E79">홍길동</span></p><table><tbody><tr><td style="padding:4px">개발팀</td></tr></tbody></table>',
    );
    expect(html).toContain('<table');
    expect(toPastedSignatureHtml(html)).toBeNull();
  });
});
