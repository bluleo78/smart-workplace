// 타임라인 화면 — 페이지 테스트(WP-971, WP-980).
// 진입 이동·일정 미정 배치 payload·줌 토글·필터(아바타 스택·facet → URL·검색 쿼리)·상태 목록 관문(로딩·실패·다시 시도)은
// 브라우저 없이 판정되므로 e2e/pages/projects/timeline.spec.ts·timeline-avatar-filter.spec.ts 에서 옮겼다.
// 간트 막대 기하·끌기·스크롤·오늘선 위치는 E2E(@layout·@input)에 남는다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { API, cycle, KEY, milestone, stubCanvas, timelineApi } from '@/test/kits/projects/timeline'
import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'

import { createIssue } from '../../../e2e/factories/issue.factory'
import { createMember } from '../../../e2e/factories/project.factory'
import { inServerOrder, withCustomStatuses } from '../../../e2e/factories/projectStatus.factory'

stubCanvas()

const MEMBERS = [
  createMember({ userId: 2, name: '김개발', username: 'kim@example.com' }),
  createMember({ userId: 3, name: '이테스트', username: 'lee@example.com', role: 'MEMBER' }),
]
const ISSUES = [
  createIssue({ number: 1, title: '기간 이슈', startDate: '2026-07-01', dueDate: '2026-07-05' }),
  createIssue({ number: 2, title: '마감일만 이슈', dueDate: '2026-07-10' }),
]
/** E2E setupTimelineStubs 와 같은 기본 화면 — 활성 사이클 1개·마일스톤 1개·멤버 2명. */
function defaultApi(over: Parameters<typeof timelineApi>[0] = {}) {
  return timelineApi({ issues: ISSUES, members: MEMBERS, cycles: [cycle({})], milestones: [milestone({})], ...over })
}

/** 간트가 그려질 때까지 기다린다. */
async function openTimeline(path = `/projects/${KEY}/timeline`, api = defaultApi(), extra: Parameters<typeof renderPage>[1] = {}) {
  const view = renderPage(path, { ...extra, handlers: [...(extra.handlers ?? []), ...api.handlers] })
  await screen.findByTestId('timeline-gantt', {}, { timeout: PAGE_LOAD_TIMEOUT })
  return { ...view, api }
}

/** 켜진 토글 모양(TOGGLE_ON) — aria-pressed 와 primary 테두리·글자·배경 클래스를 함께 본다(E2E expectToggle 과 같은 기준). */
function expectToggle(el: HTMLElement, on: boolean) {
  expect(el).toHaveAttribute('aria-pressed', String(on))
  for (const cls of ['text-primary', 'border-primary/50', 'bg-primary/10']) {
    if (on) expect(el).toHaveClass(cls)
    else expect(el).not.toHaveClass(cls)
  }
}

describe('타임라인 — 진입·줌', () => {
  // 프로젝트 홈 헤더의 「타임라인」 링크가 타임라인 라우트로 이어지는지.
  test('프로젝트 홈 헤더의 타임라인 링크로 들어간다', async () => {
    const api = defaultApi()
    const { user, location } = renderPage(`/projects/${KEY}`, {
      handlers: [...api.handlers, http.get(`${API}/views`, () => HttpResponse.json([]))],
    })
    await user.click(await screen.findByRole('link', { name: '타임라인' }, { timeout: PAGE_LOAD_TIMEOUT }))
    expect(await screen.findByTestId('timeline-page', {}, { timeout: PAGE_LOAD_TIMEOUT })).toBeInTheDocument()
    expect(location()).toMatch(new RegExp(`^/projects/${KEY}/timeline`))
  })

  // 줌 버튼은 켜진 것 하나만 TOGGLE_ON(WP-368) — 기본 「주」, 「월」을 누르면 표시가 옮겨 간다.
  test('주/월 줌 토글 — 켜진 버튼만 눌림 표시', async () => {
    const { user } = await openTimeline()
    const week = screen.getByRole('button', { name: '주' })
    const month = screen.getByRole('button', { name: '월' })
    expectToggle(week, true)
    expectToggle(month, false)
    await user.click(month)
    expectToggle(month, true)
    expectToggle(week, false)
  })
})

describe('타임라인 — 일정 미정 섹션', () => {
  // 마감일 없는 이슈는 접힌 「일정 미정」에 모이고, 배치하면 오늘~+7일(시작일이 있으면 마감만 시작일+7일)을 PATCH 한다(WP-483).
  test('접이식 목록 — 배치하면 7일 기간을, 시작일만 있으면 마감일만 보낸다', async () => {
    const patches: { n: string; body: unknown }[] = []
    const api = defaultApi({
      issues: [
        ISSUES[0],
        createIssue({ number: 5, title: '미정 이슈A' }),
        createIssue({ number: 6, title: '미정 이슈B', startDate: '2026-07-20' }),
      ],
    })
    const { user } = await openTimeline(`/projects/${KEY}/timeline`, api, {
      handlers: [
        http.patch(`${API}/issues/:n`, async ({ request, params }) => {
          patches.push({ n: String(params.n), body: await request.json() })
          return HttpResponse.json(createIssue({ number: Number(params.n) }))
        }),
      ],
    })
    const section = screen.getByTestId('unscheduled-section')
    expect(within(section).getByText('일정 미정 (2)')).toBeInTheDocument()
    // 접힘 — 행이 보이지 않는다.
    expect(screen.getByTestId('unscheduled-row-5')).not.toBeVisible()
    await user.click(section.querySelector('summary')!)
    expect(screen.getByTestId('unscheduled-row-5')).toBeVisible()
    expect(screen.getByTestId('unscheduled-row-6')).toBeVisible()

    await user.click(screen.getByTestId('unscheduled-schedule-5'))
    await waitFor(() => expect(patches).toHaveLength(1))
    const body = patches[0].body as { startDate: string; dueDate: string }
    expect(patches[0].n).toBe('5')
    expect(body.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect((new Date(body.dueDate).getTime() - new Date(body.startDate).getTime()) / 86_400_000).toBe(7)

    await user.click(screen.getByTestId('unscheduled-schedule-6'))
    await waitFor(() => expect(patches[1]).toEqual({ n: '6', body: { dueDate: '2026-07-27' } }))
  })
})

describe('타임라인 — 필터', () => {
  // 담당자는 아바타 스택으로 대체돼 facet 목록에 없고(#647), 라벨·마일스톤은 facet 으로 남는다(#638).
  test('담당자는 아바타 스택, 라벨·마일스톤은 facet', async () => {
    const { user } = await openTimeline()
    expect(await screen.findByTestId('assignee-avatar-2')).toBeInTheDocument()
    await user.click(screen.getByTestId('add-filter-trigger'))
    expect(await screen.findByTestId('add-filter-facet-label')).toBeInTheDocument()
    expect(screen.getByTestId('add-filter-facet-milestone')).toBeInTheDocument()
    expect(screen.queryByTestId('add-filter-facet-assignee')).not.toBeInTheDocument()
  })

  // 마일스톤 facet 값을 고르면 URL milestone= 으로 직렬화된다(#638).
  test('마일스톤 facet 선택이 URL 에 반영된다', async () => {
    const { user, location } = await openTimeline()
    await user.click(screen.getByTestId('add-filter-trigger'))
    await user.click(await screen.findByTestId('add-filter-facet-milestone'))
    const option = await screen.findByTestId('facet-value-milestone-1')
    expect(option).toHaveTextContent('v1 출시')
    await user.click(option)
    await waitFor(() => expect(location()).toMatch(/milestone=1/))
  })

  // 아바타 스택은 최대 5명 + 나머지는 +N(#647).
  test('아바타 스택 — 5명까지 보이고 나머지는 +N', async () => {
    const six = ['김개발', '이테스트', '박세번', '최네번', '정다섯', '한여섯'].map((name, i) =>
      createMember({ userId: i + 2, name, username: `u${i + 2}@example.com`, role: i === 0 ? 'OWNER' : 'MEMBER' }),
    )
    await openTimeline(`/projects/${KEY}/timeline?period=all`, defaultApi({ members: six }))
    const stack = await screen.findByTestId('assignee-avatar-stack')
    const avatars = [...stack.querySelectorAll('[data-testid^="assignee-avatar-"]')].filter(
      (el) => el.getAttribute('data-testid') !== 'assignee-avatar-overflow',
    )
    expect(avatars).toHaveLength(5)
    expect(screen.getByTestId('assignee-avatar-overflow')).toHaveTextContent('+1')
  })

  // 아바타 클릭 = 담당자 토글 — URL assignee 와 이슈 검색 쿼리에 실리고, 다시 누르면 풀린다.
  test('아바타 클릭은 담당자 필터를 토글해 URL·검색 쿼리에 싣는다', async () => {
    const six = ['김개발', '이테스트', '박세번', '최네번', '정다섯', '한여섯'].map((name, i) =>
      createMember({ userId: i + 2, name, username: `u${i + 2}@example.com` }),
    )
    const api = defaultApi({ members: six })
    const { user, location } = await openTimeline(`/projects/${KEY}/timeline?period=all`, api)
    await user.click(await screen.findByTestId('assignee-avatar-2'))
    await waitFor(() => expect(location()).toMatch(/assignee/))
    await waitFor(() => expect(api.searches.some((u) => /assignee[^&]*=2/.test(decodeURIComponent(u.search)))).toBe(true))
    expect(screen.getByTestId('assignee-avatar-2')).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByTestId('assignee-avatar-2'))
    await waitFor(() => expect(screen.getByTestId('assignee-avatar-2')).toHaveAttribute('aria-pressed', 'false'))
    expect(location()).not.toMatch(/assignee/)
  })

  // +N 팝오버의 나머지 멤버도 같은 필터로 토글된다.
  test('+N 팝오버에서 나머지 멤버를 고른다', async () => {
    const six = ['김개발', '이테스트', '박세번', '최네번', '정다섯', '한여섯'].map((name, i) =>
      createMember({ userId: i + 2, name, username: `u${i + 2}@example.com` }),
    )
    const { user, location } = await openTimeline(`/projects/${KEY}/timeline?period=all`, defaultApi({ members: six }))
    await user.click(await screen.findByTestId('assignee-avatar-overflow'))
    await user.click(await screen.findByRole('button', { name: /한여섯/ }))
    await waitFor(() => expect(location()).toMatch(/assignee[^&]*=7/))
  })
})

describe('타임라인 — 상태 목록 관문 (WP-938)', () => {
  // 상태 목록을 받기 전엔 본문(간트·필터 바)을 그리지 않고, 받은 뒤 「상태」 facet 이 프로젝트 상태 이름으로 채워진다.
  test('받기 전엔 로딩만, 받은 뒤 간트와 프로젝트 상태 facet', async () => {
    let release!: () => void
    const held = new Promise<void>((r) => (release = r))
    const api = defaultApi()
    const { user } = renderPage(`/projects/${KEY}/timeline`, {
      handlers: [
        http.get(`${API}/statuses`, async () => {
          await held
          return HttpResponse.json(inServerOrder(withCustomStatuses('설계')))
        }),
        ...api.handlers,
      ],
    })
    expect(await screen.findByRole('heading', { name: '타임라인' }, { timeout: PAGE_LOAD_TIMEOUT })).toBeInTheDocument()
    expect(await screen.findByText('로딩 중…')).toBeInTheDocument()
    expect(screen.queryByTestId('add-filter-trigger')).not.toBeInTheDocument()
    expect(screen.queryByTestId('timeline-gantt')).not.toBeInTheDocument()

    release()
    expect(await screen.findByTestId('timeline-gantt')).toBeInTheDocument()
    await user.click(screen.getByTestId('add-filter-trigger'))
    await user.click(await screen.findByTestId('add-filter-facet-statusId'))
    await waitFor(() =>
      expect([...document.querySelectorAll('[data-testid^="facet-value-statusId-"]')].map((e) => e.textContent?.trim())).toEqual([
        '할 일',
        '진행 중',
        '설계',
        '완료',
        '취소',
      ]),
    )
  })

  // 상태 목록이 실패하면 다시 시도를 보이고, 성공하면 간트가 그려진다.
  test('상태 목록 실패 → 다시 시도 → 간트', async () => {
    let fail = true
    const api = defaultApi()
    const { user } = renderPage(`/projects/${KEY}/timeline`, {
      handlers: [
        http.get(`${API}/statuses`, () =>
          fail ? HttpResponse.json({ status: 500, message: '서버 오류' }, { status: 500 }) : HttpResponse.json(inServerOrder(withCustomStatuses())),
        ),
        ...api.handlers,
      ],
    })
    const error = await screen.findByTestId('project-statuses-error', {}, { timeout: PAGE_LOAD_TIMEOUT })
    expect(error).toHaveTextContent('상태 목록을 불러오지 못했습니다')
    expect(error).toHaveTextContent('타임라인을 그릴 수 없습니다')
    expect(screen.queryByTestId('timeline-gantt')).not.toBeInTheDocument()
    fail = false
    await user.click(within(error).getByRole('button', { name: '다시 시도' }))
    expect(await screen.findByTestId('timeline-gantt')).toBeInTheDocument()
    expect(screen.queryByTestId('project-statuses-error')).not.toBeInTheDocument()
  })
})
