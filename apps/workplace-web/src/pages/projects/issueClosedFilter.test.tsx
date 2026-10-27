// 이슈 목록 「＋ 필터 › 완료일」 기간 필터(WP-873) — 페이지 테스트(WP-971).
// 프리셋 선택(단일)·교체·해제, 「기간 직접 지정」 달력 적용, 칩 표기가 URL(closedIn)·검색 요청(closedFrom/closedTo)·칩 문구로
// 어긋남 없이 이어지는지는 브라우저 없이 판정되므로 e2e/pages/projects/issue-closed-filter.spec.ts 에서 옮겼다.
// 달력이 팝오버 안에 다 들어가는지와 필터 줄 배치(「초기화」 위치)는 기하라 E2E(@layout)에 남는다.
// 현재 시각은 2026-10-23(금) 15:00 KST 로 고정(TZ 는 vitest.config 가 Asia/Seoul) — 「지난 주」는 10/12(월)~10/18(일).
// 화면 테스트(WP-1002) — 필터 바·목록/보드·툴바가 한 화면의 URL 상태를 나눠 써 프로젝트 상세 화면만 renderProjectScreen 으로 띄운다(App·앱 셸 없이).
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { renderProjectScreen } from '@/test/kits/projects/projectDetailScreen'
import { SCREEN_LOAD_TIMEOUT } from '@/test/kits/projects/routeScreen'

import { createIssue, createIssueSearchResponse } from '../../../e2e/factories/issue.factory'
import { createProject } from '../../../e2e/factories/project.factory'

const KEY = 'WP'

beforeEach(() => {
  // Date 만 고정한다 — 타이머까지 멈추면 화면의 비동기 렌더·MSW 응답이 진행되지 않는다.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-23T06:00:00Z'))
})
afterEach(() => {
  vi.useRealTimers()
})

/** 목록을 연다 — 검색 요청 URL 을 searches 에 모은다. */
async function open(query = '') {
  const searches: URL[] = []
  const view = renderProjectScreen(`/projects/${KEY}${query ? `?${query}` : ''}`, {
    handlers: [
      http.get(`/api/v1/projects/${KEY}`, () => HttpResponse.json(createProject())),
      http.get(`/api/v1/projects/${KEY}/views`, () => HttpResponse.json([])),
      http.get(`/api/v1/projects/${KEY}/issues`, ({ request }) => {
        searches.push(new URL(request.url))
        return HttpResponse.json(createIssueSearchResponse([createIssue({ number: 7 })], null))
      }),
    ],
  })
  await screen.findByTestId('issue-row-7', {}, { timeout: SCREEN_LOAD_TIMEOUT })
  const last = () => searches.at(-1)!
  /** 주소의 closedIn 값(디코딩). */
  const closedIn = () => new URLSearchParams(view.location().split('?')[1] ?? '').get('closedIn')
  return { ...view, searches, last, closedIn }
}

type User = ReturnType<typeof renderProjectScreen>['user']

/** 「＋ 필터 › 완료일」 까지 연다. */
async function openClosedFacet(user: User) {
  await user.click(screen.getByTestId('add-filter-trigger'))
  await user.click(await screen.findByTestId('add-filter-facet-closedIn'))
}

/** 열린 칩 편집 팝오버 — 칩의 첫 버튼(값 편집)을 누른다. */
async function openChip(user: User) {
  await user.click(within(screen.getByTestId('filter-chip-closedIn')).getAllByRole('button')[0])
}

describe('이슈 목록 — 완료일 기간 필터', () => {
  test('「지난 주」 선택 → URL·요청·칩에 반영, 다른 프리셋은 대체, 같은 프리셋을 다시 누르면 해제', async () => {
    const { user, last, closedIn } = await open()
    await openClosedFacet(user)
    // 프리셋 라벨에 날짜 범위가 함께 보인다.
    const lastWeek = await screen.findByTestId('facet-value-closedIn-last-week')
    expect(lastWeek).toHaveTextContent('지난 주 (10/12–10/18)')
    await user.click(lastWeek)

    await waitFor(() => expect(closedIn()).toBe('last-week'))
    expect(await screen.findByTestId('filter-chip-closedIn')).toHaveTextContent(/^완료일:지난 주 \(10\/12–10\/18\)$/)
    await waitFor(() => expect(last().searchParams.get('closedFrom')).toBe('2026-10-12'))
    expect(last().searchParams.get('closedTo')).toBe('2026-10-18')
    // 완료일 범위를 걸면 종료 이슈 숨김은 풀린다.
    expect(last().searchParams.has('hideInactiveClosed')).toBe(false)

    // 단일 선택 — 다른 프리셋을 고르면 대체된다(값은 1개, 이전 체크 해제).
    await user.click(screen.getByTestId('facet-value-closedIn-this-month'))
    await waitFor(() => expect(closedIn()).toBe('this-month'))
    expect(screen.getByTestId('filter-chip-closedIn')).toHaveTextContent(/^완료일:이번 달 \(10\/1–10\/23\)$/)
    expect(within(screen.getByTestId('facet-value-closedIn-last-week')).getByRole('checkbox')).not.toBeChecked()
    expect(within(screen.getByTestId('facet-value-closedIn-this-month')).getByRole('checkbox')).toBeChecked()
    await waitFor(() => expect(last().searchParams.get('closedFrom')).toBe('2026-10-01'))

    // 같은 프리셋을 다시 누르면 해제.
    await user.click(screen.getByTestId('facet-value-closedIn-this-month'))
    await waitFor(() => expect(screen.queryByTestId('filter-chip-closedIn')).not.toBeInTheDocument())
    expect(closedIn()).toBeNull()
  })

  test('칩 ✕ 로 해제하면 URL·요청에서 완료일 범위가 사라진다', async () => {
    const { user, last, closedIn } = await open('closedIn=today')
    await waitFor(() => expect(last().searchParams.get('closedFrom')).toBe('2026-10-23'))
    expect(screen.getByTestId('filter-chip-closedIn')).toHaveTextContent(/^완료일:오늘 \(10\/23\)$/)
    await user.click(screen.getByTestId('filter-chip-closedIn-remove'))
    await waitFor(() => expect(screen.queryByTestId('filter-chip-closedIn')).not.toBeInTheDocument())
    expect(closedIn()).toBeNull()
    await waitFor(() => expect(last().searchParams.has('closedFrom')).toBe(false))
    expect(last().searchParams.has('closedTo')).toBe(false)
  })

  test('「기간 직접 지정」 — 달력에서 10/1~10/10 을 골라 적용', async () => {
    const { user, last, closedIn } = await open()
    await openClosedFacet(user)
    await user.click(await screen.findByTestId('closed-range-open'))
    // 달력으로 바뀌고 아직 고른 날이 없으면 「적용」은 잠겨 있다.
    const panel = await screen.findByTestId('date-range-panel')
    expect(screen.getByTestId('date-range-apply')).toBeDisabled()
    // 달력을 펼치면 프리셋 목록은 접힌다(팝오버가 화면 높이를 넘지 않게).
    expect(screen.queryByTestId('facet-value-closedIn-last-week')).not.toBeInTheDocument()

    await user.click(within(panel).getByRole('button', { name: /2026년 10월 1일/ }))
    await user.click(within(panel).getByRole('button', { name: /2026년 10월 10일/ }))
    expect(screen.getByTestId('date-range-summary')).toHaveTextContent(/^10\/1–10\/10$/)
    await user.click(screen.getByTestId('date-range-apply'))

    await waitFor(() => expect(closedIn()).toBe('2026-10-01~2026-10-10'))
    expect(await screen.findByTestId('filter-chip-closedIn')).toHaveTextContent(/^완료일:10\/1–10\/10$/)
    await waitFor(() => expect(last().searchParams.get('closedFrom')).toBe('2026-10-01'))
    expect(last().searchParams.get('closedTo')).toBe('2026-10-10')
    expect(last().searchParams.has('hideInactiveClosed')).toBe(false)
  })

  test('「기간 직접 지정」 — 취소하면 프리셋 목록으로 돌아온다', async () => {
    const { user } = await open()
    await openClosedFacet(user)
    await user.click(await screen.findByTestId('closed-range-open'))
    await user.click(await screen.findByTestId('date-range-cancel'))
    expect(await screen.findByTestId('facet-value-closedIn-last-week')).toBeInTheDocument()
    expect(screen.queryByTestId('date-range-panel')).not.toBeInTheDocument()
  })

  test('「기간 직접 지정」 — 하루만 고르면 요약·칩에 날짜가 한 번만 보인다', async () => {
    const { user, last, closedIn } = await open()
    await openClosedFacet(user)
    await user.click(await screen.findByTestId('closed-range-open'))
    const panel = await screen.findByTestId('date-range-panel')
    await user.click(within(panel).getByRole('button', { name: /2026년 10월 5일/ }))
    // 끝 날짜를 안 고르면 하루짜리 범위 — 「10/5–10/5」 가 아니라 「10/5」.
    expect(screen.getByTestId('date-range-summary')).toHaveTextContent(/^10\/5$/)
    await user.click(screen.getByTestId('date-range-apply'))

    await waitFor(() => expect(closedIn()).toBe('2026-10-05~2026-10-05'))
    expect(await screen.findByTestId('filter-chip-closedIn')).toHaveTextContent(/^완료일:10\/5$/)
    await waitFor(() => expect(last().searchParams.get('closedTo')).toBe('2026-10-05'))
  })

  test('「기간 직접 지정」 패널 요약이 칩과 같은 표기(연도 포함)를 쓴다', async () => {
    // 지난해에 걸친 범위 — 칩은 「2025/12/29–1/4」. 같은 범위로 패널을 열면 요약도 같아야 한다.
    const { user } = await open('closedIn=2025-12-29~2026-01-04')
    expect(screen.getByTestId('filter-chip-closedIn')).toHaveTextContent(/^완료일:2025\/12\/29–1\/4$/)
    await openChip(user)
    await user.click(await screen.findByTestId('closed-range-open'))
    expect(await screen.findByTestId('date-range-summary')).toHaveTextContent(/^2025\/12\/29–1\/4$/)
  })

  test('직접 지정으로 만든 칩을 열어 프리셋으로 바꾸면 대체된다', async () => {
    const { user, closedIn } = await open('closedIn=2026-10-01~2026-10-10')
    expect(screen.getByTestId('filter-chip-closedIn')).toHaveTextContent(/^완료일:10\/1–10\/10$/)
    await openChip(user)
    await user.click(await screen.findByTestId('facet-value-closedIn-last-month'))
    await waitFor(() => expect(closedIn()).toBe('last-month'))
    expect(screen.getByTestId('filter-chip-closedIn')).toHaveTextContent(/^완료일:지난 달 \(9\/1–9\/30\)$/)
  })
})
