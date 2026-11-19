// @vitest-environment jsdom
// 메일 임시저장(WP-577) ↔ 작성창 변환 규칙 — 저장 요청이 백엔드 계약(attachmentIds·forwardAttachmentIds·bodyText)에 맞고,
// 다시 열 때 인용문·첨부·인용문 지움 상태가 그대로 돌아오는지 지킨다.
// 되돌린 보내기(WP-1786)의 인용문 평문은 DOM(template)으로 뽑아 jsdom 에서 돈다.
import { describe, expect, it } from 'vitest';

import type { ComposeAttachment } from '@/lib/mailComposeAttachments';
import type { MailDraftDetail } from '@/types/mailDraft';
import type { EmailMessageDetail } from '@/types/mailMessage';

import {
  buildDraftSavePayload,
  composeFromDraft,
  DRAFT_PREVIEW_SOURCE_CHARS,
  draftPreview,
  draftPreviewSource,
  draftRecipientsLabel,
  savePayloadFromDetail,
} from './mailDraftCompose';

const chip = (over: Partial<ComposeAttachment>): ComposeAttachment => ({
  key: 'k',
  name: 'a.pdf',
  size: 10,
  mimeType: 'application/pdf',
  status: 'done',
  progress: 100,
  source: 'upload',
  ...over,
});

const detail = (over: Partial<MailDraftDetail> = {}): MailDraftDetail => ({
  id: 7,
  accountId: 1,
  mode: 'reply',
  to: ['앨리스 <alice@example.com>'],
  cc: [],
  bcc: ['b@example.com'],
  subject: 'Re: 회의',
  bodyHtml: '<p>답장 본문</p>',
  sourceMessageId: 10,
  quoteRemoved: false,
  attachments: [
    { id: 31, name: '원본.pdf', size: 100, mimeType: 'application/pdf', source: 'forward' },
    { id: 501, name: '내 파일.png', size: 200, mimeType: 'image/png', source: 'upload' },
  ],
  version: 3,
  updatedAt: '2026-10-21T01:00:00Z',
  ...over,
});

const source: EmailMessageDetail = {
  id: 10,
  threadId: 't',
  messageId: 'm@x',
  fromAddress: 'alice@example.com',
  fromName: '앨리스',
  toAddresses: 'me@example.com',
  ccAddresses: null,
  bccAddresses: null,
  subject: '회의',
  sentAt: '2026-10-20T01:00:00Z',
  receivedAt: '2026-10-20T01:00:00Z',
  seen: true,
  flagged: false,
  bodyText: '원본 본문입니다',
  bodyHtml: null,
  attachments: [],
  calendarInvite: null,
};

describe('buildDraftSavePayload', () => {
  it('받는사람 입력을 목록으로 나누고, 본문 HTML·평문과 원본 id·인용문 지움을 싣는다', () => {
    const p = buildDraftSavePayload({
      draft: { accountId: 1, mode: 'forward', sourceMessageId: 10 },
      to: 'a@x.com, 김철수 <kim@x.com>',
      cc: '',
      bcc: 'c@x.com',
      subject: 'Fwd: 회의',
      bodyHtml: '<p>참고하세요</p>',
      bodyText: '참고하세요',
      quoteRemoved: true,
      attachments: [],
    });
    expect(p).toEqual({
      accountId: 1,
      mode: 'forward',
      to: ['a@x.com', '김철수 <kim@x.com>'],
      cc: [],
      bcc: ['c@x.com'],
      subject: 'Fwd: 회의',
      bodyHtml: '<p>참고하세요</p>',
      bodyText: '참고하세요',
      sourceMessageId: 10,
      quoteRemoved: true,
      attachmentIds: [],
      forwardAttachmentIds: [],
      inlineImages: [],
      inlineUploads: [],
      inReplyToMessageId: null,
    });
    expect(p).not.toHaveProperty('version');
  });

  it('첨부는 올라간 것만 출처별 id 목록으로 — 올리는 중·실패는 빠진다', () => {
    const p = buildDraftSavePayload({
      draft: { accountId: 1, mode: 'new' },
      to: '',
      cc: '',
      bcc: '',
      subject: '',
      bodyHtml: '',
      bodyText: '',
      quoteRemoved: false,
      attachments: [
        chip({ key: 'forward-31', source: 'forward', id: 31 }),
        chip({ key: 'upload-1', id: 501 }),
        chip({ key: 'upload-2', status: 'uploading', progress: 40 }),
        chip({ key: 'upload-3', status: 'error', error: '올리지 못했어요' }),
        chip({ key: 'upload-4', id: 502 }),
      ],
    });
    expect(p.attachmentIds).toEqual([501, 502]);
    expect(p.forwardAttachmentIds).toEqual([31]);
    // 새 메일은 원본이 없다
    expect(p.sourceMessageId).toBeNull();
  });
  it('본문에 붙여 넣은 이미지 업로드도 첨부 id 에 함께 묶는다(WP-947) — 칩과 겹치면 한 번만', () => {
    const p = buildDraftSavePayload({
      draft: { accountId: 1, mode: 'new' },
      to: '',
      cc: '',
      bcc: '',
      subject: '',
      bodyHtml: '<p><img src="/api/v1/files/601/content" alt="캡처"></p><p><img src="/api/v1/files/501/content"></p>',
      bodyText: '',
      quoteRemoved: false,
      attachments: [chip({ key: 'upload-1', id: 501 })],
    });
    expect(p.attachmentIds).toEqual([501, 601]);
    // 본문은 업로드 경로 그대로 저장한다 — cid 로 바꾸는 것은 보낼 때뿐
    expect(p.bodyHtml).toContain('/api/v1/files/601/content');
  });

  it('보내기 요청과 같은 이미지 참조를 싣는다(WP-1786) — 붙여 넣은 이미지는 inlineUploads, 인용 이미지는 inlineImages, 답장 대상', () => {
    const p = buildDraftSavePayload({
      draft: { accountId: 1, mode: 'reply', sourceMessageId: 10, inReplyToMessageId: 10 },
      to: '',
      cc: '',
      bcc: '',
      subject: '',
      bodyHtml: '<p><img src="/api/v1/files/601/content"></p>',
      bodyText: '',
      quoteRemoved: false,
      quoteInlineImages: [{ contentId: 'logo@x', attachment: { id: 41, filename: 'logo.png', contentType: 'image/png', sizeBytes: 10, contentId: 'logo@x' } }],
      attachments: [],
    });
    expect(p.inlineUploads).toEqual([{ attachmentId: 601, contentId: 'pasted-601@genia-works' }]);
    expect(p.inlineImages).toEqual([{ attachmentId: 41, contentId: 'logo@x' }]);
    expect(p.inReplyToMessageId).toBe(10);
    // 본문은 여전히 업로드 경로 — 쓰기 창 형태로 저장한다
    expect(p.bodyHtml).toContain('/api/v1/files/601/content');
  });

  it('인용문을 지웠으면 인용 이미지를 싣지 않는다', () => {
    const p = buildDraftSavePayload({
      draft: { accountId: 1, mode: 'reply', sourceMessageId: 10, inReplyToMessageId: 10 },
      to: '',
      cc: '',
      bcc: '',
      subject: '',
      bodyHtml: '',
      bodyText: '',
      quoteRemoved: true,
      quoteInlineImages: [{ contentId: 'logo@x', attachment: { id: 41, filename: 'logo.png', contentType: 'image/png', sizeBytes: 10, contentId: 'logo@x' } }],
      attachments: [],
    });
    expect(p.inlineImages).toEqual([]);
  });
});

describe('draftPreviewSource · draftPreview', () => {
  it('저장 평문은 공백을 한 칸으로 줄인 앞 1000자 — 미리보기는 그 앞 120자(서버와 같은 규칙)', () => {
    expect(draftPreviewSource('  첫 줄\n\n\t둘째   줄  ')).toBe('첫 줄 둘째 줄');
    const long = '가 '.repeat(5000);
    const sent = draftPreviewSource(long);
    expect(Array.from(sent)).toHaveLength(DRAFT_PREVIEW_SOURCE_CHARS);
    expect(Array.from(draftPreview(sent))).toHaveLength(120);
    expect(draftPreview(sent)).toBe(Array.from(long.trim()).slice(0, 120).join(''));
  });

  it('서로게이트 쌍을 자르지 않는다', () => {
    const emoji = '😀'.repeat(3000);
    const sent = draftPreviewSource(emoji);
    expect(Array.from(sent).every((c) => c === '😀')).toBe(true);
    expect(Array.from(draftPreview(sent))).toHaveLength(120);
  });

  it('작성창 저장 요청에는 줄인 평문이 실린다', () => {
    const p = buildDraftSavePayload({
      draft: { accountId: 1, mode: 'new', sourceMessageId: null },
      to: '',
      cc: '',
      bcc: '',
      subject: '',
      bodyHtml: '<p>a</p>',
      bodyText: 'a\n\n  b',
      quoteRemoved: false,
      attachments: [],
    });
    expect(p.bodyText).toBe('a b');
  });
});

describe('savePayloadFromDetail', () => {
  it('되돌리기 — 같은 내용·첨부로 다시 만들고, 평문은 목록 미리보기를 쓴다(version 없음)', () => {
    expect(savePayloadFromDetail(detail(), '답장 본문')).toEqual({
      accountId: 1,
      mode: 'reply',
      to: ['앨리스 <alice@example.com>'],
      cc: [],
      bcc: ['b@example.com'],
      subject: 'Re: 회의',
      bodyHtml: '<p>답장 본문</p>',
      bodyText: '답장 본문',
      sourceMessageId: 10,
      quoteRemoved: false,
      attachmentIds: [501],
      forwardAttachmentIds: [31],
      inlineImages: [],
      inlineUploads: [],
      inReplyToMessageId: null,
    });
  });
});

describe('composeFromDraft', () => {
  it('답장 — 원본으로 인용문을 다시 만들고, 답장 대상·임시저장 id·버전을 잇는다', () => {
    const d = composeFromDraft(detail(), source);
    expect(d).toMatchObject({
      mode: 'reply',
      accountId: 1,
      to: ['앨리스 <alice@example.com>'],
      bcc: ['b@example.com'],
      subject: 'Re: 회의',
      initialHtml: '<p>답장 본문</p>',
      inReplyToMessageId: 10,
      sourceMessageId: 10,
      quoteRemoved: false,
      draftId: 7,
      draftVersion: 3,
    });
    expect(d.quote?.text).toContain('원본 본문입니다');
  });

  it('첨부는 완료 칩 — 전달 원본은 forward-{id}, 올린 파일은 새 업로드 칩(upload-{순번})과 겹치지 않는 key', () => {
    const d = composeFromDraft(detail(), null);
    expect(d.attachments).toEqual([
      { key: 'forward-31', name: '원본.pdf', size: 100, mimeType: 'application/pdf', status: 'done', progress: 100, source: 'forward', id: 31 },
      { key: 'draft-upload-501', name: '내 파일.png', size: 200, mimeType: 'image/png', status: 'done', progress: 100, source: 'upload', id: 501 },
    ]);
  });

  it('본문에 붙여 넣은 이미지 업로드는 칩으로 보이지 않는다(WP-947) — 본문에서 보인다', () => {
    const d = composeFromDraft(detail({ bodyHtml: '<p><img src="/api/v1/files/501/content"></p>' }), null);
    expect(d.attachments?.map((a) => a.key)).toEqual(['forward-31']);
    expect(d.initialHtml).toContain('/api/v1/files/501/content');
  });

  it('인용문을 지웠으면 원본이 있어도 붙이지 않고, 지움 상태를 잇는다', () => {
    const d = composeFromDraft(detail({ quoteRemoved: true }), source);
    expect(d.quote).toBeNull();
    expect(d.quoteRemoved).toBe(true);
  });

  it('원본을 받지 못하면(지워진 메일) 인용문 없이 연다', () => {
    expect(composeFromDraft(detail(), null).quote).toBeNull();
  });

  it('전달 — 답장 대상은 없고 원본 id 만 잇는다', () => {
    const d = composeFromDraft(detail({ mode: 'forward' }), source);
    expect(d.inReplyToMessageId).toBeNull();
    expect(d.sourceMessageId).toBe(10);
    expect(d.quote).not.toBeNull();
  });

  it('새 메일 — 원본·인용문 없음', () => {
    const d = composeFromDraft(detail({ mode: 'new', sourceMessageId: null, attachments: [] }), null);
    expect(d).toMatchObject({ mode: 'new', inReplyToMessageId: null, sourceMessageId: null, quote: null, attachments: [] });
  });
});

// WP-1786 — 보내기 대기열에서 되돌린(또는 보내지 못한) 임시보관은 보내기 요청 그대로다: 본문 뒤에 인용문(div.wp_quote)이 붙어 있고,
// 붙여 넣은 이미지는 cid: 로 바뀌어 있다. 쓰기 창으로 다시 열 때 쓰기 창 형태(인용문은 밖, 이미지는 업로드 경로)로 되돌린다.
describe('composeFromDraft — 보내기 요청 형태(되돌리기)', () => {
  const quoteHtml = '<div class="wp_quote gmail_quote"><hr><div><b>보낸 사람:</b> 앨리스</div><br><p>원본 <img src="cid:logo@x"></p></div>';
  const sent = (over: Partial<MailDraftDetail> = {}) =>
    detail({
      bodyHtml: '<p>답장 본문 <img src="cid:pasted-501@genia-works"></p>' + quoteHtml,
      bodyText: '답장 본문',
      inlineUploads: [{ attachmentId: 501, contentId: 'pasted-501@genia-works' }],
      inlineImages: [{ attachmentId: 41, contentId: 'logo@x' }],
      inReplyToMessageId: 10,
      ...over,
    });

  it('본문 뒤 인용문을 떼고 원본으로 다시 만든다 — 두 번 붙지 않는다', () => {
    const d = composeFromDraft(sent(), source, { sent: true });
    expect(d.initialHtml).not.toContain('wp_quote');
    expect(d.initialHtml).toContain('답장 본문');
    expect(d.quote?.text).toContain('원본 본문입니다');
    expect(d.quoteRemoved).toBe(false);
    expect(d.inReplyToMessageId).toBe(10);
  });

  it('붙여 넣은 이미지의 cid 를 업로드 경로로 되돌리고, 그 업로드는 칩으로 보이지 않는다', () => {
    const d = composeFromDraft(sent(), source, { sent: true });
    expect(d.initialHtml).toContain('<img src="/api/v1/files/501/content">');
    expect(d.initialHtml).not.toContain('cid:pasted-501');
    expect(d.attachments?.map((a) => a.key)).toEqual(['forward-31']);
  });

  it('전달도 원본 id 가 남아 있으면(보내기 요청 작성 문맥) 원본으로 인용 블록을 만든다 — 머리(보낸 사람·날짜)가 채워진다', () => {
    const d = composeFromDraft(sent({ mode: 'forward', inReplyToMessageId: null }), source, { sent: true });
    expect(d.quote?.variant).toBe('forward');
    expect(d.quote?.meta.from).toBe('앨리스');
    expect(d.quote?.meta.dateShort).not.toBe('');
    expect(d.sourceMessageId).toBe(10);
    expect(d.inReplyToMessageId).toBeNull();
    expect(d.initialHtml).not.toContain('wp_quote');
  });

  it('원본을 받지 못하면(전달 — 원본 id 가 없다) 떼어 낸 인용문을 그대로 쓰고 인용 이미지 참조를 잇는다', () => {
    const d = composeFromDraft(sent({ mode: 'forward', sourceMessageId: null, inReplyToMessageId: null }), null, { sent: true });
    expect(d.quote?.html).toBe(quoteHtml);
    expect(d.quote?.variant).toBe('forward');
    expect(d.quote?.inlineImages.map((i) => [i.attachment.id, i.contentId])).toEqual([[41, 'logo@x']]);
    expect(d.quoteRemoved).toBe(false);
    expect(d.initialHtml).not.toContain('wp_quote');
  });

  it('인용문 없이 보낸 답장은 인용문을 지운 것으로 연다 — 원본이 있어도 되살리지 않는다', () => {
    const d = composeFromDraft(sent({ bodyHtml: '<p>답장 본문</p>' }), source, { sent: true });
    expect(d.quote).toBeNull();
    expect(d.quoteRemoved).toBe(true);
  });

  it('되돌리기로 열면 저장 안 된 작성으로 연다 — 고치지 않고 닫아도 쓰기 형태로 다시 저장되게', () => {
    expect(composeFromDraft(sent(), source, { sent: true }).unsaved).toBe(true);
    // 평범한 임시저장은 그대로 저장됨 상태로 연다.
    expect(composeFromDraft(detail(), source).unsaved).toBeFalsy();
  });

  it('표시 없이 보내기 형태가 남은 행(되돌린 뒤 다시 저장하지 못함)도 본문으로 알아보고 되돌린다 — 인용문이 두 번 붙지 않는다', () => {
    const d = composeFromDraft(sent(), source);
    expect(d.initialHtml).not.toContain('wp_quote');
    expect(d.initialHtml).toContain('<img src="/api/v1/files/501/content">');
    expect(d.quote?.text).toContain('원본 본문입니다');
    // 다시 쓰기 형태로 저장되도록 저장 안 된 작성으로 연다.
    expect(d.unsaved).toBe(true);
  });

  it('인용문을 지운 채 보내 표시가 남지 않은 행은 서버가 남긴 quoteRemoved 로 인용문을 되살리지 않는다', () => {
    const d = composeFromDraft(sent({ bodyHtml: '<p>답장 본문 <img src="cid:pasted-501@genia-works"></p>', quoteRemoved: true }), source);
    expect(d.quote).toBeNull();
    expect(d.quoteRemoved).toBe(true);
    expect(d.initialHtml).toContain('/api/v1/files/501/content');
  });

  it('보내지 못한(FAILED) 행도 보내기 요청 형태로 다룬다', () => {
    const d = composeFromDraft(sent({ sendState: 'FAILED', sendError: '연결 실패' }), source);
    expect(d.initialHtml).not.toContain('wp_quote');
    expect(d.quote?.text).toContain('원본 본문입니다');
  });
});

describe('draftRecipientsLabel', () => {
  it('짧은 이름을 쉼표로 잇고, 없으면 빈 문자열', () => {
    expect(draftRecipientsLabel(['앨리스 <alice@example.com>', 'bob@example.com'])).toBe('앨리스, bob');
    expect(draftRecipientsLabel([])).toBe('');
  });
});
