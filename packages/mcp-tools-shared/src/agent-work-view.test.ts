import { describe, expect, it } from 'vitest';
import { toAgentWorkView } from './agent-work-view.js';

const raw = {
  worker: { id: 7, username: 'claude', name: 'Claude', kind: 'AI' },
  tool: 'claude-code',
  state: 'WORKING',
  note: '테스트 작성 중',
  progress: 40,
  stepsDone: 2,
  stepsTotal: 5,
  startedAt: '2026-10-14T00:00:00Z',
  updatedAt: '2026-10-14T00:20:06Z',
  stale: false,
};

describe('toAgentWorkView', () => {
  it('작업자는 {username,name,kind} 만, 시각은 +09:00, stale:false 는 생략', () => {
    const v = toAgentWorkView(raw);
    expect(v).toEqual({
      worker: { username: 'claude', name: 'Claude', kind: 'AI' },
      tool: 'claude-code',
      state: 'WORKING',
      note: '테스트 작성 중',
      progress: 40,
      stepsDone: 2,
      stepsTotal: 5,
      updatedAt: '2026-10-14T09:20:06+09:00',
    });
    expect(v).not.toHaveProperty('stale');
  });

  it('note:null·빈 진행 값은 키째 빠지고 stale:true 만 싣는다', () => {
    const v = toAgentWorkView({ ...raw, note: null, progress: null, stepsDone: null, stepsTotal: null, stale: true });
    expect(v).not.toHaveProperty('note');
    expect(v).not.toHaveProperty('progress');
    expect(v).not.toHaveProperty('stepsDone');
    expect(v.stale).toBe(true);
  });

  it('tool 이 null(시작 전 행)이면 키째 빠진다', () => {
    const v = toAgentWorkView({ ...raw, tool: null, state: 'SUBMITTED' });
    expect(v).not.toHaveProperty('tool');
    expect(v.state).toBe('SUBMITTED');
  });
});
