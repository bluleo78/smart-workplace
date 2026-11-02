// 에이전트 상세 가이드 — Works(Claude Code) 방식의 「실행」 섹션에 저장소 연결 안내(토큰 만드는 곳·권한)가 실린다(WP-1268).
import { describe, expect, it } from 'vitest'

import { CLAUDE_TEMPLATE } from '../../test/kits/admin/agentRuntime'
import { AGENT_DETAIL_SECTION_IDS,agentDetailGuide } from './settingsGuides'

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
