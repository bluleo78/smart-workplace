import { describe, expect, it } from 'vitest';

import type { HomeMessage } from '@/types/home';

import { parseRestoredSession } from './home-restore';

const msgs: HomeMessage[] = [
  { id: 1, role: 'USER', content: '내 이슈', widgets: null, createdAt: 't1' },
  { id: 2, role: 'ASSISTANT', content: '여기요', widgets: [{ type: 'issue_list' }], createdAt: 't2' },
  { id: 3, role: 'USER', content: '그 중 HIGH', widgets: null, createdAt: 't3' },
  { id: 4, role: 'ASSISTANT', content: '필터링', widgets: [{ type: 'issue_list', params: { priority: 'HIGH' } }], createdAt: 't4' },
];

describe('parseRestoredSession', () => {
  it('역할 매핑(대문자→소문자) + 순서 보존', () => {
    const { turns } = parseRestoredSession(msgs);
    expect(turns).toEqual([
      { role: 'user', content: '내 이슈' },
      { role: 'assistant', content: '여기요' },
      { role: 'user', content: '그 중 HIGH' },
      { role: 'assistant', content: '필터링' },
    ]);
  });

  it('ASSISTANT widgets(non-null, 비어있지 않음)만 배치로 수집', () => {
    const { widgetBatches } = parseRestoredSession(msgs);
    expect(widgetBatches).toHaveLength(2);
    expect(widgetBatches[1][0].params).toEqual({ priority: 'HIGH' });
  });

  it('빈/위젯없는 ASSISTANT 는 배치 제외', () => {
    const r = parseRestoredSession([
      { id: 1, role: 'ASSISTANT', content: '음', widgets: [], createdAt: 't' },
      { id: 2, role: 'ASSISTANT', content: '음2', widgets: null, createdAt: 't' },
    ]);
    expect(r.widgetBatches).toEqual([]);
    expect(r.turns).toHaveLength(2);
  });

  it('빈 메시지 → 빈 결과', () => {
    expect(parseRestoredSession([])).toEqual({ turns: [], widgetBatches: [] });
  });
});
