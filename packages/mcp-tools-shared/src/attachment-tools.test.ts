import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { IMAGE_MAX_BYTES, READ_ATTACHMENT_DEFAULT_LIMIT } from './attachment-read.js';
import { buildAttachmentTools, readAttachmentInput } from './attachment-tools.js';
import { resultText, type McpContent } from './mcp-content.js';
import type { AttachmentToolClient, ExtractedTextSlice } from './tool-client.js';

/** 서버 ExtractedTextSlice 응답(Task 3 보고서 형식) — status 별 기본값을 채우고 필요한 필드만 덮어쓴다. */
function slice(status: ExtractedTextSlice['status'], over: Partial<ExtractedTextSlice> = {}): ExtractedTextSlice {
  return {
    fileId: 55,
    status,
    offset: 0,
    totalChars: null,
    truncated: null,
    nextOffset: null,
    text: null,
    reasonCode: null,
    reason: null,
    ...over,
  };
}

const READY = slice('READY', { totalChars: 11, truncated: false, nextOffset: 6, text: '가나다라마😀' });
const IMAGE_SKIP = slice('SKIPPED', { reasonCode: 'IMAGE', reason: '이미지 파일은 글자를 추출하지 않습니다.' });
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

function mockClient(): AttachmentToolClient {
  return {
    readIssueAttachmentText: vi.fn().mockResolvedValue(READY),
    listIssueAttachments: vi.fn().mockResolvedValue([]),
    downloadIssueAttachment: vi.fn().mockResolvedValue({ data: PNG, mimeType: 'image/png' }),
    readDriveFileText: vi.fn().mockResolvedValue(READY),
    listDriveFileVersions: vi.fn().mockResolvedValue([]),
    downloadDriveFile: vi.fn().mockResolvedValue({ data: PNG, mimeType: 'image/png' }),
  };
}

const readAttachment = (c: AttachmentToolClient) => buildAttachmentTools(c).find((t) => t.name === 'read_attachment')!;

describe('read_attachment 입력 스키마', () => {
  // 서버 레이어가 inputSchema.shape 를 registerTool 에 넘기므로 superRefine 뒤에도 z.object 여야 한다.
  it('최상위는 z.object 이고 shape 에 source·식별자·범위가 있다', () => {
    expect(readAttachmentInput).toBeInstanceOf(z.ZodObject);
    expect(Object.keys(readAttachmentInput.shape).sort()).toEqual(['driveFileId', 'fileId', 'issueKey', 'limit', 'offset', 'source']);
  });

  it('JSON 스키마로 직렬화된다(MCP 클라이언트가 받는 형식) — 최상위 type object, source 만 필수', () => {
    const js = z.toJSONSchema(readAttachmentInput) as { type: string; required: string[]; properties: Record<string, unknown> };
    expect(js.type).toBe('object');
    expect(js.required).toEqual(['source']);
    expect(js.properties.source).toMatchObject({ enum: ['issue', 'drive'] });
  });

  it('source 별 필수 필드를 확인하고, 다른 source 의 식별자를 섞으면 거부한다', () => {
    expect(() => readAttachmentInput.parse({ source: 'issue', issueKey: 'WP-1' })).toThrow(/issueKey 와 fileId/);
    expect(() => readAttachmentInput.parse({ source: 'drive' })).toThrow(/driveFileId 가 필요/);
    expect(() => readAttachmentInput.parse({ source: 'issue', issueKey: 'WP-1', fileId: 3, driveFileId: 4 })).toThrow(/driveFileId 를 주지/);
    expect(() => readAttachmentInput.parse({ source: 'drive', driveFileId: 4, fileId: 3 })).toThrow(/issueKey·fileId 를 주지/);
    expect(readAttachmentInput.parse({ source: 'drive', driveFileId: 4 })).toMatchObject({ source: 'drive', driveFileId: 4 });
  });

  it('limit 은 1..32000, offset 은 0 이상', () => {
    const base = { source: 'drive' as const, driveFileId: 4 };
    expect(() => readAttachmentInput.parse({ ...base, limit: 0 })).toThrow();
    expect(() => readAttachmentInput.parse({ ...base, limit: 32001 })).toThrow();
    expect(() => readAttachmentInput.parse({ ...base, offset: -1 })).toThrow();
    expect(readAttachmentInput.parse({ ...base, limit: 32000, offset: 0 })).toMatchObject({ limit: 32000, offset: 0 });
  });
});

describe('read_attachment — 이슈 첨부', () => {
  it('READY: 구간 읽기 응답을 그대로 JSON 으로. limit 생략 시 기본 12000, offset 생략은 미지정', async () => {
    const c = mockClient();
    const out = await readAttachment(c).handler({ source: 'issue', issueKey: 'WP-1', fileId: 55 });
    expect(c.readIssueAttachmentText).toHaveBeenCalledWith('WP-1', 55, { offset: undefined, limit: READ_ATTACHMENT_DEFAULT_LIMIT });
    expect(JSON.parse(resultText(out))).toEqual(READY);
    expect(c.downloadIssueAttachment).not.toHaveBeenCalled();
  });

  it('offset·limit 을 넘기고, null 은 미지정으로 본다', async () => {
    const c = mockClient();
    await readAttachment(c).handler({ source: 'issue', issueKey: 'WP-1', fileId: 55, offset: 6, limit: 100 });
    expect(c.readIssueAttachmentText).toHaveBeenLastCalledWith('WP-1', 55, { offset: 6, limit: 100 });
    await readAttachment(c).handler({ source: 'issue', issueKey: 'WP-1', fileId: 55, offset: null, limit: null });
    expect(c.readIssueAttachmentText).toHaveBeenLastCalledWith('WP-1', 55, { offset: undefined, limit: READ_ATTACHMENT_DEFAULT_LIMIT });
  });

  it.each([
    ['PENDING', slice('PENDING')],
    ['NONE', slice('NONE')],
    ['FAILED', slice('FAILED', { reasonCode: 'EXTRACTION_ERROR', reason: '텍스트 추출 중 오류가 발생했습니다.' })],
    ['SKIPPED(이미지 아님)', slice('SKIPPED', { reasonCode: 'UNSUPPORTED_TYPE', reason: '이 형식은 텍스트 추출을 지원하지 않습니다.' })],
  ])('%s: text 없이 상태·사유를 그대로 돌려주고 원본은 받지 않는다', async (_label, s) => {
    const c = mockClient();
    vi.mocked(c.readIssueAttachmentText).mockResolvedValue(s);
    const out = await readAttachment(c).handler({ source: 'issue', issueKey: 'WP-1', fileId: 55 });
    expect(JSON.parse(resultText(out))).toEqual(s);
    expect(c.listIssueAttachments).not.toHaveBeenCalled();
    expect(c.downloadIssueAttachment).not.toHaveBeenCalled();
  });

  it('이미지(SKIPPED·IMAGE): 목록으로 형식·크기를 확인한 뒤 원본을 받아 [설명, image] 블록으로', async () => {
    const c = mockClient();
    vi.mocked(c.readIssueAttachmentText).mockResolvedValue(IMAGE_SKIP);
    vi.mocked(c.listIssueAttachments).mockResolvedValue([{ fileId: 55, originalName: '화면.png', mimeType: 'image/png', sizeBytes: 4 }]);
    const out = (await readAttachment(c).handler({ source: 'issue', issueKey: 'WP-1', fileId: 55 })) as McpContent[];
    expect(c.downloadIssueAttachment).toHaveBeenCalledWith('WP-1', 55);
    expect(out).toEqual([
      { type: 'text', text: '이슈 WP-1 첨부 이미지 "화면.png" (image/png, 4B)' },
      { type: 'image', data: Buffer.from(PNG).toString('base64'), mimeType: 'image/png' },
    ]);
  });

  it('이미지 크기 상한 초과: 원본을 받지 않고 안내 문구만', async () => {
    const c = mockClient();
    vi.mocked(c.readIssueAttachmentText).mockResolvedValue(IMAGE_SKIP);
    vi.mocked(c.listIssueAttachments).mockResolvedValue([
      { fileId: 55, originalName: 'big.jpg', mimeType: 'image/jpeg', sizeBytes: IMAGE_MAX_BYTES + 1 },
    ]);
    const out = await readAttachment(c).handler({ source: 'issue', issueKey: 'WP-1', fileId: 55 });
    expect(typeof out).toBe('string');
    expect(out).toContain(`크기(${IMAGE_MAX_BYTES + 1}B)`);
    expect(out).not.toContain('형식(');
    expect(c.downloadIssueAttachment).not.toHaveBeenCalled();
  });

  it('보낼 수 없는 이미지 형식(예: HEIC): 원본을 받지 않고 형식만 사유로', async () => {
    const c = mockClient();
    vi.mocked(c.readIssueAttachmentText).mockResolvedValue(IMAGE_SKIP);
    vi.mocked(c.listIssueAttachments).mockResolvedValue([{ fileId: 55, originalName: 'a.heic', mimeType: 'image/heic', sizeBytes: 10 }]);
    const out = await readAttachment(c).handler({ source: 'issue', issueKey: 'WP-1', fileId: 55 });
    expect(out).toContain('형식(image/heic)');
    expect(out).not.toContain('크기(');
    expect(c.downloadIssueAttachment).not.toHaveBeenCalled();
  });
});

describe('read_attachment — 드라이브 파일', () => {
  it('READY: core fileId 를 지우고 driveFileId 로 돌려준다(#840)', async () => {
    const c = mockClient();
    const out = await readAttachment(c).handler({ source: 'drive', driveFileId: 9, offset: 6, limit: 500 });
    expect(c.readDriveFileText).toHaveBeenCalledWith(9, { offset: 6, limit: 500 });
    const { fileId: _coreFileId, ...rest } = READY;
    expect(JSON.parse(resultText(out))).toEqual({ driveFileId: 9, ...rest });
    expect(JSON.parse(resultText(out))).not.toHaveProperty('fileId');
  });

  it.each([
    ['PENDING', slice('PENDING')],
    ['NONE', slice('NONE')],
    ['FAILED', slice('FAILED', { reasonCode: 'SUMMARY_FAILED', reason: '요약에 실패했습니다.' })],
    ['SKIPPED(이미지 아님)', slice('SKIPPED', { reasonCode: 'TOO_LARGE', reason: '파일이 커서(25MB 초과) 텍스트를 추출하지 않았습니다.' })],
  ])('%s: 상태·사유만, 원본은 받지 않는다', async (_label, s) => {
    const c = mockClient();
    vi.mocked(c.readDriveFileText).mockResolvedValue(s);
    const out = JSON.parse(resultText(await readAttachment(c).handler({ source: 'drive', driveFileId: 9 })));
    expect(out).toMatchObject({ driveFileId: 9, status: s.status, text: null, reasonCode: s.reasonCode, reason: s.reason });
    expect(c.downloadDriveFile).not.toHaveBeenCalled();
  });

  it('이미지: 현재 버전 크기를 먼저 보고, 원본 Content-Type 파라미터를 떼어 image 블록으로', async () => {
    const c = mockClient();
    vi.mocked(c.readDriveFileText).mockResolvedValue(IMAGE_SKIP);
    vi.mocked(c.listDriveFileVersions).mockResolvedValue([
      { versionNo: 2, sizeBytes: 4, current: true },
      { versionNo: 1, sizeBytes: IMAGE_MAX_BYTES + 1, current: false },
    ]);
    vi.mocked(c.downloadDriveFile).mockResolvedValue({ data: PNG, mimeType: 'image/png;charset=UTF-8' });
    const out = (await readAttachment(c).handler({ source: 'drive', driveFileId: 9 })) as McpContent[];
    expect(c.downloadDriveFile).toHaveBeenCalledWith(9);
    expect(out[1]).toEqual({ type: 'image', data: Buffer.from(PNG).toString('base64'), mimeType: 'image/png' });
    expect(out[0]).toEqual({ type: 'text', text: '드라이브 이미지(driveFileId 9) (image/png, 4B)' });
  });

  it('이미지 크기 상한 초과(현재 버전): 원본을 받지 않고 안내 문구만', async () => {
    const c = mockClient();
    vi.mocked(c.readDriveFileText).mockResolvedValue(IMAGE_SKIP);
    vi.mocked(c.listDriveFileVersions).mockResolvedValue([{ versionNo: 1, sizeBytes: IMAGE_MAX_BYTES + 1, current: true }]);
    const out = await readAttachment(c).handler({ source: 'drive', driveFileId: 9 });
    expect(out).toContain(`크기(${IMAGE_MAX_BYTES + 1}B)`);
    expect(c.downloadDriveFile).not.toHaveBeenCalled();
  });

  it('받은 원본이 보낼 수 없는 형식이면(버전 정보 없음) base64 없이 안내 문구', async () => {
    const c = mockClient();
    vi.mocked(c.readDriveFileText).mockResolvedValue(IMAGE_SKIP);
    vi.mocked(c.downloadDriveFile).mockResolvedValue({ data: PNG, mimeType: 'image/svg+xml' });
    const out = await readAttachment(c).handler({ source: 'drive', driveFileId: 9 });
    expect(typeof out).toBe('string');
    expect(out).toContain('형식(image/svg+xml)');
  });
});
