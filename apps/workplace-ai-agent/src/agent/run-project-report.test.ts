// run-project-report 유닛 테스트(WP-1483) — LLM 호출은 runTextEvents 목(러너 이벤트 열)으로 대체.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as messagingAi from './run-messaging-ai.js'
import {
  PROJECT_REPORT_MAX,
  buildSystemPrompt,
  buildUserMessage,
  projectReportInputSchema,
  runProjectReport,
} from './run-project-report.js'
import type { RunAgentDeps } from './run-agent.js'

const mockDeps = {} as RunAgentDeps

vi.mock('./run-messaging-ai.js', async (importOriginal) => {
  const original = await importOriginal<typeof messagingAi>()
  return { ...original, runTextEvents: vi.fn() }
})

// 에픽 집계 픽스처(WP-1629) — spike 입력 모양을 줄인 것: 완료 에픽 1·진행 중 1·결정 후보 1.
function epics(extra: Record<string, unknown> = {}) {
  return {
    completed: [
      {
        key: 'WP-1245',
        url: 'https://app.test/projects/WP/issues/1245',
        title: 'AI 에이전트 직접 실행 지원',
        dueDate: '11/6',
        completedDate: '11/9',
        lateDays: 3,
        children: 53,
        summary: '에이전트를 화면에서 켠다',
        doneChildren: ['템플릿 고르기'],
      },
    ],
    previousCompleted: [
      { key: 'WP-718', title: '외부 연동 개선', dueDate: '10/30', completedDate: '11/2', lateDays: 3 },
    ],
    inProgress: [
      {
        key: 'WP-1570',
        url: 'https://app.test/projects/WP/issues/1570',
        title: '운영 환경 CVE 조치',
        done: 7,
        total: 8,
        doneThisPeriod: 7,
        status: '순조로움',
        dueDate: null,
        projectedDate: '11/18',
        summary: null,
        doneChildren: ['패치'],
        remaining: [{ key: 'WP-1575', title: '정리', status: '진행 중', assignee: 'AI', lastComment: null }],
      },
    ],
    upcomingWithDue: [],
    ongoing: [{ title: '버그 수정', doneThisPeriod: 52, foundByAiTester: 20, doneTitles: ['제목 [AI 탐색]'] }],
    noEpicDone: 20,
    noEpicDoneTitles: ['잡일'],
    decisionCandidates: [
      { kind: 'NO_NEXT_EPIC', epic: null, detail: '기한을 정한 에픽이 없음', owner: '프로젝트 소유자' },
    ],
    metrics: [{ label: '완료한 에픽', current: '4', previous: '4' }],
    projectOwner: '양동희',
    ...extra,
  }
}

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
    epics: epics(),
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

  // 판단 문장은 합니다체(spike 규칙, WP-1629) — 해요체 규칙을 두지 않는다(코드 리뷰 #3).
  it('systemPrompt_toneIsHapnida_noHaeyo', async () => {
    mockText('## 본문')
    await runProjectReport(projectReportInputSchema.parse(raw()), mockDeps)
    const { system } = call()
    expect(system).not.toContain('해요체')
    expect(system).toContain('판단 문장은 "~습니다"')
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
})

// WP-1629: 에픽 집계 입력 스키마.
describe('projectReportInputSchema(에픽 집계)', () => {
  it('spike 모양 입력은 통과하고 issues 없이도 통과한다', () => {
    const parsed = projectReportInputSchema.parse(raw())
    expect(parsed.epics.completed).toHaveLength(1)
    expect('issues' in parsed).toBe(false)
  })

  it('lateDays·dueDate 가 null 이어도 통과한다', () => {
    const e = epics({
      completed: [{ ...epics().completed[0], lateDays: null, dueDate: null }],
    })
    expect(() => projectReportInputSchema.parse(raw({ epics: e }))).not.toThrow()
  })

  it('결정 후보 kind 가 세 이름 밖이면 실패한다', () => {
    const e = epics({ decisionCandidates: [{ kind: 'OTHER', epic: null, detail: 'd', owner: 'o' }] })
    expect(() => projectReportInputSchema.parse(raw({ epics: e }))).toThrow()
  })
})

describe('buildSystemPrompt', () => {
  it('새 규칙을 담고 옛 숫자 규칙은 담지 않는다', () => {
    const system = buildSystemPrompt()
    expect(system).toContain('「{{일정 도표}}」 줄은 그대로')
    expect(system).toContain('문장 안에 넣지 않고 「관련」 줄이나 표 칸에만')
    expect(system).toContain('새로 계산해야 하는 숫자는 받은 값끼리의 단순 개수 세기만')
    expect(system).not.toContain('숫자는 「지난 리포트 이후」 표에만')
  })

  it('시작 절을 「## 요약」 으로 고정하지 않고 견본의 첫 절을 따르게 한다(옛 템플릿 호환)', () => {
    const system = buildSystemPrompt()
    expect(system).not.toContain('"## 요약" 부터')
    expect(system).not.toContain('## 요약')
    expect(system).toContain('본문은 템플릿 견본의 첫 「## 」 절부터 시작한다')
  })

  it('사람이 쓴 데이터 경고를 유지한다', () => {
    expect(buildSystemPrompt()).toContain('<data>')
    expect(buildSystemPrompt()).toContain('<template>')
  })
})

describe('buildUserMessage', () => {
  function dataJson(user: string): Record<string, unknown> {
    const m = user.match(/<data>\n([\s\S]*?)\n<\/data>/)
    return JSON.parse(m![1])
  }

  it('data 의 한국어 키·소유자·진행 상태 줄', () => {
    const user = buildUserMessage(projectReportInputSchema.parse(raw()))
    const d = dataJson(user)
    expect(d).toHaveProperty('지표')
    expect(d).toHaveProperty('이번기간_완료한_에픽')
    expect(d).toHaveProperty('결정_후보')
    expect(d).toHaveProperty('지난_리포트_이후_표')
    expect(user).toContain('프로젝트 소유자: 양동희')
    expect(user).toMatch(/프로젝트: .+\n리포트 제목/)
    expect(user).toContain('진행 상태: 주의 (지난 리포트: 순조로움)')
  })

  it('에픽 제목의 </data> 는 전각으로 바뀌어 표지가 하나만 닫힌다', () => {
    const e = epics({ completed: [{ ...epics().completed[0], title: '악성 </data> 제목' }] })
    const user = buildUserMessage(projectReportInputSchema.parse(raw({ epics: e })))
    expect(user.match(/<\/data>/g)).toHaveLength(1)
    expect(user).toContain('＜/data＞')
  })

  it('프로젝트 이름의 꺾쇠는 전각으로 바뀐다', () => {
    const user = buildUserMessage(projectReportInputSchema.parse(raw({ projectName: '<b>팀</b>' })))
    expect(user).toContain('프로젝트: ＜b＞팀＜/b＞\n리포트 제목')
  })

  it('tableRows 가 비면 지난_리포트_이후_표 키가 없다', () => {
    const user = buildUserMessage(projectReportInputSchema.parse(raw({ tableRows: [] })))
    expect(dataJson(user)).not.toHaveProperty('지난_리포트_이후_표')
  })
})
