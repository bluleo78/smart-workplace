// WP-234: 메인 AI 채팅 첨부 읽기 도구 — 세션 바인딩·문서 상태별·이미지(늘 변환본, WP-250).
import { describe, expect, it, vi } from 'vitest';

import { READ_ATTACHMENT_DEFAULT_LIMIT } from '@smart-workplace/mcp-tools-shared';
import type { z } from 'zod';

import type { ExtractionInfo, HomeAttachmentMeta, WorkplaceApiClient } from '../clients/workplace-api.js';
import { buildReadChatAttachmentTool, NO_HOME_SESSION_ERROR } from './home-attachment-tool.js';

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
    // WP-250: /view — 이미지 변환본(JPEG)·PDF 쪽(PNG, X-Page-Count 7).
    viewHomeAttachment: vi.fn(async (_u: number, _s: string, _f: number, page?: number) =>
      page === undefined
        ? { data: Buffer.from('JPGDATA'), mimeType: 'image/jpeg' }
        : { data: Buffer.from('PAGEDATA'), mimeType: 'image/png', pageCount: 7 }),
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

  it('세션 목록에 없는 fileId 는 오류 — 텍스트·이미지 호출 없음', async () => {
    const c = mockClient([att(8, 'application/pdf', ex('READY'))]);
    await expect(tool(c).handler({ fileId: 99 })).rejects.toThrow(/이 대화의 첨부가 아닙니다/);
    expect(c.listHomeSessionAttachments).toHaveBeenCalledWith(USER, SID);
    expect(c.readHomeAttachmentText).not.toHaveBeenCalled();
    expect(c.viewHomeAttachment).not.toHaveBeenCalled();
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

  // WP-250 코드 리뷰: 글자로 못 읽는 PDF 도 이미지를 볼 수 있으면 pages 로 페이지 이미지를 볼 수 있다고 알린다(볼 수 없으면 말하지 않는다).
  it.each([
    ['NONE', ex('NONE')],
    ['FAILED', ex('FAILED', { reason: '추출 오류' })],
  ])('PDF %s → 이미지 입력이면 pages 안내를 덧붙인다', async (_n, x) => {
    const c = mockClient([att(8, 'application/pdf', x)]);
    expect(await tool(c).handler({ fileId: 8 })).toContain('pages:[n] 로 페이지 이미지를 볼 수 있습니다');
    const noVision = buildReadChatAttachmentTool(c as unknown as WorkplaceApiClient, USER, SID, false);
    expect(await noVision.handler({ fileId: 8 })).not.toContain('pages');
  });

  it('문서 NONE → 추출 대상 아님 안내', async () => {
    const c = mockClient([att(8, 'application/zip', ex('NONE'))]);
    expect(await tool(c).handler({ fileId: 8 })).toContain('텍스트 추출 대상이 아닌 형식');
  });

  // WP-250: 보낼 수 있는 원본(작은 PNG·JPEG)이어도 서버 변환본을 준다 — 원본 해상도 그대로면 한 요청에 이미지가 20장을 넘을 때
  // Anthropic API 가 긴 변 2000px 초과 이미지를 거절한다(변환본은 긴 변 1568px 이하).
  it('이미지(png) → 변환본(/view)을 [설명 text, image 블록]으로 — 형식은 변환본 응답 값', async () => {
    const c = mockClient([att(9, 'image/png', ex('NONE'), 7, '화면.png')]);
    const out = await tool(c).handler({ fileId: 9 });
    expect(c.viewHomeAttachment).toHaveBeenCalledWith(USER, SID, 9);
    expect(out).toEqual([
      { type: 'text', text: '첨부 이미지 "화면.png"(fileId 9) (image/jpeg, 7B)' },
      { type: 'image', data: Buffer.from('JPGDATA').toString('base64'), mimeType: 'image/jpeg' },
    ]);
  });

  it('크기와 상관없이(1MB jpeg·상한 초과) 늘 변환본', async () => {
    for (const size of [1_000_000, 3_932_161]) {
      const c = mockClient([att(9, 'image/jpeg', ex('NONE'), size)]);
      const out = (await tool(c).handler({ fileId: 9 })) as Array<{ type: string; mimeType?: string }>;
      expect(c.viewHomeAttachment).toHaveBeenCalledWith(USER, SID, 9);
      expect(out[1]).toMatchObject({ type: 'image', mimeType: 'image/jpeg' });
    }
  });

  it('HEIC 등 보낼 수 없는 형식도 → 다시 올려 달라는 말 대신 /view 변환본 이미지', async () => {
    const c = mockClient([att(9, 'image/heic', ex('NONE'))]);
    const out = (await tool(c).handler({ fileId: 9 })) as Array<{ type: string; mimeType?: string; text?: string }>;
    expect(c.viewHomeAttachment).toHaveBeenCalledWith(USER, SID, 9);
    expect(out[1]).toMatchObject({ type: 'image', mimeType: 'image/jpeg' });
  });

  it('변환 실패(서버 사유) → 사유를 그대로 text 로, 다시 올려 달라고 말하지 않는다', async () => {
    const c = mockClient([att(9, 'image/heic', ex('NONE'))]);
    c.viewHomeAttachment.mockRejectedValue(Object.assign(new Error('x'), { response: { status: 422, data: { message: '손상된 이미지입니다.' } } }));
    const out = (await tool(c).handler({ fileId: 9 })) as string;
    expect(out).toContain('손상된 이미지입니다.');
  });

  describe('WP-250 pages·스캔 PDF', () => {
    it('PDF pages:[3] → viewHomeAttachment(.., 3) 이미지 블록(쪽수 표기)', async () => {
      const c = mockClient([att(8, 'application/pdf', ex('READY'))]);
      const out = (await tool(c).handler({ fileId: 8, pages: [3] })) as Array<{ type: string; text?: string }>;
      expect(c.viewHomeAttachment).toHaveBeenCalledTimes(1);
      expect(c.viewHomeAttachment).toHaveBeenCalledWith(USER, SID, 8, 3);
      expect(out.map((b) => b.type)).toEqual(['text', 'image', 'text']);
      expect(out[0].text).toContain('3쪽(전체 7쪽)');
      expect(c.readHomeAttachmentText).not.toHaveBeenCalled();
    });

    it('pages 는 PDF 에만 — 이미지·문서에 주면 안내, /view 호출 없음', async () => {
      const c = mockClient([att(9, 'image/png', ex('NONE'))]);
      expect(await tool(c).handler({ fileId: 9, pages: [1] })).toContain('PDF 에만');
      expect(c.viewHomeAttachment).not.toHaveBeenCalled();
    });

    it('pages 오류(범위 밖 400)는 던지지 않고 사유를 text 로', async () => {
      const c = mockClient([att(8, 'application/pdf', ex('READY'))]);
      c.viewHomeAttachment.mockRejectedValue(Object.assign(new Error('x'), { response: { status: 400, data: { message: '이 PDF 는 6쪽입니다.' } } }));
      const out = (await tool(c).handler({ fileId: 8, pages: [9] })) as string;
      expect(out).toContain('9쪽');
      expect(out).toContain('이 PDF 는 6쪽입니다.');
    });

    it('SKIPPED SCANNED_PDF(5쪽) → 스캔 PDF 안내 + pages 사용법(재업로드 요구 없음)', async () => {
      const c = mockClient([att(8, 'application/pdf', ex('SKIPPED', { reasonCode: 'SCANNED_PDF', reason: '텍스트가 없는 PDF', pageCount: 5 }), 1000, '스캔.pdf')]);
      const out = (await tool(c).handler({ fileId: 8 })) as string;
      expect(out).toContain('스캔 PDF(5쪽)');
      expect(out).toContain('pages');
      expect(out).not.toContain('다시 올리');
      expect(c.readHomeAttachmentText).not.toHaveBeenCalled();
    });

    it('imageInput false + SKIPPED SCANNED_PDF → 모델 전환 안내(pages 언급 없음)', async () => {
      const c = mockClient([att(8, 'application/pdf', ex('SKIPPED', { reasonCode: 'SCANNED_PDF', pageCount: 5 }))]);
      const t = buildReadChatAttachmentTool(c as unknown as WorkplaceApiClient, USER, SID, false);
      const out = (await t.handler({ fileId: 8 })) as string;
      expect(out).toContain('이미지를 볼 수 있는 모델');
      expect(out).not.toContain('pages');
    });

    it('READY PDF(pageCount 있음) → 텍스트에 pages 안내 note, 쪽수 없으면 note 없음', async () => {
      const c = mockClient([att(8, 'application/pdf', ex('READY'))]);
      c.readHomeAttachmentText.mockResolvedValue({ fileId: 8, status: 'READY', offset: 0, totalChars: 5, truncated: false, nextOffset: null, text: 'x', reasonCode: null, reason: null, pageCount: 4 });
      expect(JSON.parse((await tool(c).handler({ fileId: 8 })) as string).note).toContain('pages');
      c.readHomeAttachmentText.mockResolvedValue({ fileId: 8, status: 'READY', offset: 0, totalChars: 5, truncated: false, nextOffset: null, text: 'x', reasonCode: null, reason: null, pageCount: null });
      expect(JSON.parse((await tool(c).handler({ fileId: 8 })) as string).note).toBeUndefined();
    });

    it('imageInput false → 스키마·설명에 pages 없음, true 면 있다', () => {
      const c = mockClient([]);
      const off = buildReadChatAttachmentTool(c as unknown as WorkplaceApiClient, USER, SID, false);
      const on = buildReadChatAttachmentTool(c as unknown as WorkplaceApiClient, USER, SID, true);
      expect(Object.keys((off.inputSchema as z.ZodObject).shape)).not.toContain('pages');
      expect(off.description).not.toContain('pages');
      expect(Object.keys((on.inputSchema as z.ZodObject).shape)).toContain('pages');
      expect(on.description).toContain('pages');
    });
  });
});
