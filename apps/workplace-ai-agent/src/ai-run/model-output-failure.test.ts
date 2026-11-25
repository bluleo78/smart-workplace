// WP-2105: 모델 출력 파싱 실패 기록 보조 함수 검증.
import { describe, expect, it, vi, afterEach } from 'vitest';
import { ModelOutputError } from '../agent/provider-error.js';
import { isModelOutputFailure, logRunFailure, modelOutputFailureDetail, recordModelOutputFailure } from './model-output-failure.js';

afterEach(() => vi.restoreAllMocks());

describe('model-output-failure', () => {
  it('ModelOutputError·SyntaxError 만 파싱 실패로 본다', () => {
    expect(isModelOutputFailure(new ModelOutputError('x'))).toBe(true);
    expect(isModelOutputFailure(new SyntaxError('x'))).toBe(true);
    expect(isModelOutputFailure(new Error('x'))).toBe(false);
  });

  it('상세는 메시지·원문 요약·원문 앞부분 형식', () => {
    expect(modelOutputFailureDetail('Unexpected …', { head: '{"a":1}{"b":2}', length: 14, chunks: 2 })).toBe(
      'Unexpected …\n[원문 앞부분 14자 중 14자, 텍스트 조각 2개]\n{"a":1}{"b":2}',
    );
  });

  it('원문이 없으면 메시지만', () => {
    expect(modelOutputFailureDetail('msg', null)).toBe('msg');
  });

  it('범위 없이도 true 를 돌려주고 던지지 않는다', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(recordModelOutputFailure('t', new ModelOutputError('bad'))).toBe(true);
    expect(recordModelOutputFailure('t', new Error('bad'))).toBe(false);
  });

  it('logRunFailure — 모델 출력 실패는 파싱 실패 로그, 그 밖은 "[tag] 실패:" + 메시지', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    logRunFailure('t', new ModelOutputError('bad'));
    expect(err).toHaveBeenLastCalledWith('[t] 모델 출력 파싱 실패:', 'bad');
    logRunFailure('t', new Error('boom'));
    expect(err).toHaveBeenLastCalledWith('[t] 실패:', 'boom');
    expect(err).toHaveBeenCalledTimes(2);
  });
});
