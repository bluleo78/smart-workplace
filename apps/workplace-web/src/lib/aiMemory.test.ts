import { AxiosError, AxiosHeaders } from 'axios';
import { describe, expect, it } from 'vitest';

import { memoryErrorCode } from './aiMemory';

/** 서버 ErrorResponse 를 실은 axios 오류. */
function apiError(status: number, data: unknown): AxiosError {
  const headers = new AxiosHeaders();
  return new AxiosError('fail', 'ERR_BAD_REQUEST', { headers }, null, {
    status, statusText: '', headers, config: { headers }, data,
  });
}

describe('memoryErrorCode (WP-55)', () => {
  it('ErrorResponse.errors.code 를 꺼낸다', () => {
    expect(memoryErrorCode(apiError(409, { message: 'x', errors: { code: 'AI_MEMORY_FULL' } }))).toBe('AI_MEMORY_FULL');
    expect(memoryErrorCode(apiError(404, { message: 'x', errors: { code: 'AI_MEMORY_GONE' } }))).toBe('AI_MEMORY_GONE');
  });
  it('코드가 없거나 axios 오류가 아니면 null', () => {
    expect(memoryErrorCode(apiError(500, { message: 'x' }))).toBeNull();
    expect(memoryErrorCode(new Error('x'))).toBeNull();
  });
});
