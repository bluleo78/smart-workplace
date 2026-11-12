// run-project-report 유닛 테스트(WP-1483) — LLM 호출은 runTextEvents 목(러너 이벤트 열)으로 대체.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as messagingAi from './run-messaging-ai.js'
import { PROJECT_REPORT_MAX, projectReportInputSchema, runProjectReport } from './run-project-report.js'
import type { RunAgentDeps } from './run-agent.js'

const mockDeps = {} as RunAgentDeps

vi.mock('./run-messaging-ai.js', async (importOriginal) => {
  const original = await importOriginal<typeof messagingAi>()
  return { ...original, runTextEvents: vi.fn() }
})

function raw(extra: Record<string, unknown> = {}) {
  return {
    projectName: '스마트 워크플레이스',
    title: '11월 2주차 주간 리포트',
    periodLabel: '11월 9일 ~ 15일',
    cadenceLabel: '주간',
    templateMarkdown: '## 상태와 한 줄\n**순조로움**\n\n## 지난 리포트 이후\n| 항목 | 이번 | 변화 |\n',
    badge: 'WARN',
    previousBadge: 'ON_TRACK',
    tableRows: [
      { label: '완료', current: '5', change: '+2' },
      { label: '기한 지남', current: '1', change: '—' },
    ],
    issues: [
      {
        key: 'WP-12',
        url: 'https://app.test/projects/WP/issues/12',
        title: '로그인 오류 수정',
        statusName: '완료',
        category: 'DONE',
        assignees: ['동희'],
        epic: '인증',
        dueDate: '2026-11-10',
        lastComment: '배포했어요',
        reason: 'DONE',
      },
    ],
    assistantAgentId: 1,
    model: 'm',
    maxTurns: 2,
    timeoutMs: 30000,
    ...extra,
  }
}

// 러너 이벤트 픽스처 — result 이벤트의 ok/text 로 성공·실패(시간 초과·턴 상한 등) 실행을 흉내 낸다.
function mockText(text: string, ok = true) {
  vi.mocked(messagingAi.runTextEvents).mockResolvedValue([{ type: 'result', ok, text, usage: null }] as never)
}

function call() {
  const [system, user] = vi.mocked(messagingAi.runTextEvents).mock.calls[0]
  return { system, user }
}

beforeEach(() => vi.clearAllMocks())

describe('runProjectReport', () => {
  it('systemPrompt_forbidsInstructionBoxesAndH1', async () => {
    mockText('## 본문')
    await runProjectReport(projectReportInputSchema.parse(raw()), mockDeps)
    const { system } = call()
    expect(system).toContain('지시 상자')
    expect(system).toContain('출력하지 않는다')
    expect(system).toContain('제목(h1)')
  })

  // 말투는 템플릿 샘플이 정한다 — 기본 템플릿 샘플(합니다체)과 부딪히는 해요체 규칙을 두지 않는다(코드 리뷰 #3).
  it('systemPrompt_toneFollowsTemplateSample_noFixedHaeyo', async () => {
    mockText('## 본문')
    await runProjectReport(projectReportInputSchema.parse(raw()), mockDeps)
    const { system } = call()
    expect(system).not.toContain('해요체')
    expect(system).toContain('말투는 템플릿 샘플을 따른다')
  })

  it('userMessage_includesTemplateRowsAndIssueUrls', async () => {
    mockText('## 본문')
    await runProjectReport(projectReportInputSchema.parse(raw()), mockDeps)
    const { user } = call()
    expect(user).toContain('## 상태와 한 줄')
    expect(user).toContain('완료')
    expect(user).toContain('+2')
    expect(user).toContain('https://app.test/projects/WP/issues/12')
    expect(user).toContain('로그인 오류 수정')
    expect(user).toContain('주의')
  })

  it('stripsWrappingCodeFence', async () => {
    mockText('```markdown\n## 본문\n\n내용\n```')
    const r = await runProjectReport(projectReportInputSchema.parse(raw()), mockDeps)
    expect(r.markdown).toBe('## 본문\n\n내용')
  })

  // 넘친 글은 잘린 리포트라 자르지 않고 실패로 돌려준다(라우트 502 → API 가 30분 뒤 재시도).
  it('overLimit_throws', async () => {
    mockText('가'.repeat(PROJECT_REPORT_MAX + 1))
    await expect(runProjectReport(projectReportInputSchema.parse(raw()), mockDeps)).rejects.toThrow(
      'project_report_too_long',
    )
  })

  it('atLimit_returnsWhole', async () => {
    mockText('가'.repeat(PROJECT_REPORT_MAX))
    const r = await runProjectReport(projectReportInputSchema.parse(raw()), mockDeps)
    expect(Array.from(r.markdown).length).toBe(PROJECT_REPORT_MAX)
  })

  // 실패한 실행(시간 초과·턴 상한·공급자 오류)의 부분 글은 완성 리포트로 저장하지 않는다.
  it('failedRun_throwsEvenWithPartialText', async () => {
    mockText('## 상태와 한 줄\n\n이번 주는', false)
    await expect(runProjectReport(projectReportInputSchema.parse(raw()), mockDeps)).rejects.toThrow(
      'project_report_failed',
    )
  })

  it('emptyOutput_throws', async () => {
    mockText('  \n ')
    await expect(runProjectReport(projectReportInputSchema.parse(raw()), mockDeps)).rejects.toThrow(
      'project_report_empty',
    )
  })

  it('omittedByEpic_renderedAsSummaryLine', async () => {
    mockText('## 본문')
    await runProjectReport(
      projectReportInputSchema.parse(raw({ omittedByEpic: { 인증: 3, '에픽 없음': 2 } })),
      mockDeps,
    )
    const { user } = call()
    expect(user).toContain('인증 3건')
    expect(user).toContain('에픽 없음 2건')
  })
})
