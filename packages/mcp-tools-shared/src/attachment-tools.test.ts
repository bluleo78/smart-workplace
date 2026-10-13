import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { FileTooLargeError, IMAGE_MAX_BYTES, READ_ATTACHMENT_DEFAULT_LIMIT } from './attachment-read.js';
import { buildAttachmentTools, readFileInput } from './attachment-tools.js';
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

/** 이슈 첨부 읽기 출력 — 서버 슬라이스의 fileId 가 attachmentId 로 바뀐다. */
const issueView = ({ fileId, ...rest }: ExtractedTextSlice) => ({ attachmentId: fileId, ...rest });

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
    readWikiAttachmentText: vi.fn().mockResolvedValue(READY),
    downloadWikiAttachment: vi.fn().mockResolvedValue({ data: PNG, mimeType: 'image/png' }),
    readMessageAttachmentText: vi.fn().mockResolvedValue(READY),
    downloadMessageAttachment: vi.fn().mockResolvedValue({ data: PNG, mimeType: 'image/png' }),
    readMailAttachmentText: vi.fn().mockResolvedValue(READY),
    downloadMailAttachment: vi.fn().mockResolvedValue({ data: PNG, mimeType: 'image/png' }),
  };
}

const readAttachment = (c: AttachmentToolClient) => buildAttachmentTools(c).find((t) => t.name === 'read_file')!;

describe('read_file 입력 스키마', () => {
  // 서버 레이어가 inputSchema.shape 를 registerTool 에 넘기므로 superRefine 뒤에도 z.object 여야 한다.
  it('최상위는 z.object 이고 shape 에 source·식별자·범위가 있다', () => {
    expect(readFileInput).toBeInstanceOf(z.ZodObject);
    expect(Object.keys(readFileInput.shape).sort()).toEqual(['attachmentId', 'channelId', 'driveFileId', 'issueKey', 'limit', 'messageId', 'offset', 'pageId', 'source']);
  });

  it('JSON 스키마로 직렬화된다(MCP 클라이언트가 받는 형식) — 최상위 type object, source 만 필수', () => {
    const js = z.toJSONSchema(readFileInput) as { type: string; required: string[]; properties: Record<string, unknown> };
    expect(js.type).toBe('object');
    expect(js.required).toEqual(['source']);
    expect(js.properties.source).toMatchObject({ enum: ['issue', 'drive', 'wiki', 'message', 'mail'] });
  });

  it('source 별 필수 필드를 확인하고, 다른 source 의 식별자를 섞으면 거부한다', () => {
    expect(() => readFileInput.parse({ source: 'issue', issueKey: 'WP-1' })).toThrow(/issueKey·attachmentId 가 필요/);
    expect(() => readFileInput.parse({ source: 'drive' })).toThrow(/driveFileId 가 필요/);
    expect(() => readFileInput.parse({ source: 'issue', issueKey: 'WP-1', attachmentId: 3, driveFileId: 4 })).toThrow(/driveFileId 를 주지/);
    expect(() => readFileInput.parse({ source: 'drive', driveFileId: 4, attachmentId: 3 })).toThrow(/attachmentId 를 주지/);
    expect(readFileInput.parse({ source: 'drive', driveFileId: 4 })).toMatchObject({ source: 'drive', driveFileId: 4 });
  });

  it('쓰지 않는 source 의 식별자를 null 로 채워도 "없음"으로 받는다(실제 값을 섞으면 여전히 거부)', () => {
    expect(readFileInput.parse({ source: 'drive', driveFileId: 9, issueKey: null, attachmentId: null })).toMatchObject({ source: 'drive', driveFileId: 9 });
    expect(readFileInput.parse({ source: 'issue', issueKey: 'WP-1', attachmentId: 3, driveFileId: null })).toMatchObject({ source: 'issue', attachmentId: 3 });
    // null 은 필수 필드도 채우지 못한다.
    expect(() => readFileInput.parse({ source: 'drive', driveFileId: null })).toThrow(/driveFileId 가 필요/);
    expect(() => readFileInput.parse({ source: 'issue', issueKey: null, attachmentId: 3 })).toThrow(/issueKey·attachmentId 가 필요/);
    expect(() => readFileInput.parse({ source: 'drive', driveFileId: 9, issueKey: 'WP-1', attachmentId: null })).toThrow(/issueKey 를 주지/);
  });

  // WP-358: 노트·메시지·메일 첨부는 attachmentId 를 재사용하고 pageId·channelId·messageId 만 더한다.
  it('wiki·message·mail 의 필수 식별자를 확인하고 남는 식별자는 거부한다 (WP-358)', () => {
    expect(() => readFileInput.parse({ source: 'wiki', attachmentId: 3 })).toThrow(/pageId·attachmentId 가 필요/);
    expect(() => readFileInput.parse({ source: 'message', channelId: 1, attachmentId: 3 })).toThrow(/channelId·messageId·attachmentId 가 필요/);
    expect(() => readFileInput.parse({ source: 'mail' })).toThrow(/attachmentId 가 필요/);
    expect(() => readFileInput.parse({ source: 'mail', attachmentId: 3, messageId: 9 })).toThrow(/messageId 를 주지/);
    expect(() => readFileInput.parse({ source: 'wiki', pageId: 1, attachmentId: 3, channelId: 2 })).toThrow(/channelId 를 주지/);
    expect(readFileInput.parse({ source: 'wiki', pageId: 1, attachmentId: 3, messageId: null })).toMatchObject({ pageId: 1, attachmentId: 3 });
    expect(readFileInput.parse({ source: 'message', channelId: 1, messageId: 2, attachmentId: 3 })).toMatchObject({ channelId: 1, messageId: 2 });
    expect(readFileInput.parse({ source: 'mail', attachmentId: 3 })).toMatchObject({ source: 'mail', attachmentId: 3 });
  });

  it('limit 은 1..32000, offset 은 0 이상', () => {
    const base = { source: 'drive' as const, driveFileId: 4 };
    expect(() => readFileInput.parse({ ...base, limit: 0 })).toThrow();
    expect(() => readFileInput.parse({ ...base, limit: 32001 })).toThrow();
    expect(() => readFileInput.parse({ ...base, offset: -1 })).toThrow();
    expect(readFileInput.parse({ ...base, limit: 32000, offset: 0 })).toMatchObject({ limit: 32000, offset: 0 });
  });
});

describe('read_file — 이슈 첨부', () => {
  it('READY: 구간 읽기 응답을 그대로 JSON 으로. limit 생략 시 기본 12000, offset 생략은 미지정', async () => {
    const c = mockClient();
    const out = await readAttachment(c).handler({ source: 'issue', issueKey: 'WP-1', attachmentId: 55 });
    expect(c.readIssueAttachmentText).toHaveBeenCalledWith('WP-1', 55, { offset: undefined, limit: READ_ATTACHMENT_DEFAULT_LIMIT });
    // 서버 응답의 core fileId 는 입력과 같은 이름 attachmentId 로 돌려준다(WP-353).
    expect(JSON.parse(resultText(out))).toEqual(issueView(READY));
    expect(c.downloadIssueAttachment).not.toHaveBeenCalled();
  });

  it('offset·limit 을 넘기고, null 은 미지정으로 본다', async () => {
    const c = mockClient();
    await readAttachment(c).handler({ source: 'issue', issueKey: 'WP-1', attachmentId: 55, offset: 6, limit: 100 });
    expect(c.readIssueAttachmentText).toHaveBeenLastCalledWith('WP-1', 55, { offset: 6, limit: 100 });
    await readAttachment(c).handler({ source: 'issue', issueKey: 'WP-1', attachmentId: 55, offset: null, limit: null });
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
    const out = await readAttachment(c).handler({ source: 'issue', issueKey: 'WP-1', attachmentId: 55 });
    expect(JSON.parse(resultText(out))).toEqual(issueView(s));
    expect(c.listIssueAttachments).not.toHaveBeenCalled();
    expect(c.downloadIssueAttachment).not.toHaveBeenCalled();
  });

  it('이미지(SKIPPED·IMAGE): 목록으로 형식·크기를 확인한 뒤 원본을 받아 [설명, image] 블록으로', async () => {
    const c = mockClient();
    vi.mocked(c.readIssueAttachmentText).mockResolvedValue(IMAGE_SKIP);
    vi.mocked(c.listIssueAttachments).mockResolvedValue([{ fileId: 55, originalName: '화면.png', mimeType: 'image/png', sizeBytes: 4 }]);
    const out = (await readAttachment(c).handler({ source: 'issue', issueKey: 'WP-1', attachmentId: 55 })) as McpContent[];
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
    const out = await readAttachment(c).handler({ source: 'issue', issueKey: 'WP-1', attachmentId: 55 });
    expect(typeof out).toBe('string');
    expect(out).toContain(`크기(${IMAGE_MAX_BYTES + 1}B)`);
    expect(out).not.toContain('형식(');
    expect(c.downloadIssueAttachment).not.toHaveBeenCalled();
  });

  it('메타가 없어 사전 검사를 못 해도 다운로드 상한 초과(FileTooLargeError)면 크기 초과 안내로 잇는다', async () => {
    const c = mockClient();
    vi.mocked(c.readIssueAttachmentText).mockResolvedValue(IMAGE_SKIP);
    vi.mocked(c.downloadIssueAttachment).mockRejectedValue(new FileTooLargeError());
    const out = await readAttachment(c).handler({ source: 'issue', issueKey: 'WP-1', attachmentId: 55 });
    expect(typeof out).toBe('string');
    expect(out).toContain(`크기(${IMAGE_MAX_BYTES}B 초과)`);
    // 다른 오류는 삼키지 않는다.
    vi.mocked(c.downloadIssueAttachment).mockRejectedValue(new Error('boom'));
    await expect(readAttachment(c).handler({ source: 'issue', issueKey: 'WP-1', attachmentId: 55 })).rejects.toThrow('boom');
  });

  it('보낼 수 없는 이미지 형식(예: HEIC): 원본을 받지 않고 형식만 사유로', async () => {
    const c = mockClient();
    vi.mocked(c.readIssueAttachmentText).mockResolvedValue(IMAGE_SKIP);
    vi.mocked(c.listIssueAttachments).mockResolvedValue([{ fileId: 55, originalName: 'a.heic', mimeType: 'image/heic', sizeBytes: 10 }]);
    const out = await readAttachment(c).handler({ source: 'issue', issueKey: 'WP-1', attachmentId: 55 });
    expect(out).toContain('형식(image/heic)');
    expect(out).not.toContain('크기(');
    expect(c.downloadIssueAttachment).not.toHaveBeenCalled();
  });
});

describe('read_file — 드라이브 파일', () => {
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

/** 노트·메시지·메일 — 추출 슬라이스와 이미지 처리가 같은 모양이라 같은 시나리오를 소스별로 돌린다(WP-358). */
const NEW_SOURCES = [
  {
    name: '노트(wiki)',
    args: { source: 'wiki', pageId: 7, attachmentId: 55 },
    readText: (c: AttachmentToolClient) => c.readWikiAttachmentText,
    download: (c: AttachmentToolClient) => c.downloadWikiAttachment,
    textArgs: [7, 55],
  },
  {
    name: '메시지(message)',
    args: { source: 'message', channelId: 3, messageId: 40, attachmentId: 55 },
    readText: (c: AttachmentToolClient) => c.readMessageAttachmentText,
    download: (c: AttachmentToolClient) => c.downloadMessageAttachment,
    textArgs: [3, 40, 55],
  },
  {
    name: '메일(mail)',
    args: { source: 'mail', attachmentId: 55 },
    readText: (c: AttachmentToolClient) => c.readMailAttachmentText,
    download: (c: AttachmentToolClient) => c.downloadMailAttachment,
    textArgs: [55],
  },
] as const;

describe.each(NEW_SOURCES)('read_file — $name (WP-358)', ({ args, readText, download, textArgs }) => {
  it('READY: 구간을 읽고 서버 fileId 를 attachmentId 로 바꿔 돌려준다. limit 기본 12000', async () => {
    const c = mockClient();
    const out = await readAttachment(c).handler({ ...args, offset: 6 });
    expect(readText(c)).toHaveBeenCalledWith(...textArgs, { offset: 6, limit: READ_ATTACHMENT_DEFAULT_LIMIT });
    expect(JSON.parse(resultText(out))).toEqual(issueView(READY));
    expect(download(c)).not.toHaveBeenCalled();
  });

  it.each([
    ['FAILED', slice('FAILED', { reasonCode: 'SUMMARY_FAILED', reason: '요약에 실패했습니다.' })],
    ['SKIPPED(이미지 아님)', slice('SKIPPED', { reasonCode: 'UNSUPPORTED_TYPE', reason: '이 형식은 텍스트 추출을 지원하지 않습니다.' })],
  ])('%s: 상태·사유만, 원본은 받지 않는다', async (_label, s) => {
    const c = mockClient();
    vi.mocked(readText(c)).mockResolvedValue(s);
    const out = JSON.parse(resultText(await readAttachment(c).handler(args)));
    expect(out).toMatchObject({ attachmentId: 55, status: s.status, text: null, reasonCode: s.reasonCode, reason: s.reason });
    expect(out).not.toHaveProperty('fileId');
    expect(download(c)).not.toHaveBeenCalled();
  });

  it('이미지(SKIPPED·IMAGE): 원본을 받아 [설명, image] 블록으로 — 형식은 Content-Type 파라미터를 뗀 값', async () => {
    const c = mockClient();
    vi.mocked(readText(c)).mockResolvedValue(IMAGE_SKIP);
    vi.mocked(download(c)).mockResolvedValue({ data: PNG, mimeType: 'image/png;charset=UTF-8' });
    const out = (await readAttachment(c).handler(args)) as McpContent[];
    expect(download(c)).toHaveBeenCalledWith(...textArgs);
    expect(out[0]).toMatchObject({ type: 'text' });
    expect(out[0]).toEqual({ type: 'text', text: expect.stringContaining('attachmentId 55') });
    expect(out[1]).toEqual({ type: 'image', data: Buffer.from(PNG).toString('base64'), mimeType: 'image/png' });
  });

  it('이미지 크기 초과(FileTooLargeError)·형식 불가(HEIC)는 안내 문구만, 다른 오류는 삼키지 않는다', async () => {
    const c = mockClient();
    vi.mocked(readText(c)).mockResolvedValue(IMAGE_SKIP);
    vi.mocked(download(c)).mockRejectedValue(new FileTooLargeError());
    expect(await readAttachment(c).handler(args)).toContain(`크기(${IMAGE_MAX_BYTES}B 초과)`);
    vi.mocked(download(c)).mockResolvedValue({ data: PNG, mimeType: 'image/heic' });
    expect(await readAttachment(c).handler(args)).toContain('형식(image/heic)');
    vi.mocked(download(c)).mockRejectedValue(new Error('boom'));
    await expect(readAttachment(c).handler(args)).rejects.toThrow('boom');
  });
});

describe('read_file — 노트 NONE (WP-358)', () => {
  // 노트는 이미지만 올라가고 백필하지 않으므로 배포 전 첨부는 NONE 이다 — 그래도 이미지로 읽혀야 한다.
  it('NONE(배포 전 노트 첨부)도 원본을 받아 이미지 블록으로 준다', async () => {
    const c = mockClient();
    vi.mocked(c.readWikiAttachmentText).mockResolvedValue(slice('NONE'));
    const out = (await readAttachment(c).handler({ source: 'wiki', pageId: 7, attachmentId: 55 })) as McpContent[];
    expect(c.downloadWikiAttachment).toHaveBeenCalledWith(7, 55);
    expect(out[1]).toEqual({ type: 'image', data: Buffer.from(PNG).toString('base64'), mimeType: 'image/png' });
  });

  it('NONE 인데 이미지가 아니면 형식 사유 안내만 준다', async () => {
    const c = mockClient();
    vi.mocked(c.readWikiAttachmentText).mockResolvedValue(slice('NONE'));
    vi.mocked(c.downloadWikiAttachment).mockResolvedValue({ data: PNG, mimeType: 'application/pdf' });
    expect(await readAttachment(c).handler({ source: 'wiki', pageId: 7, attachmentId: 55 })).toContain('형식(application/pdf)');
  });

  it('메시지·메일의 NONE 은 이미지로 가정하지 않는다(상태만)', async () => {
    const c = mockClient();
    vi.mocked(c.readMessageAttachmentText).mockResolvedValue(slice('NONE'));
    vi.mocked(c.readMailAttachmentText).mockResolvedValue(slice('NONE'));
    await readAttachment(c).handler({ source: 'message', channelId: 3, messageId: 40, attachmentId: 55 });
    await readAttachment(c).handler({ source: 'mail', attachmentId: 55 });
    expect(c.downloadMessageAttachment).not.toHaveBeenCalled();
    expect(c.downloadMailAttachment).not.toHaveBeenCalled();
  });
});

describe('read_file — 메일 PENDING (WP-358)', () => {
  it('첫 호출은 PENDING 이라 잠시 뒤 다시 호출하라는 안내를 붙인다', async () => {
    const c = mockClient();
    vi.mocked(c.readMailAttachmentText).mockResolvedValue(slice('PENDING'));
    const out = JSON.parse(resultText(await readAttachment(c).handler({ source: 'mail', attachmentId: 55 })));
    expect(out).toMatchObject({ attachmentId: 55, status: 'PENDING', text: null });
    expect(out.note).toContain('다시 호출');
    expect(c.downloadMailAttachment).not.toHaveBeenCalled();
  });

  it('노트·메시지의 PENDING 은 상태만(안내 없음)', async () => {
    const c = mockClient();
    vi.mocked(c.readWikiAttachmentText).mockResolvedValue(slice('PENDING'));
    const out = JSON.parse(resultText(await readAttachment(c).handler({ source: 'wiki', pageId: 7, attachmentId: 55 })));
    expect(out).toEqual(issueView(slice('PENDING')));
  });
});
