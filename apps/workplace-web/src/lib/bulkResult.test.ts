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

const STATUS = { done: '상태를 변경했습니다', fail: '상태를 변경하지 못했습니다' };
const DELETE = { done: '삭제했습니다', fail: '삭제하지 못했습니다' };

describe('bulkResultToast', () => {
  it('전부 성공이면 success "N개 …"', () => {
    expect(bulkResultToast([ok, ok], STATUS)).toEqual({ level: 'success', message: '2개 상태를 변경했습니다' });
  });

  it('부분 실패면 warning 에 백엔드 차단 사유를 함께 싣는다 (#710)', () => {
    expect(bulkResultToast([blocked, ok], STATUS)).toEqual({
      level: 'warning',
      message: '1개 상태를 변경했습니다. 1건은 상태를 변경하지 못했습니다: 미완료 하위 이슈가 1건 있어 완료로 변경할 수 없습니다: WP-9',
    });
  });

  it('전부 실패면 error — 완료 문구 없이 「N건 모두 …하지 못했습니다」와 사유 (WP-608)', () => {
    const denied: PromiseSettledResult<unknown> = {
      status: 'rejected',
      reason: apiError(403, { status: 403, message: '이슈는 작성자나 프로젝트 소유자만 삭제할 수 있습니다' }),
    };
    expect(bulkResultToast([denied, denied], DELETE)).toEqual({
      level: 'error',
      message: '2건 모두 삭제하지 못했습니다: 이슈는 작성자나 프로젝트 소유자만 삭제할 수 있습니다',
    });
  });

  it('사유를 못 꺼내면 실패 문구만 — 같은 말을 되풀이하지 않는다', () => {
    const unknown: PromiseSettledResult<unknown> = { status: 'rejected', reason: new Error('net') };
    expect(bulkResultToast([unknown, unknown], DELETE)).toEqual({ level: 'error', message: '2건 모두 삭제하지 못했습니다' });
    expect(bulkResultToast([unknown], DELETE)).toEqual({ level: 'error', message: '삭제하지 못했습니다' });
  });
});
