import { AxiosError, AxiosHeaders } from 'axios';
import { describe, expect, it } from 'vitest';

import { canSubmitContent, contentCountTone, listCountTone, memoryErrorMessage, memoryLength } from './aiMemory';

/** 서버 ErrorResponse 를 실은 axios 오류. */
function apiError(status: number, data: unknown): AxiosError {
  const headers = new AxiosHeaders();
  return new AxiosError('fail', 'ERR_BAD_REQUEST', { headers }, null, {
    status, statusText: '', headers, config: { headers }, data,
  });
}

// Review Focus 3: 서버(코드포인트 300)와 같은 기준 — 이모지 한 개는 한 글자, 자르지 않고 막기만 한다.
describe('메모리 길이·카운트 (WP-55)', () => {
  it('앞뒤 공백을 지운 코드포인트 수', () => {
    expect(memoryLength('  가나 ')).toBe(2);
    expect(memoryLength('😀'.repeat(300))).toBe(300);
    expect('😀'.repeat(300).length).toBe(600); // UTF-16 길이와 다르다(전제)
  });
  it('1~300 자만 저장할 수 있다', () => {
    expect(canSubmitContent('')).toBe(false);
    expect(canSubmitContent('   ')).toBe(false);
    expect(canSubmitContent('😀'.repeat(300))).toBe(true);
    expect(canSubmitContent('😀'.repeat(301))).toBe(false);
  });
  it('내용 카운트는 300 초과면 빨강, 목록 카운트는 45 부터 주황', () => {
    expect(contentCountTone(300)).toBe('text-muted-foreground');
    expect(contentCountTone(301)).toBe('text-destructive');
    expect(listCountTone(44)).toBe('text-muted-foreground');
    expect(listCountTone(45)).toBe('text-warning-text');
    expect(listCountTone(50)).toBe('text-warning-text');
  });
  it('메모리 오류는 서버 문구, 그 밖은 fallback', () => {
    expect(memoryErrorMessage(apiError(409, { message: '메모리가 가득 찼어요(최대 50개)', errors: { code: 'AI_MEMORY_FULL' } }), 'f')).toBe(
      '메모리가 가득 찼어요(최대 50개)',
    );
    expect(memoryErrorMessage(new Error('x'), '추가하지 못했어요')).toBe('추가하지 못했어요');
  });
});
