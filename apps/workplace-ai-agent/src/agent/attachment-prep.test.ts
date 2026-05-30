import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { prepareAttachments } from './attachment-prep.js';
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
