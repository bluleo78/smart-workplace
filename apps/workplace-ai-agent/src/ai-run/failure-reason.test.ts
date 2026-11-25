import { describe, expect, it } from 'vitest';
import { RunnerLimitError } from '../agent/runner-limit.js';
import { failureReasonOf } from './failure-reason.js';

// 처리 기록 실패 사유 코드 판정 (WP-2106)
describe('failureReasonOf', () => {
  it('한도 문구 → provider_limit', () => {
    expect(failureReasonOf(new Error("API Error: You've hit your org's monthly spend limit"))).toBe('provider_limit');
  });
  it('WP-2137: 운영 주간 한도 문구 → provider_limit', () => {
    // 실제 운영 주간 한도 문구가 처리 기록 사유 provider_limit 으로 남는지 고정한다
    expect(failureReasonOf(new Error("Claude Code returned an error result: You've hit your weekly limit · resets 3pm (UTC)"))).toBe('provider_limit');
  });
  it('시간 한도 RunnerLimitError → timeout', () => {
    expect(failureReasonOf(new RunnerLimitError('timeout', 'x timeout after 60000ms'))).toBe('timeout');
  });
  it('모델 없음 문구 → model_not_found', () => {
    expect(failureReasonOf(new Error('API Error: 404 model genia/x does not exist or is disabled'))).toBe('model_not_found');
  });
  it('401 인증 오류 → provider_auth', () => {
    expect(failureReasonOf(new Error('API Error: 401 unauthorized'))).toBe('provider_auth');
  });
  it('429 → provider_rate, 529 → provider_overloaded, 503 → provider_error', () => {
    expect(failureReasonOf(new Error('API Error: 429 slow down'))).toBe('provider_rate');
    expect(failureReasonOf(new Error('API Error: 529 busy'))).toBe('provider_overloaded');
    expect(failureReasonOf(new Error('API Error: 503 down'))).toBe('provider_error');
  });
  it('opencode 세션 생성 실패 → runner_unavailable', () => {
    expect(failureReasonOf(new Error('opencode session 생성 실패: x'))).toBe('runner_unavailable');
  });
  it('평범한 오류·SyntaxError·max_turns 는 null', () => {
    expect(failureReasonOf(new Error('boom'))).toBeNull();
    expect(failureReasonOf(new SyntaxError('bad json'))).toBeNull();
    expect(failureReasonOf(new RunnerLimitError('max_turns', 'max turns'))).toBeNull();
  });
});
