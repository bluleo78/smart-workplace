import { describe, it, expect } from 'vitest';
import { ProgressTracker } from './progress-tracker.js';

describe('ProgressTracker', () => {
  it('tool_use 는 한국어 라벨 running 단계를 추가하고 true 반환', () => {
    const t = new ProgressTracker();
    expect(t.apply({ kind: 'tool_use', toolName: 'search_wiki' })).toBe(true);
    expect(t.snapshot('tool').steps).toEqual([{ label: '위키 검색', status: 'running' }]);
  });

  it('tool_result 는 직전 running 단계를 done 으로 바꾸고 true 반환', () => {
    const t = new ProgressTracker();
    t.apply({ kind: 'tool_use', toolName: 'get_issue_detail' });
    expect(t.apply({ kind: 'tool_result' })).toBe(true);
    expect(t.snapshot('tool').steps).toEqual([{ label: '이슈 조회', status: 'done' }]);
  });

  it('미지정 도구는 도구명을 라벨로 사용', () => {
    const t = new ProgressTracker();
    t.apply({ kind: 'tool_use', toolName: 'mystery_tool' });
    expect(t.snapshot('tool').steps[0].label).toBe('mystery_tool');
  });

  it('null 신호와 result 신호는 단계 변화 없음 → false', () => {
    const t = new ProgressTracker();
    expect(t.apply(null)).toBe(false);
    expect(t.apply({ kind: 'result' })).toBe(false);
  });
});
