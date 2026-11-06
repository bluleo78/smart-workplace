// 에이전트 상세 가이드 — Works(Claude Code) 방식의 「실행」 섹션에 저장소 연결 안내(토큰 만드는 곳·권한)가 실린다(WP-1268).
import { describe, expect, it } from 'vitest'

import { buildSettingsScreenContext } from '@/lib/aiScreenContext/builders/settings'

import { CLAUDE_TEMPLATE } from '../../test/kits/admin/agentRuntime'
import { AGENT_DETAIL_SECTION_IDS, SETTINGS_SECTION_IDS } from './sectionIds'
import { agentDetailGuide, settingsGuides } from './settingsGuides'
import type { SettingsGuide } from './types'

const agent = { runMode: 'WORKSPACE', type: 'REGULAR', username: 'ai-dev' } as const

const runTips = (template: typeof CLAUDE_TEMPLATE) =>
  (agentDetailGuide(agent, template).sections ?? []).find((s) => s.id === AGENT_DETAIL_SECTION_IDS.run)?.tips?.join('\n') ?? ''

describe('agentDetailGuide — 저장소 연결', () => {
  it('저장소 토큰이 필요한 방식이면 GitHub·GitLab 토큰 권한을 안내한다', () => {
    const tips = runTips(CLAUDE_TEMPLATE)
    expect(tips).toContain('저장소 연결')
    expect(tips).toContain('Contents')
    expect(tips).toContain('Pull requests')
    expect(tips).toContain('Read and write')
    expect(tips).toContain('write_repository')
  })

  it('저장소 토큰이 필요 없는 방식이면 안내가 없다', () => {
    expect(runTips({ ...CLAUDE_TEMPLATE, requires: ['claude'] })).not.toContain('write_repository')
  })
})

describe('agentDetailGuide — 계정 모델 목록(WP-1405)', () => {
  it('모델 칸이 계정 모델 목록을 쓰면 무엇이 보이는지와 기본 선택지 이름(정적 options 의 이름)을 안내한다', () => {
    expect(runTips(CLAUDE_TEMPLATE)).toContain(
      '「모델」 선택지에는 연결한 AI 계정이 쓸 수 있는 모델이 보여요. 목록 맨 앞의 Opus(최신)·Sonnet(최신) 도 고를 수 있고, 계정의 목록을 받지 못하면 이것만 보여요.',
    )
  })

  it('기본 선택지 이름은 하드코딩이 아니라 그 칸의 options 에서 만든다(Gen:iA 모양)', () => {
    const genia = {
      ...CLAUDE_TEMPLATE,
      config: CLAUDE_TEMPLATE.config.map((f) =>
        f.key === 'model' ? { ...f, options: [{ value: 'qwen3.8-27b-fp8', label: 'Qwen3.8 27B' }, { value: 'gpt-6-luna', label: 'GPT 6 Luna' }] } : f,
      ),
    }
    const tips = runTips(genia)
    expect(tips).toContain('목록 맨 앞의 Qwen3.8 27B·GPT 6 Luna 도 고를 수 있고')
    expect(tips).not.toContain('Opus(최신)')
  })

  it('정적 선택지만 쓰는 방식이면 안내가 없다', () => {
    const plain = { ...CLAUDE_TEMPLATE, config: CLAUDE_TEMPLATE.config.map((f) => ({ ...f, optionsFrom: null })) }
    expect(runTips(plain)).not.toContain('연결한 AI 계정이 쓸 수 있는 모델이 보여요')
  })
})

// WP-1298 — 설정 화면 가이드를 화면 섹션별로 나눴다. 섹션 id 는 화면 SettingsSection 과 함께 쓰는 상수에서만 오고(화면 쪽 대조는
// 각 화면 테스트의 expectGuideSectionsOnScreen), 섹션마다 도움말이 있으며, AI 화면 맥락은 섹션 도움말을 빠짐없이 싣는다.
describe('섹션별 설정 가이드', () => {
  const sectioned = Object.entries(settingsGuides).filter(([, g]) => 'sections' in g) as [string, SettingsGuide][]
  const knownIds = new Set<string>(Object.values(SETTINGS_SECTION_IDS))

  it('목록형(에이전트·실행 환경)과 실행 방식으로 고르는 에이전트 상세 말고는 모두 섹션으로 나뉜다', () => {
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
    const values = buildSettingsScreenContext(g).scope!.facts!.map((f) => f.value)
    const expected = [g.lead, ...(g.tips ?? []), ...(g.caution ? [g.caution] : [])]
    for (const s of g.sections!) expected.push(...(s.tips ?? []), ...(s.caution ? [s.caution] : []))
    expect(values).toEqual(expect.arrayContaining(expected))
  })
})
