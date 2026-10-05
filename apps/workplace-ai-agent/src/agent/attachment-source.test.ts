import { describe, it, expect, vi, beforeEach } from 'vitest';

import { collectAttachments, NO_EXTRACTION } from './attachment-source.js';
import type { ChatMessageItem, WorkplaceApiClient } from '../clients/workplace-api.js';

const READY = { status: 'READY' as const, totalChars: 10, truncated: false, reasonCode: null, reason: null };

function msg(id: number, attachments: ChatMessageItem['attachments'], deleted = false): ChatMessageItem {
  return { id, authorName: 'A', authorKind: 'HUMAN', body: 'b', createdAt: 't', deleted, attachments };
}

describe('collectAttachments', () => {
  let client: WorkplaceApiClient;
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    client = { listIssueAttachments: vi.fn().mockResolvedValue([]) } as unknown as WorkplaceApiClient;
  });

  it('이슈 첨부 + 챗 메시지 첨부를 출처와 함께 병합(이슈 먼저, 챗은 메시지 id 오름차순)', async () => {
    vi.mocked(client.listIssueAttachments).mockResolvedValue([
      { fileId: 1, originalName: 'spec.pdf', mimeType: 'application/pdf', sizeBytes: 9, extraction: READY },
    ]);
    const recent = [
      msg(12, [{ fileId: 3, messageId: 12, originalName: 'b.docx', mimeType: 'x', sizeBytes: 1 }]),
      msg(11, [{ fileId: 2, messageId: 11, originalName: 'a.png', mimeType: 'image/png', sizeBytes: 1 }]),
    ];
    const out = await collectAttachments(client, 99, 'WP-1', 5, recent);
    expect(out.map((a) => a.fileId)).toEqual([1, 2, 3]);
    expect(out[0].origin).toEqual({ kind: 'issue', issueKey: 'WP-1' });
    expect(out[1].origin).toEqual({ kind: 'chat', threadId: 5, messageId: 11 });
    expect(out[0].extraction).toEqual(READY);
  });

  it('extraction 누락 → NONE', async () => {
    const out = await collectAttachments(client, 99, 'WP-1', 5, [
      msg(1, [{ fileId: 2, messageId: 1, originalName: 'a', mimeType: 'x', sizeBytes: 1 }]),
    ]);
    expect(out[0].extraction).toEqual(NO_EXTRACTION);
  });

  it('삭제된 메시지의 첨부는 제외', async () => {
    const out = await collectAttachments(client, 99, 'WP-1', 5, [
      msg(1, [{ fileId: 2, messageId: 1, originalName: 'a', mimeType: 'x', sizeBytes: 1 }], true),
    ]);
    expect(out).toEqual([]);
  });

  it('같은 fileId 는 이슈 첨부 우선으로 한 번만', async () => {
    vi.mocked(client.listIssueAttachments).mockResolvedValue([
      { fileId: 2, originalName: 'a', mimeType: 'x', sizeBytes: 1 },
    ]);
    const out = await collectAttachments(client, 99, 'WP-1', 5, [
      msg(1, [{ fileId: 2, messageId: 1, originalName: 'a', mimeType: 'x', sizeBytes: 1 }]),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].origin.kind).toBe('issue');
  });

  it('이슈_목록_실패_시_챗_첨부만', async () => {
    vi.mocked(client.listIssueAttachments).mockRejectedValue(new Error('403'));
    const out = await collectAttachments(client, 99, 'WP-1', 5, [
      msg(1, [{ fileId: 2, messageId: 1, originalName: 'a', mimeType: 'x', sizeBytes: 1 }]),
    ]);
    expect(out.map((a) => a.fileId)).toEqual([2]);
    expect(console.warn).toHaveBeenCalled();
  });
});
