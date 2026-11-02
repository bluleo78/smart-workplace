// 설정 가이드가 따라갈 「지금 섹션」 판정(WP-1281) — 기준선(위 30%, 맨 아래면 60%)과 경계 값.
import { describe, expect, test } from 'vitest'

import { ACTIVE_SECTION_BASELINE, ACTIVE_SECTION_BASELINE_AT_BOTTOM, pickActiveSection } from './activeSection'

const sections = (...tops: number[]) => tops.map((top, i) => ({ id: `s${i + 1}`, top }))

describe('pickActiveSection', () => {
  test('섹션이 없으면 null', () => {
    expect(pickActiveSection([], 1000, false)).toBeNull()
    expect(pickActiveSection([], 1000, true)).toBeNull()
  })

  test('기준선 상수 — 위 30%, 맨 아래 60%', () => {
    expect(ACTIVE_SECTION_BASELINE).toBe(0.3)
    expect(ACTIVE_SECTION_BASELINE_AT_BOTTOM).toBe(0.6)
  })

  test('페이지 맨 위 — 첫 섹션 머리가 기준선 위든 아래든 첫 섹션', () => {
    expect(pickActiveSection(sections(0, 400, 800), 1000, false)).toBe('s1')
    // 첫 섹션 머리가 기준선(300) 아래에 있어도(위에 머리말이 있는 경우) 아무 섹션도 닿지 않았으면 첫 섹션
    expect(pickActiveSection(sections(350, 700, 1100), 1000, false)).toBe('s1')
  })

  test('섹션 사이 — 머리가 기준선을 넘어 올라온 섹션 중 마지막', () => {
    // 기준선 300: s1(-500)·s2(100) 통과, s3(600) 아직
    expect(pickActiveSection(sections(-500, 100, 600), 1000, false)).toBe('s2')
  })

  test('경계 — 머리가 기준선과 같으면 그 섹션(≤), 1px 아래면 앞 섹션', () => {
    expect(pickActiveSection(sections(-100, 300), 1000, false)).toBe('s2')
    expect(pickActiveSection(sections(-100, 301), 1000, false)).toBe('s1')
  })

  test('맨 아래 — 기준선이 60% 로 내려가 짧은 마지막 섹션이 잡히되, 아직 못 닿은 마지막 섹션은 잡히지 않는다', () => {
    // 위로는 300 이면 s2, 맨 아래면 600 이라 s3(500)까지 잡힘
    expect(pickActiveSection(sections(-900, -300, 500, 900), 1000, false)).toBe('s2')
    expect(pickActiveSection(sections(-900, -300, 500, 900), 1000, true)).toBe('s3')
    // 맨 아래라도 머리가 60% 선 아래(900)인 마지막 섹션은 「무조건 마지막」이 되지 않는다
    expect(pickActiveSection(sections(-900, -300, 500, 900), 1000, true)).not.toBe('s4')
  })

  test('보이는 높이에 비례 — 같은 위치도 높이가 작으면 앞 섹션', () => {
    expect(pickActiveSection(sections(0, 250), 1000, false)).toBe('s2')
    expect(pickActiveSection(sections(0, 250), 500, false)).toBe('s1')
  })

  test('섹션이 하나면 위치와 무관하게 그 섹션', () => {
    expect(pickActiveSection(sections(5000), 1000, false)).toBe('s1')
    expect(pickActiveSection(sections(-5000), 1000, true)).toBe('s1')
  })
})
