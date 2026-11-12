// run-personal-report 유닛 테스트(WP-1486) — LLM 호출은 runTextEvents 목(러너 이벤트 열)으로 대체(run-project-report.test 와 같은 방식).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as messagingAi from './run-messaging-ai.js'
import { PERSONAL_REPORT_MAX, personalReportInputSchema, runPersonalReport } from './run-personal-report.js'
import type { RunAgentDeps } from './run-agent.js'

const mockDeps = {} as RunAgentDeps

vi.mock('./run-messaging-ai.js', async (importOriginal) => {
  const original = await importOriginal<typeof messagingAi>()
  return { ...original, runTextEvents: vi.fn() }
})

// 일일 보고 요청 — 숫자 줄(numbersLine)을 싣고 표 행은 비운다(API DTO 와 같은 모양).
function daily(extra: Record<string, unknown> = {}) {
  return {
    userName: '양동희',
    kind: 'DAILY',
    kindLabel: '일일',
    title: '11월 11일 (수) 일일 보고',
    periodLabel: '11월 11일 (수)',
    templateMarkdown: '## 한 줄\n샘플 문장입니다.\n\n## 어제 숫자\n| 끝냄 | 새로 만듦 | 상태 바꿈 | 기한 지남 |\n',
    tableRows: [],
    numbersLine: '끝냄 4 · 기한 내 3 · AI와 함께 1 | 새로 만듦 1 | 상태 바꿈 6 | 기한 지남 2',
    issues: [
      {
        key: 'WP-12',
        url: 'https://app.test/projects/WP/issues/12',
        title: '로그인 오류 수정',
        statusName: '완료',
        category: 'DONE',
        assignees: ['양동희'],
        epic: null,
        dueDate: '2026-11-10',
        lastComment: '배포했어요',
        reason: 'DONE',
        project: '스마트 워크플레이스',
        lateDays: 1,
        withAi: true,
      },
      {
        key: 'WP-30',
        url: 'https://app.test/projects/WP/issues/30',
        title: '질문 답하기',
        statusName: '진행 중',
        category: 'IN_PROGRESS',
        assignees: ['양동희'],
        epic: '메일',
        dueDate: null,
        lastComment: null,
        reason: 'WAITING',
        project: '스마트 워크플레이스',
        lateDays: null,
        withAi: false,
      },
    ],
    omittedByEpic: { 메일: 3 },
    assistantAgentId: 1,
    model: 'm',
    maxTurns: 2,
    timeoutMs: 30000,
    ...extra,
  }
}

// 주간 보고 요청 — 표 행을 싣고 숫자 줄은 null.
function weekly(extra: Record<string, unknown> = {}) {
  return daily({
    kind: 'WEEKLY',
    kindLabel: '주간',
    title: '11월 2주차 주간 보고',
    periodLabel: '11월 9일 ~ 15일',
    numbersLine: null,
    tableRows: [
      { label: '끝냄', current: '18', change: '+4' },
      { label: '평균 소요', current: '3.2일', change: '−0.5일' },
    ],
    ...extra,
  })
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

describe('runPersonalReport', () => {
  it('systemPrompt_containsUserNameKindAndRules', async () => {
    mockText('## 한 줄\n본문')
    await runPersonalReport(personalReportInputSchema.parse(daily()), mockDeps)
    const { system } = call()
    expect(system).toContain('양동희 의 개인 일일 보고')
    expect(system).toContain('제목(h1)')
    expect(system).toContain('지시 상자 자체는 출력하지 않는다')
    expect(system).toContain('AI 를 주어로 세우지 않는다')
    expect(system).toContain('「막힌 것」')
    expect(system).toContain('「없음」')
    expect(system).toContain('받은 목록에 없는 이슈를 지어내지 않는다')
    expect(system).toContain('<template>, <issue>')
    // 「주」→「달」 규칙은 월간에만 싣는다.
    expect(system).not.toContain('「주」를 「달」로')
  })

  it('systemPrompt_monthly_replacesWeekWithMonth', async () => {
    mockText('## 한 줄\n본문')
    await runPersonalReport(
      personalReportInputSchema.parse(weekly({ kind: 'MONTHLY', kindLabel: '월간', title: '10월 월간 보고' })),
      mockDeps,
    )
    const { system } = call()
    expect(system).toContain('양동희 의 개인 월간 보고')
    expect(system).toContain('「주」를 「달」로')
  })

  it('userMessage_includesTemplateNumbersLineAndIssueUrls', async () => {
    mockText('## 한 줄\n본문')
    await runPersonalReport(personalReportInputSchema.parse(daily()), mockDeps)
    const { user } = call()
    expect(user).toContain('<template>')
    expect(user).toContain('## 어제 숫자')
    expect(user).toContain('끝냄 4 · 기한 내 3 · AI와 함께 1 | 새로 만듦 1 | 상태 바꿈 6 | 기한 지남 2')
    expect(user).toContain('https://app.test/projects/WP/issues/12')
    expect(user).toContain('https://app.test/projects/WP/issues/30')
    expect(user).toContain('이유: 내 답을 기다림')
    expect(user).toContain('프로젝트: 스마트 워크플레이스')
    expect(user).toContain('늦음: 1일')
    expect(user).toContain('AI와 함께')
    expect(user).toContain('메일 3건')
  })

  it('userMessage_includesTableRows_weekly', async () => {
    mockText('## 한 줄\n본문')
    await runPersonalReport(personalReportInputSchema.parse(weekly()), mockDeps)
    const { user } = call()
    expect(user).toContain('- 끝냄: 18 (변화 +4)')
    expect(user).toContain('- 평균 소요: 3.2일 (변화 −0.5일)')
    expect(user).toContain('11월 9일 ~ 15일')
  })

  // 실패한 실행(시간 초과·턴 상한·공급자 오류)의 부분 글은 완성 보고로 저장하지 않는다.
  it('failedRun_throws', async () => {
    mockText('## 한 줄\n어제는', false)
    await expect(runPersonalReport(personalReportInputSchema.parse(daily()), mockDeps)).rejects.toThrow(
      'personal_report_failed',
    )
  })

  it('emptyOutput_throws', async () => {
    mockText('  \n ')
    await expect(runPersonalReport(personalReportInputSchema.parse(daily()), mockDeps)).rejects.toThrow(
      'personal_report_empty',
    )
  })

  // 넘친 글은 잘린 보고라 자르지 않고 실패로 돌려준다(라우트 502 → API 가 30분 뒤 재시도).
  it('overLimit_throws', async () => {
    mockText('가'.repeat(PERSONAL_REPORT_MAX + 1))
    await expect(runPersonalReport(personalReportInputSchema.parse(daily()), mockDeps)).rejects.toThrow(
      'personal_report_too_long',
    )
  })

  it('stripsWrappingCodeFence', async () => {
    mockText('```markdown\n## 한 줄\n\n내용\n```')
    const r = await runPersonalReport(personalReportInputSchema.parse(daily()), mockDeps)
    expect(r.markdown).toBe('## 한 줄\n\n내용')
  })
})
