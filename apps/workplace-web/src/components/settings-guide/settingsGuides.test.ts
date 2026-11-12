// 설정 화면 가이드 — 섹션별 가이드의 id·도움말과 AI 화면 맥락 요약을 본다.
// 에이전트 화면 4곳의 가이드(에이전트 상세 실행 방식별 안내 포함)는 매뉴얼 15장 도움말 절로 옮겨 여기서 빠졌다(WP-1507) —
// 그 문장은 매뉴얼에, 플러그인 명령 표기는 lib/agentManualCommands.test.ts 가 지킨다.
import { describe, expect, it } from 'vitest'

import { buildSettingsScreenContext, guidePairs } from '@/lib/aiScreenContext/builders/settings'

import { SETTINGS_SECTION_IDS } from './sectionIds'
import { settingsGuides } from './settingsGuides'
import type { SettingsGuide } from './types'

describe('섹션별 설정 가이드', () => {
  const sectioned = Object.entries(settingsGuides).filter(([, g]) => 'sections' in g) as [string, SettingsGuide][]
  const knownIds = new Set<string>(Object.values(SETTINGS_SECTION_IDS))

  it('남은 가이드는 모두 섹션으로 나뉜다', () => {
    expect(sectioned.map(([k]) => k).sort()).toEqual(
      ['assistant', 'notifications', 'personalProjectSettings', 'profile', 'projectSettings', 'roleDetail', 'sso', 'userDetail', 'workApp'].sort(),
    )
  })

  it.each(sectioned)('%s — 섹션 id 는 화면과 같은 상수이고 겹치지 않으며, 섹션마다 도움말이 있다', (_key, g) => {
    const ids = g.sections!.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const s of g.sections!) {
      expect(knownIds.has(s.id), s.id).toBe(true)
      expect((s.tips?.length ?? 0) + (s.caution ? 1 : 0), s.id).toBeGreaterThan(0)
    }
  })

  it.each(sectioned)('%s — AI 화면 맥락에 소개·섹션 알아두기·주의가 모두 실린다', (_key, g) => {
    const values = buildSettingsScreenContext(g.title, guidePairs(g)).scope!.facts!.map((f) => f.value)
    const expected = [g.lead, ...(g.tips ?? []), ...(g.caution ? [g.caution] : [])]
    for (const s of g.sections!) expected.push(...(s.tips ?? []), ...(s.caution ? [s.caution] : []))
    expect(values).toEqual(expect.arrayContaining(expected))
  })
})
