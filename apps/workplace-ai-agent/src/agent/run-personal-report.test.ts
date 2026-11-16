// run-personal-report 유닛 테스트(WP-1486) — LLM 호출은 runTextEvents 목(러너 이벤트 열)으로 대체(run-project-report.test 와 같은 방식).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as messagingAi from './run-messaging-ai.js'
import {
  PERSONAL_REPORT_MAX,
  personalReportInputSchema,
  runPersonalReport,
  type PersonalIssueInput,
  type ProjectWorkInput,
} from './run-personal-report.js'
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

// 끝낸 일 프로젝트 → 에픽 집계(WP-1632) — 새 API 의 주간·월간 요청에 실린다. 제목에 꺾쇠를 넣어 걸러지는지 본다.
const DONE_BY_PROJECT: ProjectWorkInput[] = [
  {
    projectKey: 'WP',
    projectName: 'Gen:iA Works',
    done: 112,
    foundByAiTester: 90,
    epics: [
      {
        key: 'WP-10',
        url: 'https://app.test/projects/WP/issues/10',
        title: '통합 검색',
        ongoing: false,
        epicDone: true,
        done: 12,
        foundByAiTester: 0,
        doneTitles: ['색인 <script>', '결과 화면'],
      },
      {
        key: null,
        url: null,
        title: '에픽 없음',
        ongoing: false,
        epicDone: false,
        done: 100,
        foundByAiTester: 90,
        doneTitles: ['버그 1'],
      },
    ],
  },
]

// 프로젝트 표가 든 주간 템플릿(WP-1632 기본 템플릿 모양) — 표 판정은 API 가 해서 workTableInTemplate 로 보낸다.
const WORK_TEMPLATE = '## 이번 주 한 일\n\n| 프로젝트 | 끝낸 일 | 주요 내용 |\n| --- | --- | --- |\n| 예시 | 1건 | 예시 |\n'
const WITH_TABLE = { templateMarkdown: WORK_TEMPLATE, workTableInTemplate: true }
// 표 규칙 문구(템플릿 지시 상자를 따르라는 줄).
const TABLE_RULE = '프로젝트 표와 프로젝트별 절은 템플릿 지시 상자대로 쓴다'

// 첫 이슈에 값을 덮어쓴 일일 요청 — 새 선택 필드(assigneesDetail 등)를 실은 새 API 페이로드를 흉내 낸다.
// patch 를 zod 입력 타입(PersonalIssueInput)으로 받아 픽스처가 스키마와 어긋나면 타입 검사에서 걸리게 한다.
function withFirstIssue(patch: Partial<PersonalIssueInput>) {
  const [first, ...rest] = daily().issues
  return daily({ issues: [{ ...first, ...patch }, ...rest] })
}

// 러너 이벤트 픽스처 — result 이벤트의 ok/text 로 성공·실패(시간 초과·턴 상한 등) 실행을 흉내 낸다.
function mockText(text: string, ok = true) {
  vi.mocked(messagingAi.runTextEvents).mockResolvedValue([{ type: 'result', ok, text, usage: null }] as never)
}

function call() {
  const [system, user] = vi.mocked(messagingAi.runTextEvents).mock.calls[0]
  return { system, user }
}

// 요청 하나로 러너를 돌리고 AI 에 넘긴 시스템·사용자 글을 돌려준다 — 프롬프트만 보는 테스트의 목·파싱·호출 반복을 줄인다.
async function runWith(input: Record<string, unknown>) {
  mockText('## 요약\n본문')
  await runPersonalReport(personalReportInputSchema.parse(input), mockDeps)
  return call()
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

  // WP-1632 보고 형식 규칙 — 같은 일일 요청(구 API 모양: completedSplit 없음)의 시스템 프롬프트에 규칙 문구가 실리는지 본다.
  // 구조 규칙(할 일 표·관련 줄·요약 끝낸 일 줄)은 템플릿에 그 모양이 있을 때만, 일반 규칙은 늘 따르게 한다(옛 템플릿 호환).
  it.each([
    // 숫자: 받은 값만, 새로 계산하는 것은 개수 세기뿐
    '숫자는 받은 값만 쓴다',
    '받은 목록의 개수 세기',
    '합·차·비율을 새로 만들거나 지어내지 않는다',
    // 일반 규칙 — 템플릿과 상관없이 늘(맨 앞 「- 」 로 들여쓰기 없는 규칙 줄)
    '- 이슈 주소는 문장 안에 넣지 않는다.',
    '줄마다 「· AI와 함께」를 붙이지 않는다',
    '- 판단은 「~습니다」 문장으로',
    '명사형 개조식',
    '목록에 담지 못한 이슈의 건수는 본문에 쓰지 않는다',
    '(예: ~습니다)',
    // 구조 규칙 — 템플릿에 그 모양이 있을 때만
    '템플릿에 그 모양이 없으면 템플릿 모양을 따른다',
    '템플릿에 「오늘 할 일」·「다음 주 할 일」·「다음 달 할 일」 표가 있으면',
    '내가 직접 움직여야 하는 일만',
    '「내 답을 기다림」인 일은 담당에 AI 가 있어도 늘 표에 넣는다',
    '그 밖에 담당에 AI 가 있는(담당 칸에 「(AI)」 가 있는) 일은 표에 넣지 않고 표 아래 한 줄로 묶는다',
    '템플릿에 「관련」 줄이 있으면',
    '「관련」 줄에는 3개까지만',
    '템플릿 요약에 「끝낸 일」 줄이 있으면',
    // 구 API 대비 — 「끝낸 일」 줄을 받지 못했으면 직접 건수를 계산하지 않는다
    '「끝낸 일: …」 줄을 받지 못했으므로',
    '직접 건수는 계산하지 않는다',
  ])('systemPrompt_reportFormatRules: %s', async (phrase) => {
    const { system } = await runWith(daily())
    expect(system).toContain(phrase)
  })

  it('systemPrompt_noCompletedFallback_whenSplitGiven', async () => {
    const { system } = await runWith(daily({ completedSplit: { completed: 7, withAi: 5, direct: 2 } }))
    expect(system).not.toContain('「끝낸 일: …」 줄을 받지 못했으므로')
  })

  it('userMessage_completedSplitLine_whenPresent', async () => {
    const { user } = await runWith(daily({ completedSplit: { completed: 7, withAi: 5, direct: 2 } }))
    expect(user).toContain('끝낸 일: 7건 (AI와 함께 5, 직접 2)')
  })

  it('userMessage_noCompletedSplitLine_whenOldApi', async () => {
    const { user } = await runWith(daily())
    expect(user).not.toContain('끝낸 일:')
  })

  it('userMessage_assigneesWithKind_whenDetailPresent', async () => {
    const { user } = await runWith(
      withFirstIssue({
        assignees: ['양동희', 'AI 개발자1'],
        assigneesDetail: [
          { name: '양동희', kind: 'HUMAN' },
          { name: 'AI 개발자1', kind: 'AGENT' },
        ],
      }),
    )
    expect(user).toContain('담당: 양동희(사람), AI 개발자1(AI)')
    expect(user).not.toContain('담당: 양동희, AI 개발자1')
    // 상세가 없는 이슈(두 번째)는 이름만 쓴다.
    expect(user).toContain('담당: 양동희 |')
  })

  // 모르는 종류는 꼬리표 없이 이름만 — 「constructor」 같은 객체 기본 키가 꼬리표로 새지 않는다.
  it('userMessage_unknownOrPrototypeKind_nameOnly', async () => {
    const { user } = await runWith(
      withFirstIssue({
        assignees: ['봇', '도우미'],
        assigneesDetail: [
          { name: '봇', kind: 'constructor' },
          { name: '도우미', kind: 'SERVICE' },
        ],
      }),
    )
    expect(user).toContain('담당: 봇, 도우미 |')
  })

  // 상세가 빈 목록이면 공용 표기와 같이 「(없음)」.
  it('userMessage_emptyAssigneesDetail_none', async () => {
    const { user } = await runWith(withFirstIssue({ assignees: [], assigneesDetail: [] }))
    expect(user).toContain('담당: (없음) |')
  })

  it('userMessage_assigneesNamesOnly_whenOldApi', async () => {
    const { user } = await runWith(daily())
    expect(user).toContain('담당: 양동희 |')
    expect(user).not.toContain('(사람)')
  })

  it('userMessage_omittedLine', async () => {
    const { user } = await runWith(daily())
    expect(user).toContain('목록에 담지 못한 이슈: 메일 3건')
  })

  // ───────────── 끝낸 일 프로젝트 집계(WP-1632) ─────────────

  it('schema_acceptsDoneByProject_oldPayloadStillPasses', () => {
    expect(personalReportInputSchema.safeParse(weekly({ doneByProject: DONE_BY_PROJECT })).success).toBe(true)
    expect(personalReportInputSchema.safeParse(weekly({ doneByProject: null })).success).toBe(true)
    expect(personalReportInputSchema.safeParse(weekly({ workTableInTemplate: null })).success).toBe(true)
    expect(personalReportInputSchema.safeParse(weekly()).success).toBe(true)
    const bad = [{ ...DONE_BY_PROJECT[0], done: '많음' }]
    expect(personalReportInputSchema.safeParse(weekly({ doneByProject: bad })).success).toBe(false)
  })

  it('userMessage_dataBlock_sanitized_andDetailListName', async () => {
    const { user } = await runWith(weekly({ doneByProject: DONE_BY_PROJECT, ...WITH_TABLE }))
    expect(user).toContain('<data>')
    expect(user).toContain('"프로젝트별_끝낸_일"')
    // 들여쓰기 없는 한 줄 JSON — 큰 달의 입력 크기를 줄인다(WP-1632 리뷰).
    expect(user).toContain('"프로젝트":"Gen:iA Works"')
    expect(user).toContain('"끝낸_일":112')
    expect(user).toContain('"주소":"https://app.test/projects/WP/issues/10"')
    expect(user).toContain('"AI_테스터_발견":90')
    expect(user).toContain('"에픽_완료":true')
    expect(user).not.toContain('\n "프로젝트별_끝낸_일"')
    // 사람이 쓴 제목의 꺾쇠는 전각으로 — <data> 표지를 닫거나 태그를 끼우지 못한다.
    expect(user).toContain('색인 ＜script＞')
    expect(user).not.toContain('<script>')
    expect(user).toContain('상세 이슈 목록(2건):')
  })

  it('systemPrompt_workTableRules_onlyWithDataAndTemplateTable', async () => {
    const { system } = await runWith(weekly({ doneByProject: DONE_BY_PROJECT, ...WITH_TABLE }))
    expect(system).toContain(TABLE_RULE)
    expect(system).toContain('시스템이 그 칸을 다시 쓴다')
    // 건수 출처 규칙은 한 번만 싣는다.
    expect(system.split('끝낸 일 건수는').length - 1).toBe(1)
    expect(system).toContain('「프로젝트별_끝낸_일」 값만 쓴다')
    expect(system).toContain('결함 수정 약 N건 — AI 테스터가 찾은 결함 위주')
    expect(system).toContain('상세 이슈 목록에 담지 못한 이슈의 건수')
    expect(system).not.toContain('목록 밖 이슈가 있다는 사실은 참고로만 쓴다')

    // 1단계 템플릿(표 없음 — workTableInTemplate false·구 API 는 없음) — 건수 규칙은 싣되 표 규칙은 싣지 않는다.
    for (const flag of [{ workTableInTemplate: false }, {}]) {
      vi.clearAllMocks()
      const old = await runWith(weekly({ doneByProject: DONE_BY_PROJECT, templateMarkdown: '## 이번 주 한 일\n샘플\n', ...flag }))
      expect(old.system).toContain('「프로젝트별_끝낸_일」 값만 쓴다')
      expect(old.system).not.toContain(TABLE_RULE)
    }
  })

  it('systemPrompt_monthly_workTableInMonthSection', async () => {
    const { system } = await runWith(
      weekly({ kind: 'MONTHLY', kindLabel: '월간', doneByProject: DONE_BY_PROJECT, ...WITH_TABLE }),
    )
    expect(system).toContain(TABLE_RULE)
    expect(system).toContain('「이번 주 한 일」 → 「이번 달 한 일」')
  })

  it('noDoneByProject_noRulesNoDataBlock', async () => {
    for (const input of [weekly(WITH_TABLE), weekly({ doneByProject: [], ...WITH_TABLE })]) {
      vi.clearAllMocks()
      const { system, user } = await runWith(input)
      expect(user).not.toContain('<data>')
      expect(user).toContain('이슈 목록(2건):')
      expect(user).not.toContain('상세 이슈 목록')
      expect(system).not.toContain('프로젝트별_끝낸_일')
      expect(system).not.toContain(TABLE_RULE)
      expect(system).toContain('목록 밖 이슈가 있다는 사실은 참고로만 쓴다')
    }
  })

  it('schema_newFieldsOptional_oldPayloadPasses_unknownKindAccepted', () => {
    expect(personalReportInputSchema.safeParse(daily()).success).toBe(true)
    expect(personalReportInputSchema.safeParse(daily({ completedSplit: null })).success).toBe(true)
    const input = withFirstIssue({ assigneesDetail: [{ name: '봇', kind: 'SERVICE' }] })
    expect(personalReportInputSchema.safeParse(input).success).toBe(true)
    expect(
      personalReportInputSchema.safeParse(daily({ completedSplit: { completed: 1, withAi: 'x', direct: 0 } })).success,
    ).toBe(false)
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
