import { describe, it, expect } from 'vitest';

import { buildChatUserMessage } from './chat-user-message.js';
import type { ChatMessagePostedPayload } from '../types/chat-events.js';
import type { ChatMessageItem } from '../clients/workplace-api.js';
import type { AttachmentManifestEntry } from './attachment-prep.js';

const payload: ChatMessagePostedPayload = {
  projectKey: 'WP',
  issueKey: 'WP-1',
  issueId: 1,
  threadId: 5,
  messageId: 9,
  actor: { id: 7, username: 'alice', name: 'Alice', kind: 'HUMAN' },
  body: '@AI 첨부 요약해줘',
  mentions: [{ id: 99, username: 'ai', name: 'AI', kind: 'AGENT' }],
  occurredAt: '2026-05-30T12:00:00Z',
};
const recent: ChatMessageItem[] = [
  { id: 8, authorName: 'Alice', authorKind: 'HUMAN', body: '이전 메시지', createdAt: 't', deleted: false },
];

describe('buildChatUserMessage', () => {
  it('trigger·thread·이슈키·threadId 포함', () => {
    const msg = buildChatUserMessage(payload, recent, []);
    expect(msg).toContain('WP-1');
    expect(msg).toContain('첨부 요약해줘');
    expect(msg).toContain('이전 메시지');
    expect(msg).toContain('5'); // threadId
  });

  it('첨부 manifest 의 localPath·skip 사유 표기', () => {
    const att: AttachmentManifestEntry[] = [
      { fileId: 3, originalName: 'a.png', mimeType: 'image/png', sizeBytes: 5, skipped: false, localPath: '/tmp/x/3-a.png' },
      { fileId: 4, originalName: 'big.bin', mimeType: 'application/octet-stream', sizeBytes: 99, skipped: true, skipReason: '상한 초과' },
    ];
    const msg = buildChatUserMessage(payload, recent, att);
    expect(msg).toContain('/tmp/x/3-a.png');
    expect(msg).toContain('a.png');
    expect(msg).toContain('상한 초과');
  });

  it('첨부 없음 → 첨부 섹션에 없음 표기', () => {
    expect(buildChatUserMessage(payload, recent, [])).toContain('첨부 없음');
  });
});
