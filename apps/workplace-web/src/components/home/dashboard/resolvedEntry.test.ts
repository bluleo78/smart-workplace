// resolveEntries·visibleEntries·isWideEntry(WP-412) — 홈 대시보드 위젯 엔트리 해석 규칙 단위 테스트.
// 홈 E2E 가 화면으로 확인하던 규칙(미등록 키 스킵·숨김 제외·저장 순서 유지·wide 판정)을 여기로 옮겼다.
import { describe, expect, it } from 'vitest'

import type { DashboardWidgetConfig } from '@/types/dashboard'

import { isWideEntry, resolveEntries, visibleEntries } from './resolvedEntry'

const cfg = (type: string, over: Partial<DashboardWidgetConfig> = {}): DashboardWidgetConfig => ({
  id: type,
  type,
  count: 5,
  hidden: false,
  ...over,
})

describe('resolveEntries', () => {
  it('미등록 위젯 키는 조용히 건너뛰고 나머지는 저장 순서대로 둔다', () => {
    const entries = resolveEntries([cfg('my_tasks'), cfg('unknown_widget'), cfg('unread_mail')])
    expect(entries.map((e) => e.cfg.type)).toEqual(['my_tasks', 'unread_mail'])
  })

  it('시스템/카탈로그 위젯을 구분해 해석한다', () => {
    const [sys, cat] = resolveEntries([cfg('synthesis'), cfg('issue_list')])
    expect([sys.kind, cat.kind]).toEqual(['system', 'catalog'])
  })
})

describe('visibleEntries', () => {
  it('숨김 위젯을 빼고 저장 순서를 유지한다', () => {
    const entries = resolveEntries([
      cfg('unread_mail'),
      cfg('my_tasks', { hidden: true }),
      cfg('calendar_today'),
    ])
    expect(visibleEntries(entries).map((e) => e.cfg.type)).toEqual(['unread_mail', 'calendar_today'])
  })
})

describe('isWideEntry', () => {
  it('요약·빠른 액션·AI 우선순위 시스템 위젯만 wide(전체 폭)다', () => {
    const wide = resolveEntries(
      ['synthesis', 'quick_actions', 'priority_quadrant', 'my_tasks', 'issue_list'].map((t) => cfg(t)),
    ).map((e) => [e.cfg.type, isWideEntry(e)])
    expect(wide).toEqual([
      ['synthesis', true],
      ['quick_actions', true],
      ['priority_quadrant', true],
      ['my_tasks', false],
      ['issue_list', false],
    ])
  })
})
