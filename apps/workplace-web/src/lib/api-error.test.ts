import { AxiosError, AxiosHeaders } from 'axios';
import { describe, expect, it } from 'vitest';

import { extractApiError, extractApiErrorCode } from './api-error';

/** 서버 ErrorResponse 를 실은 axios 오류. */
function apiError(status: number, data: unknown): AxiosError {
  const headers = new AxiosHeaders();
  return new AxiosError('fail', 'ERR_BAD_REQUEST', { headers }, null, {
    status, statusText: '', headers, config: { headers }, data,
  });
}

// WP-55: 도메인 오류 코드로 분기하는 화면(메모리 되돌리기 토스트)이 쓰는 코드 추출.
describe('extractApiErrorCode', () => {
  it('ErrorResponse.errors.code 를 꺼낸다', () => {
    expect(extractApiErrorCode(apiError(409, { message: 'x', errors: { code: 'AI_MEMORY_FULL' } }))).toBe('AI_MEMORY_FULL');
    expect(extractApiErrorCode(apiError(404, { message: 'x', errors: { code: 'AI_MEMORY_GONE' } }))).toBe('AI_MEMORY_GONE');
  });
  it('코드가 없거나 axios 오류가 아니면 null', () => {
    expect(extractApiErrorCode(apiError(500, { message: 'x' }))).toBeNull();
    expect(extractApiErrorCode(new Error('x'))).toBeNull();
  });
});

// #580: 필드별 검증 오류(errors 맵)가 있으면 하드코딩 영문 message("Validation failed")보다 우선한다(WP-412 에서 단위로 고정).
describe('extractApiError', () => {
  it('errors 맵의 첫 메시지를 최상위 message 보다 우선한다', () => {
    expect(
      extractApiError(apiError(400, { message: 'Validation failed', errors: { username: '아이디는 공백일 수 없습니다.' } }), 'fb'),
    ).toBe('아이디는 공백일 수 없습니다.');
  });
  it('errors 가 없으면 message, 그것도 없거나 axios 오류가 아니면 fallback', () => {
    expect(extractApiError(apiError(409, { message: '이미 존재합니다' }), 'fb')).toBe('이미 존재합니다');
    expect(extractApiError(apiError(500, { message: '' }), 'fb')).toBe('fb');
    expect(extractApiError(new Error('x'), 'fb')).toBe('fb');
  });
});
