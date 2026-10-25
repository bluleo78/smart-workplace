// 메일 본문 붙여 넣은 이미지(WP-947) — 본문이 참조하는 업로드 id 를 찾고, 보낼 때 cid: 로 바꾸는 규칙을 지킨다.
// 왜: 이 id 가 빠지면 서버가 업로드를 클레임하지 못해 그림이 깨져 나가고, cid 가 어긋나면 받는 쪽 본문에 빈 그림이 남는다.
import { describe, expect, it } from 'vitest';

import { dropForeignPastedImages, isPastedImageSrc, pastedContentId, pastedImageIds, pastedImageSrc, toSendablePastedImages, uploadIdsWithBodyImages } from './mailPastedImages';

describe('mailPastedImages', () => {
  it('업로드 경로만 붙여 넣은 이미지로 본다', () => {
    expect(isPastedImageSrc(pastedImageSrc(12))).toBe(true);
    expect(isPastedImageSrc('/api/v1/files/12/content?x=1')).toBe(false);
    expect(isPastedImageSrc('https://example.com/a.png')).toBe(false);
    expect(isPastedImageSrc('cid:abc')).toBe(false);
    expect(isPastedImageSrc(null)).toBe(false);
  });

  it('본문의 붙여 넣은 이미지 id 를 처음 나온 순서로, 중복 없이 모은다', () => {
    const html =
      '<p>a<img src="/api/v1/files/7/content" alt="x"></p><p><img class="c" src="/api/v1/files/3/content"></p>' +
      '<p><img src="/api/v1/files/7/content"><img src="https://x/y.png"></p>';
    expect(pastedImageIds(html)).toEqual([7, 3]);
    expect(pastedImageIds('<p>글만</p>')).toEqual([]);
  });

  it('보낼 때 src 를 cid: 로 바꾸고 인라인 업로드 목록을 만든다 — 다른 이미지는 그대로', () => {
    const html = '<p><img src="/api/v1/files/7/content" alt="캡처"> 그리고 <img src="https://x/y.png"></p>';
    const out = toSendablePastedImages(html);
    expect(out.html).toBe(`<p><img src="cid:${pastedContentId(7)}" alt="캡처"> 그리고 <img src="https://x/y.png"></p>`);
    expect(out.inlineUploads).toEqual([{ attachmentId: 7, contentId: 'pasted-7@genia-works' }]);
  });

  it('첨부 id — 칩 업로드 뒤에 본문 이미지 업로드를 겹치지 않게 잇고, 전달 원본은 그대로', () => {
    const chip = (id: number, source: 'upload' | 'forward') =>
      ({ key: `k${id}`, name: 'a', size: 1, mimeType: 'image/png', status: 'done', progress: 100, source, id }) as const;
    const html = '<p><img src="/api/v1/files/601/content"><img src="/api/v1/files/501/content"></p>';
    expect(uploadIdsWithBodyImages([chip(501, 'upload'), chip(31, 'forward')], html)).toEqual({
      attachmentIds: [501, 601],
      forwardAttachmentIds: [31],
    });
  });

  it('붙여넣은 HTML 에서 이 작성창 것이 아닌 본문 이미지만 뺀다', () => {
    const html = '<p>a<img src="/api/v1/files/7/content" alt="x"><img src="/api/v1/files/9/content"><img src="https://x/y.png"></p>';
    expect(dropForeignPastedImages(html, new Set([7]))).toBe('<p>a<img src="/api/v1/files/7/content" alt="x"><img src="https://x/y.png"></p>');
  });

  it('Content-ID 는 서버 허용 문자(공백·꺾쇠·따옴표 없음)만 쓴다', () => {
    expect(pastedContentId(123)).toMatch(/^[\x21-\x7E]+$/);
    expect(pastedContentId(123)).not.toMatch(/[<>"]/);
  });
});
