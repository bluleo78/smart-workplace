// 이슈 상세 상태 아래 완료·취소 줄과 보드 카드 완료일(WP-873) — 페이지 테스트(WP-980).
// 문구·늦음 일수·조건부 표시는 브라우저 없이 판정되므로 e2e/pages/projects/issue-closed-date.spec.ts 에서 옮겼다.
// 타임존은 vitest 설정(TZ=Asia/Seoul)으로, 현재 시각은 Date 만 가짜 시계로 고정한다(2026-10-23 서울 15:00, 금요일).
// 모바일 폭(칩 줄·목록 메타·모바일 보드 탭)은 issueClosedDateMobile.test.tsx 가 본다.
// 화면 테스트(WP-1002) — 이슈 상세·보드는 그 화면만 renderScreen 으로 띄운다(App·앱 셸 없이). 완료 줄이 레일에 한 번만 보이는지까지 보려 상세는 화면 단위다.
import { screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { openIssueDetailScreen } from '@/test/kits/projects/issueDetailScreen'
import { renderProjectScreen } from '@/test/kits/projects/projectDetailScreen'
import { SCREEN_LOAD_TIMEOUT } from '@/test/kits/projects/routeScreen'
import type { IssueResponse } from '@/types/issue'

import { createIssue, createIssueDetail, createIssueSearchResponse } from '../../../e2e/factories/issue.factory'
import { systemTypes } from '../../../e2e/factories/issueType.factory'
import { createProject } from '../../../e2e/factories/project.factory'

const KEY = 'PROJ'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-23T06:00:00Z'))
})
afterEach(() => vi.useRealTimers())

const DONE_LATE = { status: 'DONE', statusId: 3, statusName: '완료', closedAt: '2026-10-23T05:05:00Z', dueDate: '2026-10-21' } as const

/** 이 요약으로 이슈 상세를 연다. */
function openDetail(overrides: Partial<IssueResponse>) {
  return openIssueDetailScreen({ key: KEY, detail: createIssueDetail({ summary: { ...createIssue({ projectKey: KEY }), ...overrides } }) })
}

describe('이슈 상세 — 상태 아래 완료 줄', () => {
  // 완료 시각(로컬)·요일·오전/오후 표기와 마감 대비 늦은 일수 — 포매터와 화면 배선을 함께 지킨다.
  test('완료 이슈는 완료 시각과 마감 대비 늦은 일수를 보인다', async () => {
    await openDetail(DONE_LATE)
    const line = await screen.findByTestId('issue-closed-line')
    expect(screen.getAllByTestId('issue-closed-line')).toHaveLength(1)
    expect(line).toHaveTextContent('✓ 10월 23일 (금) 오후 2:05 완료')
    expect(line).toHaveAttribute('title', '2026-10-23 14:05')
    expect(within(line).getByTestId('issue-closed-late')).toHaveTextContent('마감 +2일')
  })

  test('마감 안에 끝난 완료 이슈에는 늦음 표시가 없다', async () => {
    await openDetail({ ...DONE_LATE, dueDate: '2026-10-23' })
    expect(await screen.findByTestId('issue-closed-line')).toHaveTextContent('✓ 10월 23일 (금) 오후 2:05 완료')
    expect(screen.queryByTestId('issue-closed-late')).not.toBeInTheDocument()
  })

  test('취소 이슈는 「취소」 문구를 보이고 늦음은 없다', async () => {
    await openDetail({ ...DONE_LATE, status: 'CANCELED', statusId: 4, statusName: '취소' })
    expect(await screen.findByTestId('issue-closed-line')).toHaveTextContent('⊘ 10월 23일 (금) 오후 2:05 취소')
    expect(screen.queryByTestId('issue-closed-late')).not.toBeInTheDocument()
  })

  test('진행 중 이슈에는 완료 줄이 없다', async () => {
    await openDetail({ status: 'IN_PROGRESS', statusId: 2, statusName: '진행 중', closedAt: null })
    expect(await screen.findByTestId('property-rail')).toBeInTheDocument()
    expect(screen.queryByTestId('issue-closed-line')).not.toBeInTheDocument()
  })

  // 롤링 배포 중 구버전 응답 — 종료 상태라도 시각이 없으면 지어내지 않는다.
  test('종료 상태인데 closedAt 이 없으면(구버전 응답) 줄을 생략한다', async () => {
    await openDetail({ ...DONE_LATE, closedAt: null })
    expect(await screen.findByTestId('property-rail')).toBeInTheDocument()
    expect(screen.queryByTestId('issue-closed-line')).not.toBeInTheDocument()
  })
})

const BOARD_ISSUES = [
  // DONE 늦음 — 마감 10/21, 종료 10/23(서울) → +2일
  createIssue({ id: 1, number: 1, title: '늦게 끝남', ...DONE_LATE }),
  // DONE 인데 closedAt 없음(구버전 응답) → 기존 마감 표기
  createIssue({ id: 2, number: 2, title: '종료 시각 없음', status: 'DONE', closedAt: null, dueDate: '2026-10-21' }),
  // CANCELED — 늦음 없음
  createIssue({ id: 3, number: 3, title: '취소됨', status: 'CANCELED', closedAt: '2026-10-18T03:00:00Z', dueDate: '2026-10-10' }),
]

/** 보드·목록 화면 API — 보드 컬럼 쿼리(statusId)는 서버처럼 그 상태만 돌려준다. */
function boardHandlers(issues: IssueResponse[] = BOARD_ISSUES) {
  return [
    http.get(`/api/v1/projects/${KEY}`, () => HttpResponse.json(createProject({ key: KEY }))),
    http.get(`/api/v1/projects/${KEY}/types`, () => HttpResponse.json(systemTypes())),
    http.get(`/api/v1/projects/${KEY}/issues`, ({ request }) => {
      const statusId = new URL(request.url).searchParams.get('statusId')
      return HttpResponse.json(createIssueSearchResponse(statusId ? issues.filter((i) => String(i.statusId) === statusId) : issues))
    }),
  ]
}

describe('보드 카드 — 종료 이슈는 완료일', () => {
  test('완료는 「✓ 날짜」+늦음, 취소는 「⊘ 날짜」, closedAt 없으면 마감 그대로', async () => {
    renderProjectScreen(`/projects/${KEY}?view=board`, { handlers: boardHandlers() })
    const doneClosed = await screen.findByTestId('issue-card-1-closed', {}, { timeout: SCREEN_LOAD_TIMEOUT })
    expect(doneClosed).toHaveTextContent('✓ 10월 23일')
    expect(doneClosed).toHaveTextContent('+2일')
    // 스크린리더용 구분어(sr-only) — 「10월 23일 +2일」 이 붙어 읽히지 않는다.
    expect(doneClosed).toHaveTextContent('10월 23일, 마감 +2일')
    expect(screen.getByTestId('issue-card-1-closed-late')).toHaveClass('text-warning-text')
    expect(screen.queryByTestId('issue-card-1-due')).not.toBeInTheDocument()

    // closedAt 이 null 인 종료 카드 — 기존 마감 표기(~마감일)로 폴백.
    expect(await screen.findByTestId('issue-card-2-due')).toHaveTextContent('~2026-10-21')
    expect(screen.queryByTestId('issue-card-2-closed')).not.toBeInTheDocument()

    expect(await screen.findByTestId('issue-card-3-closed')).toHaveTextContent(/^⊘ 10월 18일$/)
    expect(screen.queryByTestId('issue-card-3-due')).not.toBeInTheDocument()
  })
})
