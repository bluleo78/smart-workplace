import { describe, it, expect } from 'vitest';
import { ProgressTracker } from './progress-tracker.js';

describe('ProgressTracker', () => {
  it('tool_use 는 한국어 라벨 running 단계를 추가하고 true 반환', () => {
    const t = new ProgressTracker();
    expect(t.apply({ kind: 'tool_use', toolName: 'search_wiki' })).toBe(true);
    expect(t.snapshot('tool').steps).toEqual([{ label: '노트 검색', status: 'running' }]);
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

  it('답변 게시 도구(add_channel_message)의 tool_result 는 발행하지 않는다 → false (유령 버블 부활 차단)', () => {
    const t = new ProgressTracker();
    // 답변 작성 시작은 표시 → true
    expect(t.apply({ kind: 'tool_use', toolName: 'add_channel_message' })).toBe(true);
    // 답변 게시 완료(result)는 곧 done 이벤트가 담으므로 별도 'tool' 발행 생략 → false
    expect(t.apply({ kind: 'tool_result' })).toBe(false);
    // 그래도 내부적으로는 done 처리되어 done snapshot 에 '답변 작성 ✓' 가 담긴다.
    expect(t.snapshot('done').steps).toEqual([{ label: '답변 작성', status: 'done' }]);
  });

  it('snapshot 은 내부 terminal 플래그를 노출하지 않는다(label·status 만)', () => {
    const t = new ProgressTracker();
    t.apply({ kind: 'tool_use', toolName: 'add_channel_message' });
    expect(Object.keys(t.snapshot('tool').steps[0]).sort()).toEqual(['label', 'status']);
  });
});
