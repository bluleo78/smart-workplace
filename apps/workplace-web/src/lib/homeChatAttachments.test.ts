import { afterEach, describe, expect, it, vi } from 'vitest';

import { ATTACHMENT_MAX_BYTES } from '@/lib/attachmentLimits';
import type { ChatTurn, HomeAttachment } from '@/types/home';

import {
  checkAttachmentCounts,
  countSessionAttachments,
  homeAttachmentContentPath,
  isHomeChatImage,
  oversizeMessage,
  PER_MESSAGE_LIMIT_MSG,
  PER_SESSION_LIMIT_MSG,
  revokeTurnPreviews,
  splitOversize,
  toTurnAttachments,
  withoutTurnAttachments,
} from './homeChatAttachments';

const extraction = { status: 'READY', totalChars: 10, truncated: false, reasonCode: null, reason: null } as const;
const att = (fileId: number): HomeAttachment => ({
  fileId, messageId: 1, originalName: `f${fileId}.pdf`, mimeType: 'application/pdf', sizeBytes: 10, extraction,
});

describe('checkAttachmentCounts — 메시지 10 · 세션 30', () => {
  it('메시지당 10개까지는 통과', () => {
    expect(checkAttachmentCounts(10, 0, 0)).toEqual({ ok: true });
    expect(checkAttachmentCounts(2, 8, 0)).toEqual({ ok: true });
  });
  it('초안(업로드 중 포함) + 이번 묶음이 10개를 넘으면 메시지 상한 안내', () => {
    expect(checkAttachmentCounts(1, 10, 0)).toEqual({ ok: false, message: PER_MESSAGE_LIMIT_MSG });
    expect(checkAttachmentCounts(3, 8, 0)).toEqual({ ok: false, message: PER_MESSAGE_LIMIT_MSG });
  });
  it('세션에 이미 보낸 첨부 + 초안 + 이번 묶음이 30개를 넘으면 세션 상한 안내', () => {
    expect(checkAttachmentCounts(1, 0, 29)).toEqual({ ok: true });
    expect(checkAttachmentCounts(2, 0, 29)).toEqual({ ok: false, message: PER_SESSION_LIMIT_MSG });
    expect(checkAttachmentCounts(1, 1, 29)).toEqual({ ok: false, message: PER_SESSION_LIMIT_MSG });
  });
  it('둘 다 넘으면 메시지 상한을 먼저 알린다(바로 고칠 수 있는 쪽)', () => {
    expect(checkAttachmentCounts(11, 0, 29)).toEqual({ ok: false, message: PER_MESSAGE_LIMIT_MSG });
  });
});

describe('splitOversize — 25MB', () => {
  it('정확히 25MB 는 통과, 1바이트라도 넘으면 제외', () => {
    const ok = { name: 'a', size: ATTACHMENT_MAX_BYTES };
    const big = { name: 'b', size: ATTACHMENT_MAX_BYTES + 1 };
    expect(splitOversize([ok, big])).toEqual({ accepted: [ok], rejected: [big] });
  });
  it('안내 문구에 빠진 파일명을 나열한다', () => {
    expect(oversizeMessage(['a.mov', 'b.zip'])).toBe('25MB를 넘는 파일은 첨부할 수 없어요: a.mov, b.zip');
  });
});

describe('countSessionAttachments', () => {
  it('사용자 턴의 첨부만 센다', () => {
    const turns: ChatTurn[] = [
      { role: 'user', content: '', attachments: [att(1), att(2)] },
      { role: 'assistant', content: '확인' },
      { role: 'action', outcome: 'done', content: '승인 완료' },
      { role: 'user', content: '또', attachments: [att(3)] },
      { role: 'user', content: '첨부 없음' },
    ];
    expect(countSessionAttachments(turns)).toBe(3);
  });
});

describe('toTurnAttachments', () => {
  it('표시 필드만 남기고 messageId·extraction 은 뺀다', () => {
    expect(toTurnAttachments({ attachments: [att(7)] })).toEqual([
      { fileId: 7, originalName: 'f7.pdf', mimeType: 'application/pdf', sizeBytes: 10 },
    ]);
  });
  it('없거나 비면 undefined — 첨부 없는 기존 메시지와 같은 모양', () => {
    expect(toTurnAttachments({})).toBeUndefined();
    expect(toTurnAttachments({ attachments: [] })).toBeUndefined();
  });
});

describe('revokeTurnPreviews', () => {
  afterEach(() => vi.restoreAllMocks());
  it('사용자 턴의 blob 미리보기만 해제한다', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    revokeTurnPreviews([
      { role: 'user', content: '', attachments: [{ ...att(1), previewUrl: 'blob:one' }, att(2)] },
      { role: 'assistant', content: 'x' },
    ]);
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith('blob:one');
  });
});

describe('withoutTurnAttachments — 거절된 전송의 낙관적 턴', () => {
  afterEach(() => vi.restoreAllMocks());
  it('대상 턴(같은 객체)의 첨부만 떼고, 미리보기 URL 은 해제하지 않는다(초안 소유)', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const sent: ChatTurn = { role: 'user', content: '이전', attachments: [att(1)] };
    const target: ChatTurn = { role: 'user', content: 'q', attachments: [{ ...att(2), previewUrl: 'blob:two' }] };
    const turns: ChatTurn[] = [sent, { role: 'assistant', content: 'a' }, target, { role: 'assistant', content: '' }];
    const next = withoutTurnAttachments(turns, target);
    expect(next[2]).toEqual({ role: 'user', content: 'q' });
    expect(next[0]).toBe(sent);
    expect(countSessionAttachments(next)).toBe(1);
    expect(revoke).not.toHaveBeenCalled();
  });
  it('대상이 없으면(대화가 바뀜) 배열을 그대로 돌려준다', () => {
    const turns: ChatTurn[] = [{ role: 'user', content: 'q', attachments: [att(1)] }];
    const other: ChatTurn = { role: 'user', content: 'q', attachments: [att(1)] };
    expect(withoutTurnAttachments(turns, other)).toBe(turns);
  });
});

describe('homeAttachmentContentPath', () => {
  it('세션 첨부 원본 경로(client baseURL /api/v1 기준)', () => {
    expect(homeAttachmentContentPath('s-1', 7)).toBe('/home/sessions/s-1/attachments/7/content');
  });
});

describe('상한 안내 문구 — 서버 400 문구와 동일(PF-C3)', () => {
  it('메시지·세션 상한 문구가 api HomeAttachmentService 와 글자 그대로 같다', () => {
    expect(PER_MESSAGE_LIMIT_MSG).toBe('한 번에 첨부할 수 있는 파일은 최대 10개예요.');
    expect(PER_SESSION_LIMIT_MSG).toBe('이 대화에는 파일을 최대 30개까지 첨부할 수 있어요. 새 대화를 열어 주세요.');
  });
});

describe('isHomeChatImage', () => {
  it('api INLINE_MIMES·ai-agent HOME_IMAGE_MIMES 와 같은 4종만 이미지로 본다', () => {
    for (const mime of ['image/jpeg', 'image/png', 'image/gif', 'image/webp']) expect(isHomeChatImage(mime)).toBe(true);
  });

  it('그 외 image/*(SVG·HEIC·TIFF 등)와 비이미지는 문서로 본다 — SVG blob 새 탭 스크립트 실행·깨진 썸네일 방지', () => {
    for (const mime of ['image/svg+xml', 'image/heic', 'image/tiff', 'image/bmp', 'application/pdf', 'text/html', '']) {
      expect(isHomeChatImage(mime)).toBe(false);
    }
  });
});
