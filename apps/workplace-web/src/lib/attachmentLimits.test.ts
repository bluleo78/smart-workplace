// 첨부 개수 판정(WP-1857) 순수 함수 검증 — 메시지당 10개 상한을 업로드 전에 막는 규칙.
import { describe, expect, it } from 'vitest';

import { checkDraftFileCount, MAX_ATTACHMENTS_PER_MESSAGE } from '@/lib/attachmentLimits';
import { MAX_ATTACHMENTS_PER_MESSAGE as HOME_MAX } from '@/lib/homeChatAttachments';

describe('checkDraftFileCount', () => {
  it('꼭 한도까지 채우면 통과한다', () => {
    expect(checkDraftFileCount(2, 8)).toEqual({ ok: true });
  });

  it('이미 가득 찼으면 더 붙일 수 없다고 알린다', () => {
    expect(checkDraftFileCount(2, 10)).toEqual({
      ok: false,
      message: '첨부는 메시지당 최대 10개예요 — 더 붙일 수 없어요',
    });
  });

  it('넘치면 남은 자리 수를 알린다', () => {
    expect(checkDraftFileCount(3, 8)).toEqual({
      ok: false,
      message: '첨부는 메시지당 최대 10개예요 — 2개 더 붙일 수 있어요',
    });
  });

  it('빈 초안에 한도보다 많이 오면 한도만큼 붙일 수 있다고 알린다', () => {
    const r = checkDraftFileCount(12, 0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('— 10개 더 붙일 수 있어요');
  });

  it('들어오는 파일이 없으면 이미 넘어 있어도 통과한다', () => {
    expect(checkDraftFileCount(0, 12)).toEqual({ ok: true });
  });
});

describe('MAX_ATTACHMENTS_PER_MESSAGE', () => {
  it('10 이고 homeChatAttachments 의 re-export 와 같다', () => {
    expect(MAX_ATTACHMENTS_PER_MESSAGE).toBe(10);
    expect(HOME_MAX).toBe(MAX_ATTACHMENTS_PER_MESSAGE);
  });
});
