// bulkResultToast(WP-412) — 이슈 일괄 작업 결과 토스트 판단 단위 테스트(issue-list-bulk E2E 에서 이관).
import { AxiosError, AxiosHeaders } from 'axios';
import { describe, expect, it } from 'vitest';

import { bulkResultToast } from './bulkResult';

// 백엔드 ErrorResponse 를 실은 axios 오류 — extractApiError 가 message 를 꺼낸다.
function apiError(status: number, data: unknown): AxiosError {
  const headers = new AxiosHeaders();
  return new AxiosError('fail', 'ERR_BAD_REQUEST', { headers }, null, {
    status, statusText: '', headers, config: { headers }, data,
  });
}

const ok: PromiseSettledResult<unknown> = { status: 'fulfilled', value: {} };
const blocked: PromiseSettledResult<unknown> = {
  status: 'rejected',
  reason: apiError(400, { status: 400, message: '미완료 하위 이슈가 1건 있어 완료로 변경할 수 없습니다: WP-9' }),
};

describe('bulkResultToast', () => {
  it('전부 성공이면 success "N개 …"', () => {
    expect(bulkResultToast([ok, ok], '상태를 변경했습니다')).toEqual({ level: 'success', message: '2개 상태를 변경했습니다' });
  });

  it('부분 실패면 warning 에 백엔드 차단 사유를 함께 싣는다 (#710)', () => {
    expect(bulkResultToast([blocked, ok], '상태를 변경했습니다')).toEqual({
      level: 'warning',
      message: '1개 상태를 변경했습니다, 1건 실패: 미완료 하위 이슈가 1건 있어 완료로 변경할 수 없습니다: WP-9',
    });
  });

  it('전부 실패면 error, 사유를 못 꺼내면 "… 실패" 폴백', () => {
    const unknown: PromiseSettledResult<unknown> = { status: 'rejected', reason: new Error('net') };
    expect(bulkResultToast([unknown, unknown], '삭제했습니다')).toEqual({
      level: 'error',
      message: '삭제했습니다 실패 (2건): 삭제했습니다 실패',
    });
  });
});
