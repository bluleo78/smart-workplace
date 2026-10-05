import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { downloadAttachments, createAttachmentWorkDir, attachmentRootDir } from './attachment-prep.js';
import { NO_EXTRACTION, type AgentAttachment } from './attachment-source.js';
import type { WorkplaceApiClient } from '../clients/workplace-api.js';

function att(fileId: number, origin: AgentAttachment['origin'], sizeBytes = 5, name = 'a.png'): AgentAttachment {
  return { origin, fileId, originalName: name, mimeType: 'image/png', sizeBytes, extraction: NO_EXTRACTION };
}

describe('downloadAttachments', () => {
  let dir = '';
  let client: WorkplaceApiClient;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'att-test-'));
    client = {
      downloadIssueAttachment: vi.fn().mockResolvedValue({ data: Buffer.from('PNGAB'), mimeType: 'image/png' }),
      downloadChatAttachment: vi.fn().mockResolvedValue({ data: Buffer.from('CHAT'), mimeType: 'image/png' }),
    } as unknown as WorkplaceApiClient;
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('이슈 첨부 → downloadIssueAttachment 로 받아 파일 기록', async () => {
    const r = await downloadAttachments(client, 99, [att(3, { kind: 'issue', issueKey: 'WP-1' })], dir);
    const o = r.get(3) as { localPath: string };
    expect(existsSync(o.localPath)).toBe(true);
    expect(readFileSync(o.localPath, 'utf8')).toBe('PNGAB');
    expect(client.downloadIssueAttachment).toHaveBeenCalledWith(99, 'WP-1', 3);
  });

  it('챗 첨부 → downloadChatAttachment(threadId, messageId)', async () => {
    const r = await downloadAttachments(client, 99, [att(8, { kind: 'chat', threadId: 5, messageId: 9 })], dir);
    expect(client.downloadChatAttachment).toHaveBeenCalledWith(99, 5, 9, 8);
    expect(readFileSync((r.get(8) as { localPath: string }).localPath, 'utf8')).toBe('CHAT');
  });

  it('파일당 상한 초과 → skipReason, 다운로드 안 함', async () => {
    const r = await downloadAttachments(client, 99, [att(4, { kind: 'issue', issueKey: 'WP-1' }, 11 * 1024 * 1024)], dir);
    expect(r.get(4)).toEqual({ skipReason: '파일당 상한(10MB) 초과' });
    expect(client.downloadIssueAttachment).not.toHaveBeenCalled();
  });

  it('다운로드 실패 → skipReason 에 사유', async () => {
    vi.mocked(client.downloadIssueAttachment).mockRejectedValue(new Error('boom'));
    const r = await downloadAttachments(client, 99, [att(3, { kind: 'issue', issueKey: 'WP-1' })], dir);
    expect(r.get(3)).toEqual({ skipReason: '다운로드 실패: boom' });
  });
});

// WP-236: opencode 는 실경로 기준으로 인스턴스 디렉터리 안/밖을 판정한다 — 심링크 tmpdir(macOS /var→/private/var)
// 경로를 프롬프트에 넣으면 첨부가 '외부'로 판정돼 read 가 거부된다. 실행 폴더는 고정 루트 아래여야 한다.
describe('attachmentRootDir / createAttachmentWorkDir', () => {
  it('루트는 에이전트별 실경로이고, 실행 폴더는 루트 바로 아래 실경로로 만들어진다', () => {
    const root = attachmentRootDir(7);
    expect(root).toBe(realpathSync(root));
    expect(attachmentRootDir(8)).not.toBe(root); // 다른 에이전트 실행 폴더가 보이지 않도록 분리
    const dir = createAttachmentWorkDir(7, 42);
    try {
      expect(existsSync(dir)).toBe(true);
      expect(path.dirname(dir)).toBe(root);
      expect(path.basename(dir).startsWith('chat-agent-42-')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
