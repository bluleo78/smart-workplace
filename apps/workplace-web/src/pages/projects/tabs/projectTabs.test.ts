// 프로젝트 탭 순수 함수 테스트(WP-1477) — 길 만들기·해석·저장값 파싱·되돌리기 판단·탭 목록.
import { describe, expect, it } from 'vitest'

import { DEFAULT_PROJECT_TAB, parseTab, PROJECT_TABS, projectTabPath, shouldRememberTab, shouldRestoreTab, tabFromPath } from './projectTabs'

describe('projectTabPath', () => {
  it('이슈 탭은 프로젝트 길, 나머지는 하위 길', () => {
    expect(projectTabPath('WP', 'issues')).toBe('/projects/WP')
    expect(projectTabPath('WP', 'overview')).toBe('/projects/WP/overview')
  })
})

describe('tabFromPath', () => {
  it('탭 길을 해석하고 탭이 아닌 길은 null', () => {
    expect(tabFromPath('/projects/WP/', 'WP')).toBe('issues')
    expect(tabFromPath('/projects/WP/cycles', 'WP')).toBe('cycles')
    expect(tabFromPath('/projects/WP/issues/12', 'WP')).toBeNull()
    expect(tabFromPath('/projects/WP/versions/3', 'WP')).toBeNull()
    expect(tabFromPath('/projects/WP/settings', 'WP')).toBeNull()
  })

  it('인코딩된 주소(location.pathname)를 디코딩된 key(useParams)와 맞춰 본다', () => {
    expect(tabFromPath('/projects/%ED%82%A4', '키')).toBe('issues')
    expect(tabFromPath('/projects/%ED%82%A4/cycles', '키')).toBe('cycles')
    expect(tabFromPath('/projects/A%20B/timeline/', 'A B')).toBe('timeline')
  })

  it('잘못된 % 인코딩 조각은 원문 그대로 비교한다(던지지 않는다)', () => {
    expect(tabFromPath('/projects/%E0%A4%A/versions', '%E0%A4%A')).toBe('versions')
    expect(tabFromPath('/projects/%E0%A4%A/versions', 'WP')).toBeNull()
  })
})

describe('parseTab', () => {
  it('보이는 탭만 통과', () => {
    expect(parseTab('cycles')).toBe('cycles')
    expect(parseTab('notes')).toBeNull()
    expect(parseTab('foo')).toBeNull()
    expect(parseTab(null)).toBeNull()
  })
})

describe('shouldRestoreTab', () => {
  const base = { search: '', navigationType: 'PUSH' as const, locationKey: 'abc', fromTab: false }
  it('쿼리 없는 PUSH·첫 진입만 되돌린다', () => {
    expect(shouldRestoreTab(base)).toBe(true)
    expect(shouldRestoreTab({ ...base, navigationType: 'POP', locationKey: 'default' })).toBe(true)
    expect(shouldRestoreTab({ ...base, navigationType: 'POP' })).toBe(false)
    expect(shouldRestoreTab({ ...base, navigationType: 'REPLACE' })).toBe(false)
    expect(shouldRestoreTab({ ...base, search: '?view=board' })).toBe(false)
    expect(shouldRestoreTab({ ...base, fromTab: true })).toBe(false)
  })
})

describe('shouldRememberTab', () => {
  it('사용자가 고른 이동(PUSH·REPLACE)과 첫 진입만 기억하고, 뒤로·앞으로(POP) 도착은 기억하지 않는다', () => {
    expect(shouldRememberTab({ navigationType: 'PUSH', locationKey: 'abc' })).toBe(true)
    expect(shouldRememberTab({ navigationType: 'REPLACE', locationKey: 'abc' })).toBe(true)
    expect(shouldRememberTab({ navigationType: 'POP', locationKey: 'default' })).toBe(true)
    expect(shouldRememberTab({ navigationType: 'POP', locationKey: 'abc' })).toBe(false)
  })
})

describe('PROJECT_TABS', () => {
  it('보이는 탭 라벨 순서', () => {
    expect(PROJECT_TABS.filter((t) => t.visible).map((t) => t.label)).toEqual(['개요', '이슈', '타임라인', '사이클', '버전'])
  })
})

describe('DEFAULT_PROJECT_TAB', () => {
  it('기억한 탭이 없을 때 여는 기본 탭은 이슈 — 개요가 아직 자리 표시라 첫 진입이 빈 화면이 되지 않게', () => {
    expect(DEFAULT_PROJECT_TAB).toBe('issues')
    // 기본 탭은 보이는 탭이어야 한다(저장값 해석을 통과하는 값).
    expect(parseTab(DEFAULT_PROJECT_TAB)).toBe(DEFAULT_PROJECT_TAB)
  })
})
