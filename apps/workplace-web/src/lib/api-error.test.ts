import { AxiosError, AxiosHeaders } from 'axios';
import { describe, expect, it } from 'vitest';

import { extractApiError, extractApiErrorAsync, extractApiErrorCode, isServerError, isTransientRequestError, userFacingServerMessage } from './api-error';

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
  // WP-576 — 도메인 오류 코드(errors.code)를 실은 응답은 코드 문자열이 아니라 message 를 보인다(토스트·패널 공통).
  it('errors 가 도메인 오류 코드면 코드 대신 message', () => {
    expect(
      extractApiError(apiError(503, { message: '이 계정은 AI 비서가 꺼져 있어요.', errors: { code: 'AI_DISABLED' } }), 'fb'),
    ).toBe('이 계정은 AI 비서가 꺼져 있어요.');
    expect(extractApiError(apiError(409, { message: '가득 찼어요', errors: { code: 'AI_MEMORY_FULL', scope: 'MAIL' } }), 'fb')).toBe(
      '가득 찼어요',
    );
    // 코드는 있는데 message 가 비면 fallback.
    expect(extractApiError(apiError(503, { message: '', errors: { code: 'AI_DISABLED' } }), 'fb')).toBe('fb');
  });
  // WP-927 — 서버에 닿지 못한 실패(오프라인)는 무엇이 실패했는지 뒤에 연결 확인 안내를 붙인다. 취소·시간 초과는 붙이지 않는다.
  it('네트워크 오류면 fallback 뒤에 연결 확인 안내를 붙인다', () => {
    expect(extractApiError(new AxiosError('Network Error', 'ERR_NETWORK'), '사이클 생성에 실패했습니다')).toBe(
      '사이클 생성에 실패했습니다. 네트워크 연결을 확인한 뒤 다시 시도하세요',
    );
    expect(extractApiError(new AxiosError('canceled', 'ERR_CANCELED'), 'fb')).toBe('fb');
    expect(extractApiError(new AxiosError('timeout', 'ECONNABORTED'), 'fb')).toBe('fb');
  });
  // WP-1879 — 5xx 의 영문 내부 문구("An unexpected error occurred" 등)는 사용자에게 의미가 없어 호출 측 한국어 fallback 으로 바꾼다.
  it('5xx 의 한국어 아닌 내부 문구는 fallback 으로 바꾼다', () => {
    expect(extractApiError(apiError(500, { status: 500, message: 'An unexpected error occurred' }), '메일을 옮기지 못했어요')).toBe(
      '메일을 옮기지 못했어요',
    );
    expect(extractApiError(apiError(502, { message: 'Connection refused' }), '메일을 옮기지 못했어요')).toBe('메일을 옮기지 못했어요');
  });
  it('5xx 의 필드 오류 값도 한국어 아닌 내부 문구면 fallback 으로 바꾼다', () => {
    expect(extractApiError(apiError(502, { message: 'Bad Gateway', errors: { detail: 'Connection reset' } }), 'fb')).toBe('fb');
    expect(extractApiError(apiError(500, { message: 'x', errors: { name: '이름이 너무 깁니다.' } }), 'fb')).toBe('이름이 너무 깁니다.');
  });
  it('5xx 라도 서버가 쓴 한국어 안내는 그대로', () => {
    expect(
      extractApiError(apiError(503, { message: '서버가 일시적으로 혼잡합니다. 잠시 후 다시 시도해주세요.' }), 'fb'),
    ).toBe('서버가 일시적으로 혼잡합니다. 잠시 후 다시 시도해주세요.');
  });
  it('4xx 의 영문 message 는 그대로', () => {
    expect(extractApiError(apiError(400, { message: 'Bad request' }), 'fb')).toBe('Bad request');
  });
  it('code 라는 이름의 필드 검증 문구는 그대로 첫 메시지로 쓴다', () => {
    expect(extractApiError(apiError(400, { message: 'Validation failed', errors: { code: '코드는 6자리입니다.' } }), 'fb')).toBe(
      '코드는 6자리입니다.',
    );
  });
});

// WP-1879: Blob 응답(responseType: 'blob')의 5xx 도 같은 규칙으로 fallback.
describe('extractApiErrorAsync', () => {
  it('Blob 500 내부 문구도 fallback', async () => {
    const blob = new Blob([JSON.stringify({ status: 500, message: 'An unexpected error occurred' })]);
    await expect(extractApiErrorAsync(apiError(500, blob), '다운로드하지 못했어요')).resolves.toBe('다운로드하지 못했어요');
  });
});

// WP-1879: fallback 없이 서버 문구만 이어 붙이는 호출부(메일 완전 삭제 토스트)가 쓴다.
describe('userFacingServerMessage', () => {
  it('5xx 내부 문구·message 없음·axios 오류 아님은 null', () => {
    expect(userFacingServerMessage(apiError(500, { message: 'An unexpected error occurred' }))).toBeNull();
    expect(userFacingServerMessage(apiError(500, {}))).toBeNull();
    expect(userFacingServerMessage(new Error('x'))).toBeNull();
  });
  it('서버가 쓴 한국어 문구와 4xx 문구는 그대로', () => {
    expect(userFacingServerMessage(apiError(503, { message: '메일 서버에 연결하지 못했습니다' }))).toBe('메일 서버에 연결하지 못했습니다');
    expect(userFacingServerMessage(apiError(400, { message: 'Bad request' }))).toBe('Bad request');
  });
});

// WP-859: 세션 확인이 「세션을 남기고 다시 시도」할지 가르는 판정.
describe('isTransientRequestError', () => {
  it('응답 없음(네트워크)·5xx·408·429 는 일시 실패', () => {
    expect(isTransientRequestError(new AxiosError('Network Error', 'ERR_NETWORK'))).toBe(true);
    for (const status of [500, 502, 503, 408, 429]) expect(isTransientRequestError(apiError(status, {}))).toBe(true);
  });

  it('401·403·404 같은 거절과 요청 오류가 아닌 예외는 일시 실패가 아니다', () => {
    for (const status of [400, 401, 403, 404]) expect(isTransientRequestError(apiError(status, {}))).toBe(false);
    expect(isTransientRequestError(new TypeError('x is undefined'))).toBe(false);
  });
});

// WP-1879 — 5xx 판정 한 곳: 응답 상태가 500 이상인 axios 오류만 서버 오류다.
describe('isServerError', () => {
  it('500·503 은 true', () => {
    expect(isServerError(apiError(500, {}))).toBe(true);
    expect(isServerError(apiError(503, {}))).toBe(true);
  });
  it('400·404 는 false', () => {
    expect(isServerError(apiError(400, {}))).toBe(false);
    expect(isServerError(apiError(404, {}))).toBe(false);
  });
  it('응답 없는 네트워크 오류·일반 Error 는 false', () => {
    expect(isServerError(new AxiosError('net', 'ERR_NETWORK'))).toBe(false);
    expect(isServerError(new Error('x'))).toBe(false);
  });
});
