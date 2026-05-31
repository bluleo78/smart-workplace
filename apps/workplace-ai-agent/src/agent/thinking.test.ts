import { describe, it, expect } from 'vitest';
import { thinkingDirective } from './thinking.js';

describe('thinkingDirective', () => {
  it('NONE 은 빈 문자열', () => {
    expect(thinkingDirective('NONE')).toBe('');
  });
  it('NORMAL 은 단계적 사고 지시', () => {
    expect(thinkingDirective('NORMAL')).toContain('단계');
  });
  it('DEEP 는 깊은 추론 지시(NORMAL 보다 강함)', () => {
    expect(thinkingDirective('DEEP').length).toBeGreaterThan(thinkingDirective('NORMAL').length);
  });
  it('알 수 없는 값은 NORMAL 로 폴백', () => {
    expect(thinkingDirective('WAT' as never)).toBe(thinkingDirective('NORMAL'));
  });
});
