// 메일 임시저장(WP-577) ↔ 작성창 변환 규칙 — 저장 요청이 백엔드 계약(attachmentIds·forwardAttachmentIds·bodyText)에 맞고,
// 다시 열 때 인용문·첨부·인용문 지움 상태가 그대로 돌아오는지 지킨다.
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

describe('draftRecipientsLabel', () => {
  it('짧은 이름을 쉼표로 잇고, 없으면 빈 문자열', () => {
    expect(draftRecipientsLabel(['앨리스 <alice@example.com>', 'bob@example.com'])).toBe('앨리스, bob');
    expect(draftRecipientsLabel([])).toBe('');
  });
});
