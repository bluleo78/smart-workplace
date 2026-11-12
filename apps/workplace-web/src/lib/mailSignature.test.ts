// @vitest-environment jsdom
// 메일 서명 블록 문자열 도구(WP-1517) — 작성창 자동 넣기·AI 초안·보낼 때 이미지 사본이 이 함수들에 기대므로 간격·순서·판정을 고정한다.
import { describe, expect, test } from 'vitest';

import type { MailSignature } from '@/types/mailSignature';

import {
  appendSignature,
  htmlToPlainText,
  isSignatureImageSrc,
  replaceBodyKeepingSignature,
  replaceSignatureImageSrcs,
  shouldAutoInsertSignature,
  signatureBlockHtml,
  signatureImageIds,
  signatureImageSrc,
  splitSignature,
} from './mailSignature';

const S = '<p style="color: #1F4E79">홍길동</p>';

function sig(over: Partial<MailSignature> = {}): MailSignature {
  return { html: '<p>홍</p>', autoNew: true, autoReply: false, updatedAt: null, droppedImageCount: 0, ...over };
}

describe('appendSignature', () => {
  test('빈 본문이면 빈 줄 둘 뒤에 서명 블록', () => {
    expect(appendSignature('', '<p>홍</p>')).toBe('<p></p><p></p><div data-mail-signature=""><p>홍</p></div>');
    expect(appendSignature('<p></p>', '<p>홍</p>')).toBe('<p></p><p></p><div data-mail-signature=""><p>홍</p></div>');
  });

  test('본문이 있으면 빈 줄 하나 뒤에 서명 블록', () => {
    expect(appendSignature('<p>안녕</p>', S)).toBe('<p>안녕</p><p></p>' + signatureBlockHtml(S));
  });
});

describe('splitSignature', () => {
  test('본문과 서명 블록을 나누고 사이 빈 줄 하나를 뺀다', () => {
    expect(splitSignature(appendSignature('<p>안녕</p>', S))).toEqual({ body: '<p>안녕</p>', block: signatureBlockHtml(S) });
  });

  test('서명이 없으면 block 은 null 이고 본문은 그대로', () => {
    expect(splitSignature('<p>안녕</p><p></p>')).toEqual({ body: '<p>안녕</p><p></p>', block: null });
  });

  test('서명 블록이 여럿이면 마지막 것을 block 으로, 나머지는 모두 뺀다', () => {
    const first = signatureBlockHtml('<p>옛 서명</p>');
    const html = '<p>안녕</p><p></p>' + first + signatureBlockHtml(S);
    expect(splitSignature(html)).toEqual({ body: '<p>안녕</p>', block: signatureBlockHtml(S) });
  });
});

describe('replaceBodyKeepingSignature', () => {
  test('지금 서명 블록을 새 본문 뒤에 같은 간격으로 다시 붙인다', () => {
    expect(replaceBodyKeepingSignature(appendSignature('<p>a</p>', S), '<p>b</p>')).toBe(appendSignature('<p>b</p>', S));
  });

  test('서명이 없으면 새 본문 그대로', () => {
    expect(replaceBodyKeepingSignature('<p>a</p>', '<p>b</p>')).toBe('<p>b</p>');
  });
});

describe('서명 이미지 경로', () => {
  test('경로 만들기·판정', () => {
    expect(signatureImageSrc(7)).toBe('/api/v1/mail/signature/images/7');
    expect(isSignatureImageSrc('/api/v1/mail/signature/images/7')).toBe(true);
    expect(isSignatureImageSrc('/api/v1/mail/signature/images/7x')).toBe(false);
    expect(isSignatureImageSrc('/api/v1/files/7/content')).toBe(false);
    expect(isSignatureImageSrc(null)).toBe(false);
  });

  test('본문의 서명 이미지 id 를 처음 나온 순서로 중복 없이', () => {
    const html =
      '<img src="/api/v1/mail/signature/images/3"><img src="/api/v1/mail/signature/images/3"><img src="/api/v1/files/9/content">';
    expect(signatureImageIds(html)).toEqual([3]);
    expect(signatureImageIds('<img src="/api/v1/mail/signature/images/5"><img src="/api/v1/mail/signature/images/2">')).toEqual([5, 2]);
  });

  test('지정한 서명 이미지 src 만 바꾼다', () => {
    const html =
      '<p><img src="/api/v1/mail/signature/images/3" alt="로고"><img src="/api/v1/mail/signature/images/4"><img src="/api/v1/files/9/content"></p>';
    expect(replaceSignatureImageSrcs(html, new Map([[3, '/api/v1/files/40/content']]))).toBe(
      '<p><img src="/api/v1/files/40/content" alt="로고"><img src="/api/v1/mail/signature/images/4"><img src="/api/v1/files/9/content"></p>',
    );
  });
});

describe('서명 이미지 경로 — 앞 속성 값에 > 가 있을 때', () => {
  // Outlook 서명은 alt 에 「Logo > Co」 같은 글이 들 수 있다 — 태그가 거기서 끝난 것으로 보면 사본을 안 만들어 그림이 빠진다.
  const html =
    '<p><img alt="Logo > Co" width="120" src="/api/v1/mail/signature/images/3">' +
    "<img title='a > b' src=\"/api/v1/mail/signature/images/4\"></p>";

  test('id 를 찾는다', () => {
    expect(signatureImageIds(html)).toEqual([3, 4]);
  });

  test('src 만 바꾸고 나머지 글자는 그대로 둔다', () => {
    expect(replaceSignatureImageSrcs(html, new Map([[3, '/api/v1/files/40/content'], [4, '/api/v1/files/41/content']]))).toBe(
      '<p><img alt="Logo > Co" width="120" src="/api/v1/files/40/content">' +
        "<img title='a > b' src=\"/api/v1/files/41/content\"></p>",
    );
  });

  test('따옴표 안의 src= 글자는 속성으로 보지 않는다', () => {
    expect(signatureImageIds('<img alt=" src=&quot;x" src="/api/v1/mail/signature/images/9">')).toEqual([9]);
    expect(signatureImageIds('<img alt="x src=\\"/api/v1/mail/signature/images/9">')).toEqual([]);
  });
});

describe('shouldAutoInsertSignature', () => {
  test('작성 종류와 스위치·다시 열기·서명 유무로 정한다', () => {
    expect(shouldAutoInsertSignature({ mode: 'new' }, sig())).toBe(true);
    expect(shouldAutoInsertSignature({ mode: 'new' }, sig({ autoNew: false }))).toBe(false);
    expect(shouldAutoInsertSignature({ mode: 'reply' }, sig({ autoReply: false }))).toBe(false);
    expect(shouldAutoInsertSignature({ mode: 'forward' }, sig({ autoReply: true }))).toBe(true);
    expect(shouldAutoInsertSignature({ mode: 'new', draftId: 5 }, sig())).toBe(false);
    expect(shouldAutoInsertSignature({ mode: 'new', unsaved: true }, sig())).toBe(false);
    expect(shouldAutoInsertSignature({ mode: 'new' }, sig({ html: '' }))).toBe(false);
    expect(shouldAutoInsertSignature({ mode: 'new' }, undefined)).toBe(false);
  });
});

describe('htmlToPlainText', () => {
  test('블록마다 줄을 나누고 빈 줄은 둘까지, 표 칸은 공백, 스타일 규칙은 읽지 않는다', () => {
    expect(htmlToPlainText('<p>안녕</p><p></p><p>잘 부탁해요</p>')).toBe('안녕\n\n잘 부탁해요');
    expect(htmlToPlainText('<style>p{color:red}</style><div><p>홍길동</p><p>팀장<br>010-1234</p></div>')).toBe('홍길동\n팀장\n010-1234');
    expect(htmlToPlainText('<table><tr><td>전화</td><td>02-1</td></tr></table>')).toBe('전화 02-1');
    expect(htmlToPlainText('<img src="x" onerror="window.__y=1">')).toBe('');
  });
});

describe('서명을 뺀 본문 평문(코칭 bodyText)', () => {
  test('splitSignature 의 body 를 평문으로 바꾸면 서명 글자가 없다', () => {
    const { body, block } = splitSignature(appendSignature('<p>자료 부탁해요</p>', '<p>홍길동</p>'));
    expect(block).not.toBeNull();
    expect(htmlToPlainText(body)).toBe('자료 부탁해요');
  });
});
