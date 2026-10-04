import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  prepareAttachments,
  createAttachmentWorkDir,
  attachmentRootDir,
} from './attachment-prep.js';
import type { WorkplaceApiClient } from '../clients/workplace-api.js';

describe('prepareAttachments', () => {
  let dir = '';
  let client: WorkplaceApiClient;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'att-test-'));
    client = {
      listIssueAttachments: vi.fn(),
      downloadIssueAttachment: vi.fn(),
    } as unknown as WorkplaceApiClient;
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('첨부 다운로드 → 파일 기록 + manifest', async () => {
    vi.mocked(client.listIssueAttachments).mockResolvedValue([
      { fileId: 3, originalName: 'a.png', mimeType: 'image/png', sizeBytes: 5 },
    ]);
    vi.mocked(client.downloadIssueAttachment).mockResolvedValue({
      data: Buffer.from('PNGAB'),
      mimeType: 'image/png',
    });

    const manifest = await prepareAttachments(client, 99, 'WP-1', dir);

    expect(manifest).toHaveLength(1);
    expect(manifest[0]).toMatchObject({ originalName: 'a.png', skipped: false });
    expect(existsSync(manifest[0].localPath!)).toBe(true);
    expect(readFileSync(manifest[0].localPath!, 'utf8')).toBe('PNGAB');
  });

  it('파일당 상한 초과 → skip', async () => {
    vi.mocked(client.listIssueAttachments).mockResolvedValue([
      { fileId: 4, originalName: 'big.bin', mimeType: 'application/octet-stream', sizeBytes: 11 * 1024 * 1024 },
    ]);
    const manifest = await prepareAttachments(client, 99, 'WP-1', dir);
    expect(manifest[0].skipped).toBe(true);
    expect(client.downloadIssueAttachment).not.toHaveBeenCalled();
  });

  it('첨부 없음 → 빈 manifest', async () => {
    vi.mocked(client.listIssueAttachments).mockResolvedValue([]);
    expect(await prepareAttachments(client, 99, 'WP-1', dir)).toEqual([]);
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
