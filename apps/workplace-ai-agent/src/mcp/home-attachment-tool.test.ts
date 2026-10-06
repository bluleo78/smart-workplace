// WP-234: 메인 AI 채팅 첨부 읽기 도구 — 세션 바인딩·문서 상태별·이미지 형식/크기 분기.
import { describe, expect, it, vi } from 'vitest';

import type { ExtractionInfo, HomeAttachmentMeta, WorkplaceApiClient } from '../clients/workplace-api.js';
import {
  buildReadChatAttachmentTool,
  HOME_IMAGE_MAX_BYTES,
  NO_HOME_SESSION_ERROR,
} from './home-attachment-tool.js';
import { READ_ATTACHMENT_DEFAULT_LIMIT } from './attachment-read-schema.js';

const SID = '3f1c2a4e-8b7d-4c1e-9f2a-6d5b4c3a2e1f';
const USER = 42;

const ex = (status: ExtractionInfo['status'], over: Partial<ExtractionInfo> = {}): ExtractionInfo => ({
  status, totalChars: status === 'READY' ? 5000 : null, truncated: false, reasonCode: null, reason: null, ...over,
});
const att = (fileId: number, mimeType: string, extraction: ExtractionInfo, sizeBytes = 1000, originalName = `f${fileId}`): HomeAttachmentMeta => ({
  fileId, messageId: 1, originalName, mimeType, sizeBytes, extraction,
});

function mockClient(list: HomeAttachmentMeta[]) {
  return {
    listHomeSessionAttachments: vi.fn().mockResolvedValue(list),
    readHomeAttachmentText: vi.fn().mockResolvedValue({
      fileId: 8, status: 'READY', offset: 0, totalChars: 5000, truncated: false, nextOffset: 12000, text: '본문', reasonCode: null, reason: null,
    }),
    downloadHomeAttachment: vi.fn().mockResolvedValue({ data: Buffer.from('PNGDATA'), mimeType: 'image/png; charset=binary' }),
  };
}
// sid 에 null 을 주면 바인딩 없음(undefined 는 기본값이 적용되므로 쓰지 않는다).
const tool = (c: ReturnType<typeof mockClient>, sid: string | null = SID) =>
  buildReadChatAttachmentTool(c as unknown as WorkplaceApiClient, USER, sid ?? undefined);

describe('read_chat_attachment', () => {
  it('세션 바인딩이 없으면 한국어 오류, API 호출 없음', async () => {
    const c = mockClient([]);
    await expect(tool(c, null).handler({ fileId: 8 })).rejects.toThrow(NO_HOME_SESSION_ERROR);
    expect(c.listHomeSessionAttachments).not.toHaveBeenCalled();
  });

  it('세션 목록에 없는 fileId 는 오류 — 텍스트·원본 호출 없음', async () => {
    const c = mockClient([att(8, 'application/pdf', ex('READY'))]);
    await expect(tool(c).handler({ fileId: 99 })).rejects.toThrow(/이 대화의 첨부가 아닙니다/);
    expect(c.listHomeSessionAttachments).toHaveBeenCalledWith(USER, SID);
    expect(c.readHomeAttachmentText).not.toHaveBeenCalled();
    expect(c.downloadHomeAttachment).not.toHaveBeenCalled();
  });

  it('문서 READY → 텍스트 구간 JSON(offset 생략 undefined, limit 기본 12000)', async () => {
    const c = mockClient([att(8, 'application/pdf', ex('READY'))]);
    const out = await tool(c).handler({ fileId: 8 });
    expect(c.readHomeAttachmentText).toHaveBeenCalledWith(USER, SID, 8, undefined, READ_ATTACHMENT_DEFAULT_LIMIT);
    expect(JSON.parse(out as string)).toMatchObject({ text: '본문', nextOffset: 12000 });
  });

  it('문서 READY → offset·limit 전달, null 은 미지정 취급', async () => {
    const c = mockClient([att(8, 'application/pdf', ex('READY'))]);
    await tool(c).handler({ fileId: 8, offset: 12000, limit: 32000 });
    expect(c.readHomeAttachmentText).toHaveBeenLastCalledWith(USER, SID, 8, 12000, 32000);
    await tool(c).handler({ fileId: 8, offset: null, limit: null });
    expect(c.readHomeAttachmentText).toHaveBeenLastCalledWith(USER, SID, 8, undefined, READ_ATTACHMENT_DEFAULT_LIMIT);
  });

  it('limit 은 1..32000 — 범위 밖은 스키마 오류', async () => {
    const t = tool(mockClient([att(8, 'application/pdf', ex('READY'))]));
    await expect(t.handler({ fileId: 8, limit: 32001 })).rejects.toThrow();
    await expect(t.handler({ fileId: 8, limit: 0 })).rejects.toThrow();
  });

  it('문서 PENDING → "추출 중" 안내, 텍스트 호출 없음', async () => {
    const c = mockClient([att(8, 'application/pdf', ex('PENDING'))]);
    const out = (await tool(c).handler({ fileId: 8 })) as string;
    expect(out).toContain('추출 중');
    expect(out).toContain('다시 올려 달라고 하지 마세요');
    expect(c.readHomeAttachmentText).not.toHaveBeenCalled();
  });

  it.each(['SKIPPED', 'FAILED'] as const)('문서 %s → 서버 사유 문구 그대로 안내', async (s) => {
    const c = mockClient([att(8, 'application/pdf', ex(s, { reason: '텍스트가 없는 PDF(스캔본)' }))]);
    const out = (await tool(c).handler({ fileId: 8 })) as string;
    expect(out).toContain('텍스트가 없는 PDF(스캔본)');
    expect(out).toContain('다시 올리거나 다른 형식으로 올려 달라고 하지 마세요');
    expect(c.readHomeAttachmentText).not.toHaveBeenCalled();
  });

  it('문서 NONE → 추출 대상 아님 안내', async () => {
    const c = mockClient([att(8, 'application/zip', ex('NONE'))]);
    expect(await tool(c).handler({ fileId: 8 })).toContain('텍스트 추출 대상이 아닌 형식');
  });

  it('이미지 READY(png) → 원본을 받아 [설명 text, image 블록] — mimeType 은 목록 값', async () => {
    const c = mockClient([att(9, 'image/png', ex('NONE'), 7, '화면.png')]);
    const out = await tool(c).handler({ fileId: 9 });
    expect(c.downloadHomeAttachment).toHaveBeenCalledWith(USER, SID, 9);
    expect(out).toEqual([
      { type: 'text', text: expect.stringContaining('화면.png') },
      { type: 'image', data: Buffer.from('PNGDATA').toString('base64'), mimeType: 'image/png' },
    ]);
  });

  it('이미지 크기 경계 — 3,932,160B 는 블록, 1B 초과는 안내(다운로드 없음)', async () => {
    const ok = mockClient([att(9, 'image/jpeg', ex('NONE'), HOME_IMAGE_MAX_BYTES)]);
    expect(Array.isArray(await tool(ok).handler({ fileId: 9 }))).toBe(true);
    const big = mockClient([att(9, 'image/jpeg', ex('NONE'), HOME_IMAGE_MAX_BYTES + 1)]);
    const out = (await tool(big).handler({ fileId: 9 })) as string;
    expect(out).toContain('모델에 보낼 수 없습니다');
    expect(big.downloadHomeAttachment).not.toHaveBeenCalled();
  });

  it('HEIC 등 미지원 이미지 형식 → 안내, 다운로드 없음', async () => {
    const c = mockClient([att(9, 'image/heic', ex('NONE'))]);
    const out = (await tool(c).handler({ fileId: 9 })) as string;
    expect(out).toContain('image/heic');
    expect(out).toContain('JPEG·PNG');
    expect(c.downloadHomeAttachment).not.toHaveBeenCalled();
  });
});
