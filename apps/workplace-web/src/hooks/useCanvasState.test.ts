import { describe, expect, it } from 'vitest';

import type { WidgetSpec } from '@/types/home';

import { restoreState } from './useCanvasState';

const DEF: WidgetSpec[] = [{ type: 'my_tasks' }];
const types = (page: { widgets: { spec: WidgetSpec }[] }) => page.widgets.map((w) => w.spec.type);

describe('restoreState', () => {
  it('빈 배치 → 기본 구성 단일 페이지', () => {
    const s = restoreState(DEF, []);
    expect(s.pages).toHaveLength(1);
    expect(types(s.pages[0])).toEqual(['my_tasks']);
    expect(s.activeIndex).toBe(0);
  });

  it('page:current 첫 배치 → 기본 페이지 replace-all(페이지 수 유지)', () => {
    const batch: WidgetSpec[] = [{ type: 'issue_list', layout: { page: 'current' } }];
    const s = restoreState(DEF, [batch]);
    expect(s.pages).toHaveLength(1);
    expect(types(s.pages[0])).toEqual(['issue_list']);
  });

  it('page:new 첫 배치 → 기본 페이지 보존 + 새 페이지 추가/이동(라이브와 동일)', () => {
    const batch: WidgetSpec[] = [{ type: 'issue_detail', layout: { page: 'new', pageLabel: 'PROJ-1' } }];
    const s = restoreState(DEF, [batch]);
    expect(s.pages).toHaveLength(2);
    expect(types(s.pages[0])).toEqual(['my_tasks']); // 기본 보존
    expect(s.pages[1].label).toBe('PROJ-1');
    expect(s.activeIndex).toBe(1);
  });

  it('여러 배치 fold(current→new)', () => {
    const b1: WidgetSpec[] = [{ type: 'issue_list', layout: { page: 'current' } }];
    const b2: WidgetSpec[] = [{ type: 'activity', layout: { page: 'new' } }];
    const s = restoreState(DEF, [b1, b2]);
    expect(s.pages).toHaveLength(2);
    expect(types(s.pages[0])).toEqual(['issue_list']);
    expect(types(s.pages[1])).toEqual(['activity']);
    expect(s.activeIndex).toBe(1);
  });
});
