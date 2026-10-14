import { describe, it, expect, vi, beforeEach } from 'vitest';

import { collectAttachments, findThreadAttachmentMeta, NO_EXTRACTION } from './attachment-source.js';
import type { ChatMessageItem, WorkplaceApiClient } from '../clients/workplace-api.js';

const READY = { status: 'READY' as const, totalChars: 10, truncated: false, reasonCode: null, reason: null };

function msg(id: number, attachments: ChatMessageItem['attachments'], deleted = false): ChatMessageItem {
  return { id, authorName: 'A', authorKind: 'HUMAN', body: 'b', createdAt: 't', deleted, attachments };
}

describe('collectAttachments', () => {
  let client: WorkplaceApiClient;
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    client = { listThreadIssueAttachments: vi.fn().mockResolvedValue([]) } as unknown as WorkplaceApiClient;
  });

  it('이슈 첨부 + 챗 메시지 첨부를 출처와 함께 병합(이슈 먼저, 챗은 메시지 id 오름차순)', async () => {
    vi.mocked(client.listThreadIssueAttachments).mockResolvedValue([
      { fileId: 1, originalName: 'spec.pdf', mimeType: 'application/pdf', sizeBytes: 9, extraction: READY },
    ]);
    const recent = [
      msg(12, [{ fileId: 3, messageId: 12, originalName: 'b.docx', mimeType: 'x', sizeBytes: 1 }]),
      msg(11, [{ fileId: 2, messageId: 11, originalName: 'a.png', mimeType: 'image/png', sizeBytes: 1 }]),
    ];
    const { attachments: out } = await collectAttachments(client, 99, 5, recent);
    expect(out.map((a) => a.fileId)).toEqual([1, 2, 3]);
    expect(out[0].origin).toEqual({ kind: 'issue', threadId: 5 });
    // 이슈 첨부 목록도 스레드 경유로 받는다(WP-244).
    expect(client.listThreadIssueAttachments).toHaveBeenCalledWith(99, 5);
    expect(out[1].origin).toEqual({ kind: 'chat', threadId: 5, messageId: 11 });
    expect(out[0].extraction).toEqual(READY);
  });

  it('extraction 누락 → NONE', async () => {
    const { attachments: out } = await collectAttachments(client, 99, 5, [
      msg(1, [{ fileId: 2, messageId: 1, originalName: 'a', mimeType: 'x', sizeBytes: 1 }]),
    ]);
    expect(out[0].extraction).toEqual(NO_EXTRACTION);
  });

  it('삭제된 메시지의 첨부는 제외', async () => {
    const { attachments: out } = await collectAttachments(client, 99, 5, [
      msg(1, [{ fileId: 2, messageId: 1, originalName: 'a', mimeType: 'x', sizeBytes: 1 }], true),
    ]);
    expect(out).toEqual([]);
  });

  it('같은 fileId 는 이슈 첨부 우선으로 한 번만', async () => {
    vi.mocked(client.listThreadIssueAttachments).mockResolvedValue([
      { fileId: 2, originalName: 'a', mimeType: 'x', sizeBytes: 1 },
    ]);
    const { attachments: out } = await collectAttachments(client, 99, 5, [
      msg(1, [{ fileId: 2, messageId: 1, originalName: 'a', mimeType: 'x', sizeBytes: 1 }]),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].origin.kind).toBe('issue');
  });

  it('이슈_목록_실패_시_챗_첨부만 + issueListFailed=true', async () => {
    vi.mocked(client.listThreadIssueAttachments).mockRejectedValue(new Error('403'));
    const r = await collectAttachments(client, 99, 5, [
      msg(1, [{ fileId: 2, messageId: 1, originalName: 'a', mimeType: 'x', sizeBytes: 1 }]),
    ]);
    expect(r.attachments.map((a) => a.fileId)).toEqual([2]);
    expect(r.issueListFailed).toBe(true);
    expect(console.warn).toHaveBeenCalled();
  });

  it('이슈 목록 성공 → issueListFailed=false', async () => {
    const r = await collectAttachments(client, 99, 5, []);
    expect(r.issueListFailed).toBe(false);
  });
});

// WP-250: 이슈 챗 첨부 도구가 이미지 형식·출처를 알아내는 단건 메타 조회.
describe('findThreadAttachmentMeta', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  const issueMeta = { fileId: 1, originalName: 'spec.png', mimeType: 'image/png', sizeBytes: 9, extraction: READY };
  const mk = (over: Partial<Record<'listThreadIssueAttachments' | 'getChatMessages', unknown>> = {}) =>
    ({
      listThreadIssueAttachments: vi.fn().mockResolvedValue([issueMeta]),
      getChatMessages: vi.fn().mockResolvedValue([msg(11, [{ fileId: 2, messageId: 11, originalName: 'a.heic', mimeType: 'image/heic', sizeBytes: 1 }])]),
      ...over,
    }) as unknown as WorkplaceApiClient;

  it('이슈 첨부에 있으면 그것(메시지 조회 없음)', async () => {
    const c = mk();
    const a = await findThreadAttachmentMeta(c, 99, 5, 1);
    expect(a).toMatchObject({ fileId: 1, origin: { kind: 'issue', threadId: 5 }, mimeType: 'image/png' });
    expect(c.getChatMessages).not.toHaveBeenCalled();
  });

  it('없으면 최근 메시지 첨부에서 찾아 messageId 를 함께 준다', async () => {
    const a = await findThreadAttachmentMeta(mk(), 99, 5, 2);
    expect(a).toMatchObject({ fileId: 2, origin: { kind: 'chat', threadId: 5, messageId: 11 }, mimeType: 'image/heic' });
  });

  it('어디에도 없거나 조회가 실패하면 undefined(던지지 않는다)', async () => {
    expect(await findThreadAttachmentMeta(mk(), 99, 5, 77)).toBeUndefined();
    const failing = mk({ listThreadIssueAttachments: vi.fn().mockRejectedValue(new Error('403')), getChatMessages: vi.fn().mockRejectedValue(new Error('500')) });
    expect(await findThreadAttachmentMeta(failing, 99, 5, 1)).toBeUndefined();
  });
});
