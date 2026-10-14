import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { FileTooLargeError, IMAGE_MAX_BYTES, READ_ATTACHMENT_DEFAULT_LIMIT } from './attachment-read.js';
import { buildAttachmentTools, readFileInput } from './attachment-tools.js';
import { PAGES_NOTE_HINT } from './attachment-view.js';
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
/** 서버 /view 응답(WP-250) — 원본(메일 첨부만 받는다)과 구분되게 JPEG 로 둔다. */
const JPEG = new Uint8Array([0xff, 0xd8, 0xff]);
const VIEW = { data: JPEG, mimeType: 'image/jpeg' };
const JPEG_BLOCK = { type: 'image', data: Buffer.from(JPEG).toString('base64'), mimeType: 'image/jpeg' };
const PNG_BLOCK = { type: 'image', data: Buffer.from(PNG).toString('base64'), mimeType: 'image/png' };

function mockClient(): AttachmentToolClient {
  return {
    readIssueAttachmentText: vi.fn().mockResolvedValue(READY),
    readDriveFileText: vi.fn().mockResolvedValue(READY),
    readWikiAttachmentText: vi.fn().mockResolvedValue(READY),
    readMessageAttachmentText: vi.fn().mockResolvedValue(READY),
    readMailAttachmentText: vi.fn().mockResolvedValue(READY),
    downloadMailAttachment: vi.fn().mockResolvedValue({ data: PNG, mimeType: 'image/png' }),
    readIssueChatAttachmentText: vi.fn().mockResolvedValue(READY),
    viewIssueAttachment: vi.fn().mockResolvedValue(VIEW),
    viewDriveFile: vi.fn().mockResolvedValue(VIEW),
    viewWikiAttachment: vi.fn().mockResolvedValue(VIEW),
    viewMessageAttachment: vi.fn().mockResolvedValue(VIEW),
    viewIssueChatAttachment: vi.fn().mockResolvedValue(VIEW),
  };
}

const readAttachment = (c: AttachmentToolClient, imageInput?: boolean) =>
  buildAttachmentTools(c, imageInput).find((t) => t.name === 'read_file')!;

describe('read_file 입력 스키마', () => {
  // 서버 레이어가 inputSchema.shape 를 registerTool 에 넘기므로 superRefine 뒤에도 z.object 여야 한다.
  it('최상위는 z.object 이고 shape 에 source·식별자·범위·pages 가 있다', () => {
    expect(readFileInput).toBeInstanceOf(z.ZodObject);
    expect(Object.keys(readFileInput.shape).sort()).toEqual(['attachmentId', 'channelId', 'driveFileId', 'issueKey', 'limit', 'messageId', 'offset', 'pageId', 'pages', 'source']);
  });

  // WP-250: 이미지를 볼 수 없는 모델에는 pages 를 아예 보여 주지 않는다(입력·설명 모두) — 못 쓰는 인자를 부르지 않게.
  it('imageInput:false 면 pages 입력과 설명 문장이 없다. 기본(true)은 있다', () => {
    const off = readAttachment(mockClient(), false);
    expect((off.inputSchema as z.ZodObject).shape).not.toHaveProperty('pages');
    expect(off.description).not.toContain('pages');
    const on = readAttachment(mockClient());
    expect((on.inputSchema as z.ZodObject).shape).toHaveProperty('pages');
    expect(on.description).toContain('pages:[n]');
  });

  // WP-250 최종 리뷰: 변환본(/view)·pages 는 메일 첨부에 없다(WP-388) — 설명이 메일 제외를 밝힌다.
  it('설명은 큰 이미지·HEIC 변환과 pages 가 메일 첨부에는 없다고 밝힌다', () => {
    expect(readAttachment(mockClient()).description).toContain('large/HEIC converted; not mail');
    expect(readAttachment(mockClient()).description).toContain('PDF (not mail): pages:[n]');
    expect(readAttachment(mockClient(), false).description).toContain('not mail');
  });

  it('JSON 스키마로 직렬화된다(MCP 클라이언트가 받는 형식) — 최상위 type object, source 만 필수', () => {
    const js = z.toJSONSchema(readFileInput) as { type: string; required: string[]; properties: Record<string, unknown> };
    expect(js.type).toBe('object');
    expect(js.required).toEqual(['source']);
    expect(js.properties.source).toMatchObject({ enum: ['issue', 'issue_chat', 'drive', 'wiki', 'message', 'mail'] });
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
    expect(c.viewIssueAttachment).not.toHaveBeenCalled();
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
  ])('%s: text 없이 상태·사유를 그대로 돌려주고 이미지는 받지 않는다', async (_label, s) => {
    const c = mockClient();
    vi.mocked(c.readIssueAttachmentText).mockResolvedValue(s);
    const out = await readAttachment(c).handler({ source: 'issue', issueKey: 'WP-1', attachmentId: 55 });
    expect(JSON.parse(resultText(out))).toEqual(issueView(s));
    expect(c.viewIssueAttachment).not.toHaveBeenCalled();
  });

  // WP-250: 보낼 수 있는 원본(작은 PNG·JPEG)이어도 서버가 줄인 변환본(/view)을 준다 — 원본 해상도 그대로면 한 요청에 이미지가 20장을 넘을 때
  // Anthropic API 가 긴 변 2000px 초과 이미지를 거절한다. 
  it('이미지(SKIPPED·IMAGE): 보낼 수 있는 원본이어도 변환본(/view)을 [설명, image] 블록으로 — 라벨은 식별자', async () => {
    const c = mockClient();
    vi.mocked(c.readIssueAttachmentText).mockResolvedValue(IMAGE_SKIP);
    const out = (await readAttachment(c).handler({ source: 'issue', issueKey: 'WP-1', attachmentId: 55 })) as McpContent[];
    expect(c.viewIssueAttachment).toHaveBeenCalledWith('WP-1', 55, undefined);
    expect(out).toEqual([{ type: 'text', text: '이슈 WP-1 첨부 이미지(attachmentId 55) (image/jpeg, 3B)' }, JPEG_BLOCK]);
  });

  it('변환이 실패하면(서버 사유) 던지지 않고 그 사유를 text 로', async () => {
    const c = mockClient();
    vi.mocked(c.readIssueAttachmentText).mockResolvedValue(IMAGE_SKIP);
    vi.mocked(c.viewIssueAttachment).mockRejectedValue(new Error('페이지 이미지를 만들지 못했습니다. 잠시 후 다시 시도하세요.'));
    expect(await readAttachment(c).handler({ source: 'issue', issueKey: 'WP-1', attachmentId: 55 })).toContain('잠시 후 다시 시도하세요');
  });
});

describe('read_file — 드라이브 파일', () => {
  it('READY: core fileId 를 지우고 driveFileId 로 돌려준다(#840)', async () => {
    const c = mockClient();
    const out = await readAttachment(c).handler({ source: 'drive', driveFileId: 9, offset: 6, limit: 500 });
    expect(c.readDriveFileText).toHaveBeenCalledWith(9, { offset: 6, limit: 500 });
    const { fileId: _coreFileId, ...rest } = READY;
    // READY 고정값은 nextOffset 이 있어(뒤가 남음) 끝까지 읽으라는 안내가 붙는다.
    expect(JSON.parse(resultText(out))).toEqual({ driveFileId: 9, ...rest, note: expect.stringContaining('Partial text') });
    expect(JSON.parse(resultText(out))).not.toHaveProperty('fileId');
  });

  // WP-369 최종 리뷰 I4: 외부 클라이언트가 일부만 읽고 create_drive_file(driveFileId, content) 로 덮어 뒷부분을 잃지 않게 응답 note 로 알린다.
  it('READY 이고 뒤가 남았으면(nextOffset) 이어 읽을 offset 과 끝까지 읽은 뒤에만 고쳐 쓰라는 note', async () => {
    const c = mockClient();
    vi.mocked(c.readDriveFileText).mockResolvedValue(slice('READY', { totalChars: 30000, truncated: false, nextOffset: 12000, text: 'a' }));
    const out = JSON.parse(resultText(await readAttachment(c).handler({ source: 'drive', driveFileId: 9 })));
    expect(out.note).toBe(
      'Partial text: continue with offset=12000; read to the end before rewriting with create_drive_file(driveFileId).',
    );
  });

  it('추출이 잘렸으면(truncated) 내용으로 고쳐 쓰지 말고 업로드 링크를 쓰라는 note 가 이어 읽기 안내보다 먼저다', async () => {
    const c = mockClient();
    for (const nextOffset of [12000, null]) {
      vi.mocked(c.readDriveFileText).mockResolvedValue(slice('READY', { totalChars: 1000000, truncated: true, nextOffset, text: 'a' }));
      const out = JSON.parse(resultText(await readAttachment(c).handler({ source: 'drive', driveFileId: 9 })));
      expect(out.note).toBe('Extraction is capped: do not rewrite via content; use the upload link (create_drive_file without content).');
    }
  });

  it('끝까지 읽었고 잘리지 않았으면 note 가 없다 — 다른 소스(이슈)에도 붙지 않는다', async () => {
    const c = mockClient();
    const last = slice('READY', { offset: 6, totalChars: 11, truncated: false, nextOffset: null, text: '바사' });
    vi.mocked(c.readDriveFileText).mockResolvedValue(last);
    expect(JSON.parse(resultText(await readAttachment(c).handler({ source: 'drive', driveFileId: 9 })))).not.toHaveProperty('note');
    expect(JSON.parse(resultText(await readAttachment(c).handler({ source: 'issue', issueKey: 'WP-1', attachmentId: 55 })))).not.toHaveProperty('note');
  });

  it.each([
    ['PENDING', slice('PENDING')],
    ['NONE', slice('NONE')],
    ['FAILED', slice('FAILED', { reasonCode: 'SUMMARY_FAILED', reason: '요약에 실패했습니다.' })],
    ['SKIPPED(이미지 아님)', slice('SKIPPED', { reasonCode: 'TOO_LARGE', reason: '파일이 커서(25MB 초과) 텍스트를 추출하지 않았습니다.' })],
  ])('%s: 상태·사유만, 이미지는 받지 않는다', async (_label, s) => {
    const c = mockClient();
    vi.mocked(c.readDriveFileText).mockResolvedValue(s);
    const out = JSON.parse(resultText(await readAttachment(c).handler({ source: 'drive', driveFileId: 9 })));
    expect(out).toMatchObject({ driveFileId: 9, status: s.status, text: null, reasonCode: s.reasonCode, reason: s.reason });
    expect(c.viewDriveFile).not.toHaveBeenCalled();
  });

  it('이미지: 변환본(/view)을 Content-Type 파라미터를 떼어 image 블록으로', async () => {
    const c = mockClient();
    vi.mocked(c.readDriveFileText).mockResolvedValue(IMAGE_SKIP);
    vi.mocked(c.viewDriveFile).mockResolvedValue({ data: JPEG, mimeType: 'image/jpeg;charset=UTF-8' });
    const out = (await readAttachment(c).handler({ source: 'drive', driveFileId: 9 })) as McpContent[];
    expect(c.viewDriveFile).toHaveBeenCalledWith(9, undefined);
    expect(out).toEqual([{ type: 'text', text: '드라이브 이미지(driveFileId 9) (image/jpeg, 3B)' }, JPEG_BLOCK]);
  });
});

/**
 * 노트·메시지·메일 — 추출 슬라이스와 이미지 처리가 같은 모양이라 같은 시나리오를 소스별로 돌린다(WP-358).
 * image 는 이미지를 받는 호출이다 — 노트·메시지는 변환본(/view), 메일은 /view 가 없어(WP-388) 원본(/content).
 */
const NEW_SOURCES = [
  {
    name: '노트(wiki)',
    args: { source: 'wiki', pageId: 7, attachmentId: 55 },
    readText: (c: AttachmentToolClient) => c.readWikiAttachmentText,
    image: (c: AttachmentToolClient) => c.viewWikiAttachment,
    textArgs: [7, 55],
    imageArgs: [7, 55, undefined],
    block: JPEG_BLOCK,
  },
  {
    name: '메시지(message)',
    args: { source: 'message', channelId: 3, messageId: 40, attachmentId: 55 },
    readText: (c: AttachmentToolClient) => c.readMessageAttachmentText,
    image: (c: AttachmentToolClient) => c.viewMessageAttachment,
    textArgs: [3, 40, 55],
    imageArgs: [3, 40, 55, undefined],
    block: JPEG_BLOCK,
  },
  {
    name: '메일(mail)',
    args: { source: 'mail', attachmentId: 55 },
    readText: (c: AttachmentToolClient) => c.readMailAttachmentText,
    image: (c: AttachmentToolClient) => c.downloadMailAttachment,
    textArgs: [55],
    imageArgs: [55],
    block: PNG_BLOCK,
  },
] as const;

describe.each(NEW_SOURCES)('read_file — $name (WP-358)', ({ args, readText, image, textArgs, imageArgs, block }) => {
  it('READY: 구간을 읽고 서버 fileId 를 attachmentId 로 바꿔 돌려준다. limit 기본 12000', async () => {
    const c = mockClient();
    const out = await readAttachment(c).handler({ ...args, offset: 6 });
    expect(readText(c)).toHaveBeenCalledWith(...textArgs, { offset: 6, limit: READ_ATTACHMENT_DEFAULT_LIMIT });
    expect(JSON.parse(resultText(out))).toEqual(issueView(READY));
    expect(image(c)).not.toHaveBeenCalled();
  });

  it.each([
    ['FAILED', slice('FAILED', { reasonCode: 'SUMMARY_FAILED', reason: '요약에 실패했습니다.' })],
    ['SKIPPED(이미지 아님)', slice('SKIPPED', { reasonCode: 'UNSUPPORTED_TYPE', reason: '이 형식은 텍스트 추출을 지원하지 않습니다.' })],
  ])('%s: 상태·사유만, 이미지는 받지 않는다', async (_label, s) => {
    const c = mockClient();
    vi.mocked(readText(c)).mockResolvedValue(s);
    const out = JSON.parse(resultText(await readAttachment(c).handler(args)));
    expect(out).toMatchObject({ attachmentId: 55, status: s.status, text: null, reasonCode: s.reasonCode, reason: s.reason });
    expect(out).not.toHaveProperty('fileId');
    expect(image(c)).not.toHaveBeenCalled();
  });

  it('이미지(SKIPPED·IMAGE): [설명, image] 블록으로 — 노트·메시지는 변환본, 메일은 원본', async () => {
    const c = mockClient();
    vi.mocked(readText(c)).mockResolvedValue(IMAGE_SKIP);
    const out = (await readAttachment(c).handler(args)) as McpContent[];
    expect(image(c)).toHaveBeenCalledWith(...imageArgs);
    expect(out[0]).toEqual({ type: 'text', text: expect.stringContaining('attachmentId 55') });
    expect(out[1]).toEqual(block);
  });
});

describe('read_file — 노트·메시지 변환 실패 (WP-250)', () => {
  it('서버가 변환하지 못하면(사유) 던지지 않고 그 사유를 text 로', async () => {
    const c = mockClient();
    vi.mocked(c.readMessageAttachmentText).mockResolvedValue(IMAGE_SKIP);
    vi.mocked(c.viewMessageAttachment).mockRejectedValue(new Error('페이지 이미지를 만들지 못했습니다. 잠시 후 다시 시도하세요.'));
    const out = await readAttachment(c).handler({ source: 'message', channelId: 3, messageId: 40, attachmentId: 55 });
    expect(out).toContain('잠시 후 다시 시도하세요');
  });
});

describe('read_file — 메일 원본 이미지 (WP-388: 변환본 없음)', () => {
  it('원본 Content-Type 파라미터를 떼어 image 블록으로', async () => {
    const c = mockClient();
    vi.mocked(c.readMailAttachmentText).mockResolvedValue(IMAGE_SKIP);
    vi.mocked(c.downloadMailAttachment).mockResolvedValue({ data: PNG, mimeType: 'image/png;charset=UTF-8' });
    const out = (await readAttachment(c).handler({ source: 'mail', attachmentId: 55 })) as McpContent[];
    expect(out).toEqual([{ type: 'text', text: '메일 첨부 이미지(attachmentId 55) (image/png, 4B)' }, PNG_BLOCK]);
  });

  it('크기 초과(FileTooLargeError)·형식 불가(HEIC)는 사유 안내, 다른 오류는 삼키지 않는다', async () => {
    const c = mockClient();
    const args = { source: 'mail', attachmentId: 55 };
    vi.mocked(c.readMailAttachmentText).mockResolvedValue(IMAGE_SKIP);
    vi.mocked(c.downloadMailAttachment).mockRejectedValue(new FileTooLargeError());
    expect(await readAttachment(c).handler(args)).toContain(`크기(${IMAGE_MAX_BYTES}B 초과)`);
    vi.mocked(c.downloadMailAttachment).mockResolvedValue({ data: PNG, mimeType: 'image/heic' });
    expect(await readAttachment(c).handler(args)).toContain('형식(image/heic)');
    vi.mocked(c.downloadMailAttachment).mockRejectedValue(new Error('boom'));
    await expect(readAttachment(c).handler(args)).rejects.toThrow('boom');
  });
});

describe('read_file — 노트 NONE (WP-358)', () => {
  // 노트는 이미지만 올라가고 백필하지 않으므로 배포 전 첨부는 NONE 이다 — 그래도 이미지로 읽혀야 한다.
  it('NONE(배포 전 노트 첨부)도 변환본을 받아 이미지 블록으로 준다', async () => {
    const c = mockClient();
    vi.mocked(c.readWikiAttachmentText).mockResolvedValue(slice('NONE'));
    const out = (await readAttachment(c).handler({ source: 'wiki', pageId: 7, attachmentId: 55 })) as McpContent[];
    expect(c.viewWikiAttachment).toHaveBeenCalledWith(7, 55, undefined);
    expect(out[1]).toEqual(JPEG_BLOCK);
  });

  it('NONE 인데 이미지가 아니면 서버가 변환을 거절하고(415) 그 사유를 text 로', async () => {
    const c = mockClient();
    vi.mocked(c.readWikiAttachmentText).mockResolvedValue(slice('NONE'));
    vi.mocked(c.viewWikiAttachment).mockRejectedValue(new Error('PDF·이미지만 페이지 이미지로 볼 수 있습니다.'));
    const out = await readAttachment(c).handler({ source: 'wiki', pageId: 7, attachmentId: 55 });
    expect(c.viewWikiAttachment).toHaveBeenCalledWith(7, 55, undefined);
    expect(out).toContain('PDF·이미지만 페이지 이미지로 볼 수 있습니다.');
  });

  it('메시지·메일의 NONE 은 이미지로 가정하지 않는다(상태만)', async () => {
    const c = mockClient();
    vi.mocked(c.readMessageAttachmentText).mockResolvedValue(slice('NONE'));
    vi.mocked(c.readMailAttachmentText).mockResolvedValue(slice('NONE'));
    await readAttachment(c).handler({ source: 'message', channelId: 3, messageId: 40, attachmentId: 55 });
    await readAttachment(c).handler({ source: 'mail', attachmentId: 55 });
    expect(c.viewMessageAttachment).not.toHaveBeenCalled();
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

// WP-250: PDF 페이지 이미지(pages)·스캔 PDF 안내.
describe('read_file — 페이지 이미지(pages, WP-250)', () => {
  const PDF_READY = slice('READY', { totalChars: 5, truncated: false, nextOffset: null, text: '본문', pageCount: 6 });
  const SCANNED = slice('SKIPPED', { reasonCode: 'SCANNED_PDF', reason: '스캔된 PDF로 보여 읽을 수 있는 글자가 없습니다.', pageCount: 4 });

  it('issue + pages: 텍스트 대신 /view?page 로 쪽 이미지를 준다', async () => {
    const c = mockClient();
    const out = (await readAttachment(c).handler({ source: 'issue', issueKey: 'WP-1', attachmentId: 55, pages: [2] })) as McpContent[];
    expect(c.viewIssueAttachment).toHaveBeenCalledWith('WP-1', 55, 2);
    expect(c.readIssueAttachmentText).not.toHaveBeenCalled();
    expect(out).toEqual([{ type: 'text', text: expect.stringContaining('2쪽') }, JPEG_BLOCK, { type: 'text', text: PAGES_NOTE_HINT }]);
  });

  it('drive + pages:[1,2,3]: 쪽마다 한 번씩', async () => {
    const c = mockClient();
    const out = (await readAttachment(c).handler({ source: 'drive', driveFileId: 9, pages: [1, 2, 3] })) as McpContent[];
    expect(vi.mocked(c.viewDriveFile).mock.calls).toEqual([[9, 1], [9, 2], [9, 3]]);
    expect(out.filter((b) => b.type === 'image')).toHaveLength(3);
    expect(c.readDriveFileText).not.toHaveBeenCalled();
  });

  it('wiki·message + pages: 소스별 /view', async () => {
    const c = mockClient();
    await readAttachment(c).handler({ source: 'wiki', pageId: 7, attachmentId: 55, pages: [1] });
    expect(c.viewWikiAttachment).toHaveBeenCalledWith(7, 55, 1);
    await readAttachment(c).handler({ source: 'message', channelId: 3, messageId: 40, attachmentId: 55, pages: [5] });
    expect(c.viewMessageAttachment).toHaveBeenCalledWith(3, 40, 55, 5);
  });

  it('mail + pages: 던지지 않고 아직 지원하지 않는다는 문구', async () => {
    const c = mockClient();
    const out = await readAttachment(c).handler({ source: 'mail', attachmentId: 55, pages: [1] });
    expect(out).toContain('메일 첨부는 아직 페이지 보기를 지원하지 않습니다');
    expect(c.readMailAttachmentText).not.toHaveBeenCalled();
  });

  it('pages 는 1~3개, 1부터 — 4쪽 이상·0쪽은 스키마가 거절', async () => {
    const tool = readAttachment(mockClient());
    await expect(tool.handler({ source: 'drive', driveFileId: 9, pages: [1, 2, 3, 4] })).rejects.toThrow();
    await expect(tool.handler({ source: 'drive', driveFileId: 9, pages: [0] })).rejects.toThrow();
  });

  it('범위 밖 쪽(서버 400)은 던지지 않고 사유를 text 로', async () => {
    const c = mockClient();
    vi.mocked(c.viewDriveFile).mockRejectedValue(new Error('API 오류 400: 이 PDF 는 6쪽입니다. 1~6 사이 페이지를 지정하세요.'));
    const out = await readAttachment(c).handler({ source: 'drive', driveFileId: 9, pages: [9] });
    expect(out).toContain('이 PDF 는 6쪽입니다');
  });

  it('READY PDF: pageCount 를 싣고 그림·스캔 쪽은 pages 로 보라는 note — imageInput:false 면 note 없음', async () => {
    const c = mockClient();
    vi.mocked(c.readIssueAttachmentText).mockResolvedValue(PDF_READY);
    const on = JSON.parse(resultText(await readAttachment(c).handler({ source: 'issue', issueKey: 'WP-1', attachmentId: 55 })));
    expect(on).toMatchObject({ pageCount: 6, note: '그림·도표·스캔 페이지는 pages 로 이미지를 볼 수 있습니다.' });
    const off = JSON.parse(resultText(await readAttachment(c, false).handler({ source: 'issue', issueKey: 'WP-1', attachmentId: 55 })));
    expect(off.pageCount).toBe(6);
    expect(off).not.toHaveProperty('note');
  });

  it('드라이브 READY PDF 는 고쳐 쓰기 안내와 pages 안내를 함께 싣는다(한쪽이 다른 쪽을 덮지 않게)', async () => {
    const c = mockClient();
    vi.mocked(c.readDriveFileText).mockResolvedValue({ ...PDF_READY, nextOffset: 2 });
    const out = JSON.parse(resultText(await readAttachment(c).handler({ source: 'drive', driveFileId: 9 })));
    expect(out.note).toContain('Partial text');
    expect(out.note).toContain('pages 로 이미지를 볼 수 있습니다');
  });

  it('스캔 PDF(SKIPPED·SCANNED_PDF): pages 로 읽으라는 note. imageInput:false 면 이미지 입력 지정·모델 변경 안내', async () => {
    const c = mockClient();
    vi.mocked(c.readDriveFileText).mockResolvedValue(SCANNED);
    const on = JSON.parse(resultText(await readAttachment(c).handler({ source: 'drive', driveFileId: 9 })));
    expect(on.note).toBe('글자가 없는 스캔 PDF(4쪽)입니다. pages 로 페이지 이미지를 읽으세요.');
    const off = JSON.parse(resultText(await readAttachment(c, false).handler({ source: 'drive', driveFileId: 9 })));
    // 못 본다고 단정하지 않고(자동 감지 실패일 수 있다) 연결 설정의 '이미지 입력' 지정을 함께 안내한다. pages 는 이 모델에 없는 인자라 말하지 않는다.
    expect(off.note).toBe(
      "글자가 없는 스캔 PDF(4쪽)라 글자로는 읽을 수 없고, 지금 설정으로는 페이지 이미지를 볼 수 없습니다. " +
        "모델이 이미지를 볼 수 있다면 AI 연결 설정에서 '이미지 입력'을 '볼 수 있음'으로 지정하거나, 이미지를 볼 수 있는 모델로 바꾸면 페이지를 볼 수 있다고 사용자에게 안내하세요.",
    );
    expect(off.note).not.toContain('pages');
  });

  it('스캔 PDF 의 쪽수를 아직 모르면(null) 쪽수 없이 안내한다', async () => {
    const c = mockClient();
    vi.mocked(c.readIssueAttachmentText).mockResolvedValue({ ...SCANNED, pageCount: null });
    const out = JSON.parse(resultText(await readAttachment(c).handler({ source: 'issue', issueKey: 'WP-1', attachmentId: 55 })));
    expect(out.note).toBe('글자가 없는 스캔 PDF 입니다. pages 로 페이지 이미지를 읽으세요.');
  });

  it('메일 첨부에는 pages 안내를 붙이지 않는다(메일은 페이지 보기를 지원하지 않는다)', async () => {
    const c = mockClient();
    vi.mocked(c.readMailAttachmentText).mockResolvedValue(SCANNED);
    expect(JSON.parse(resultText(await readAttachment(c).handler({ source: 'mail', attachmentId: 55 })))).not.toHaveProperty('note');
  });

  it('issue_chat + pages: 스레드 /view?page 로 쪽 이미지를 준다', async () => {
    const c = mockClient();
    const out = (await readAttachment(c).handler({ source: 'issue_chat', issueKey: 'WP-1', messageId: 11, attachmentId: 55, pages: [3] })) as McpContent[];
    expect(c.viewIssueChatAttachment).toHaveBeenCalledWith('WP-1', 55, 3);
    expect(c.readIssueChatAttachmentText).not.toHaveBeenCalled();
    expect(out.filter((b) => b.type === 'image')).toHaveLength(1);
  });
});

describe('read_file — 이슈 챗 첨부 (WP-373)', () => {
  const args = { source: 'issue_chat', issueKey: 'WP-1', messageId: 11, attachmentId: 55 };

  it('issueKey·messageId·attachmentId 로 텍스트를 읽고 fileId 를 attachmentId 로 돌려준다', async () => {
    const c = mockClient();
    const out = JSON.parse(resultText(await readAttachment(c).handler(args)));
    expect(c.readIssueChatAttachmentText).toHaveBeenCalledWith('WP-1', 11, 55, expect.anything());
    expect(out).toEqual(issueView(READY));
  });

  it('이미지(SKIPPED·IMAGE)는 서버 변환본(/view)을 이미지 블록으로 돌려준다', async () => {
    const c = mockClient();
    vi.mocked(c.readIssueChatAttachmentText).mockResolvedValue(IMAGE_SKIP);
    const out = await readAttachment(c).handler(args);
    expect(c.viewIssueChatAttachment).toHaveBeenCalledWith('WP-1', 55, undefined);
    expect(Array.isArray(out) && out.some((b) => b.type === 'image')).toBe(true);
  });

  it('channelId 를 주거나 messageId 가 없으면 거부한다', () => {
    expect(() => readFileInput.parse({ ...args, channelId: 3 })).toThrow(/channelId 를 주지/);
    expect(() => readFileInput.parse({ source: 'issue_chat', issueKey: 'WP-1', attachmentId: 55 })).toThrow(/messageId/);
  });
});
