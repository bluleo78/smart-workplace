// 사이클 관리·피커·필터 — 페이지 테스트(WP-971).
// 진행바 색 칸·집계 문구, 헤더의 프로젝트 복귀, 생성(입력 상한)·종료일 역전 차단·수정·삭제 payload,
// 이슈 상세 사이클 피커 PUT(완료 사이클 규칙 WP-659), 목록 사이클 필터 → 요청 cycle=1 은 브라우저 없이 판정되므로
// e2e/pages/projects/cycles.spec.ts 에서 옮겼다. 그 spec 에는 사이클 화면 배선 1건(@wiring)과 실제 오프라인 저장(@platform)이 남는다.
// 화면 테스트(WP-1002) — 사이클 화면(CyclesPage)·이슈 상세의 사이클 피커(CyclePickerPopover)는 그것만, 목록 필터는 필터 바와 목록 검색이
// 한 화면에서 이어져 프로젝트 상세 화면만 renderScreen 으로 띄운다(App·앱 셸 없이).
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { CyclePickerPopover } from '@/components/cycle/CyclePickerPopover'
import { renderProjectScreen } from '@/test/kits/projects/projectDetailScreen'
import { renderRouteScreen, SCREEN_LOAD_TIMEOUT } from '@/test/kits/projects/routeScreen'
import { server } from '@/test/msw/server'
import { renderScreen } from '@/test/renderScreen'
import type { CycleProgress, CycleResponse, CycleSummary } from '@/types/cycle'

import { createIssueSearchResponse } from '../../../e2e/factories/issue.factory'
import { createMember, createProject } from '../../../e2e/factories/project.factory'
import CyclesPage from './CyclesPage'

const KEY = 'WP'
const CYCLES = `/api/v1/projects/${KEY}/cycles`
const ISSUE = `/api/v1/projects/${KEY}/issues/1`

/** 사이클 팩토리. */
function createCycle(overrides: Partial<CycleResponse> = {}): CycleResponse {
  return {
    id: 1, projectId: 1, name: '스프린트 1', goal: null, startDate: null, endDate: null, status: 'ACTIVE',
    createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', ...overrides,
  }
}

/** 사이클 화면 — cycles 는 매 GET 마다 읽는다(쓰기 핸들러가 바꾸면 재조회에 반영). */
async function openCycles(cycles: { current: CycleResponse[] }, progress: CycleProgress[] = []) {
  const view = renderRouteScreen('/projects/:key/cycles', <CyclesPage />, `/projects/${KEY}/cycles`, {
    handlers: [
      http.get(`/api/v1/projects/${KEY}`, () => HttpResponse.json(createProject())),
      http.get(CYCLES, () => HttpResponse.json(cycles.current)),
      http.get(`${CYCLES}/progress`, () => HttpResponse.json(progress)),
      // 새 사이클·수정·삭제는 프로젝트 OWNER 만 보인다(WP-1008) — 로그인 사용자(id 1)를 OWNER 로 둔다.
      http.get(`/api/v1/projects/${KEY}/members`, () => HttpResponse.json([createMember({ userId: 1, role: 'OWNER' })])),
    ],
  })
  await screen.findByTestId('page-header', {}, { timeout: SCREEN_LOAD_TIMEOUT })
  if (cycles.current.length) await screen.findByTestId(`cycle-row-${cycles.current[0].id}`)
  else await screen.findByText('아직 사이클이 없습니다.')
  return view
}

describe('사이클 관리', () => {
  test('진행 중 1건뿐이면 강조색·회색 칸 없이 0/1 완료(0%) — 색과 완료율이 어긋나지 않는다 (#771·WP-921)', async () => {
    await openCycles({ current: [createCycle()] }, [{ cycleId: 1, total: 1, done: 0, byStatus: { IN_PROGRESS: 1 } }])
    const bar = screen.getByTestId('cycle-progress-1')
    expect(bar).toHaveTextContent('0/1 완료 (0%)')
    for (const cls of ['bg-primary', 'bg-destructive', 'bg-success', 'bg-muted-foreground']) {
      expect(bar.querySelectorAll(`[class*="${cls}"]`)).toHaveLength(0)
    }
    expect(bar.querySelectorAll('.bg-muted > *')).toHaveLength(0)
  })

  test('취소도 완료로 집계 — DONE 1·CANCELED 1 이면 2/2 완료(100%), 두 칸 모두 완료색 (WP-243)', async () => {
    await openCycles({ current: [createCycle()] }, [{ cycleId: 1, total: 2, done: 2, byStatus: { DONE: 1, CANCELED: 1 } }])
    const bar = screen.getByTestId('cycle-progress-1')
    expect(bar).toHaveTextContent('2/2 완료 (100%)')
    expect(bar.querySelectorAll('[class*="bg-success"]')).toHaveLength(2)
  })

  test('헤더에 프로젝트 키가 보이고 「프로젝트로 돌아가기」는 프로젝트 목록 화면으로 간다 (#667)', async () => {
    const { user, location } = await openCycles({ current: [] })
    const header = screen.getByTestId('page-header')
    expect(header).toHaveTextContent(KEY)
    // 돌아간 화면은 그리지 않는다(사이클 화면만 띄웠다) — 이동 주소만 본다.
    await user.click(within(header).getByRole('button', { name: '프로젝트로 돌아가기' }))
    await waitFor(() => expect(location()).toBe(`/projects/${KEY}`), { timeout: SCREEN_LOAD_TIMEOUT })
  })

  test('새 사이클 — 이름·목표는 서버 상한(60·2000자)에서 더 들어가지 않고, 저장하면 POST 한다 (WP-687)', async () => {
    const cycles = { current: [] as CycleResponse[] }
    const posts: unknown[] = []
    const { user } = await openCycles(cycles)
    server.use(
      http.post(CYCLES, async ({ request }) => {
        const body = (await request.json()) as { name: string }
        posts.push(body)
        const created = createCycle({ id: 1, name: body.name, status: 'PLANNED' })
        cycles.current = [created]
        return HttpResponse.json(created, { status: 201 })
      }),
    )
    await user.click(screen.getByTestId('cycle-new'))
    await screen.findByTestId('cycle-form-dialog')
    const name = screen.getByTestId('cycle-name-input')
    const goal = screen.getByLabelText('사이클 목표')
    await user.click(name)
    await user.paste('가'.repeat(61))
    expect(name).toHaveValue('가'.repeat(60))
    await user.click(goal)
    await user.paste('나'.repeat(2001))
    expect(goal).toHaveValue('나'.repeat(2000))
    await user.clear(goal)

    await user.clear(name)
    await user.paste('스프린트 A')
    await user.click(screen.getByTestId('cycle-submit'))
    await waitFor(() => expect(posts).toHaveLength(1))
    expect(posts[0]).toMatchObject({ name: '스프린트 A' })
    expect(await screen.findByTestId('cycle-row-1')).toHaveTextContent('스프린트 A')
  })

  test('종료일이 시작일보다 빠르면 인라인 오류를 보이고 저장 버튼이 잠겨 POST 하지 않는다 (#804)', async () => {
    let posts = 0
    const { user } = await openCycles({ current: [] })
    server.use(
      http.post(CYCLES, () => {
        posts++
        return HttpResponse.json({}, { status: 201 })
      }),
    )
    await user.click(screen.getByTestId('cycle-new'))
    await screen.findByTestId('cycle-form-dialog')
    // 상태 셀렉트도 영문 enum 대신 한국어 라벨로 그려진다(매핑 전체는 cycleMeta.test 단위 테스트).
    expect(screen.getByTestId('cycle-status-select')).toHaveTextContent('예정')
    await user.click(screen.getByTestId('cycle-name-input'))
    await user.paste('종료일역전테스트')
    await user.type(screen.getByLabelText('시작일'), '2026-09-10')
    await user.type(screen.getByLabelText('종료일'), '2026-09-01')
    expect(await screen.findByTestId('cycle-date-range-error')).toHaveTextContent('종료일은 시작일 이후여야 합니다')
    const submit = screen.getByTestId('cycle-submit')
    expect(submit).toBeDisabled()
    // 잠긴 버튼을 눌러도(폼 제출 포함) 요청은 없다.
    await user.click(submit)
    await new Promise((r) => setTimeout(r, 100))
    expect(posts).toBe(0)
  })

  test('수정 — 이름이 채워져 열리고, 고치면 PATCH { name } 뒤 성공 토스트', async () => {
    const cycles = { current: [createCycle()] }
    const patches: unknown[] = []
    const { user } = await openCycles(cycles)
    server.use(
      http.patch(`${CYCLES}/1`, async ({ request }) => {
        const body = (await request.json()) as { name: string }
        patches.push(body)
        cycles.current = [{ ...cycles.current[0], name: body.name }]
        return HttpResponse.json(cycles.current[0])
      }),
    )
    // WP-923: 행마다 반복되는 아이콘 버튼은 이름에 사이클 이름을 넣어 구분한다.
    await user.click(within(screen.getByTestId('cycle-row-1')).getByRole('button', { name: '스프린트 1 수정' }))
    const name = await screen.findByTestId('cycle-name-input')
    expect(name).toHaveValue('스프린트 1')
    await user.clear(name)
    await user.paste('스프린트 1 (수정됨)')
    await user.click(screen.getByTestId('cycle-submit'))
    await waitFor(() => expect(patches.at(-1)).toMatchObject({ name: '스프린트 1 (수정됨)' }))
    expect(await screen.findByText('사이클을 수정했습니다')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('cycle-row-1')).toHaveTextContent('스프린트 1 (수정됨)'))
  })

  test('삭제 — 확인창에 빠질 이슈 수를 알리고(WP-488), 확인하면 DELETE 뒤 행이 사라진다', async () => {
    const cycles = { current: [createCycle()] }
    const deletes: string[] = []
    const { user } = await openCycles(cycles, [{ cycleId: 1, total: 4, done: 1, byStatus: { TODO: 3, DONE: 1 } }])
    server.use(
      http.delete(`${CYCLES}/1`, () => {
        deletes.push('DELETE')
        cycles.current = []
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const del = screen.getByTestId('cycle-delete-1')
    expect(del).toHaveAccessibleName('스프린트 1 삭제')
    await user.click(del)
    expect(await screen.findByTestId('delete-impact')).toHaveTextContent(
      /^이 사이클의 이슈 4개가 사이클에서 빠집니다\(이슈는 지워지지 않습니다\)\.$/,
    )
    expect(deletes).toEqual([])
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '삭제' }))
    await waitFor(() => expect(deletes).toEqual(['DELETE']))
    expect(await screen.findByText('사이클을 삭제했습니다')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByTestId('cycle-row-1')).not.toBeInTheDocument())
  })
})

/** 이슈 상세 속성 레일의 사이클 피커 — 사이클 목록과 이 이슈에 붙은 사이클(PUT 은 puts 에 모으고 반영). */
async function openIssue(cycles: CycleResponse[], attached: CycleSummary[]) {
  const puts: unknown[] = []
  let current = attached
  const view = renderScreen(<CyclePickerPopover projectKey={KEY} issueNumber={1} />, {
    path: `/projects/${KEY}/issues/1`,
    handlers: [
      http.get(CYCLES, () => HttpResponse.json(cycles)),
      http.get(`${ISSUE}/cycles`, () => HttpResponse.json(current)),
      http.put(`${ISSUE}/cycles`, async ({ request }) => {
        const body = (await request.json()) as { cycleIds: number[] }
        puts.push(body)
        current = cycles.filter((c) => body.cycleIds.includes(c.id)).map(({ id, name, status }) => ({ id, name, status }))
        return HttpResponse.json(current)
      }),
    ],
  })
  await screen.findByTestId('cycle-picker-trigger', {}, { timeout: SCREEN_LOAD_TIMEOUT })
  return { ...view, puts }
}

describe('사이클 피커 — 이슈 상세', () => {
  test('사이클을 체크하고 Esc 로 닫으면 PUT { cycleIds: [1] } 뒤 성공 토스트, 상태는 한국어 라벨 (WP-490)', async () => {
    const { user, puts } = await openIssue([createCycle()], [])
    await user.click(screen.getByTestId('cycle-picker-trigger'))
    await screen.findByTestId('cycle-picker')
    const option = screen.getByTestId('cycle-option-1')
    expect(option).toHaveTextContent('진행 중')
    expect(option).not.toHaveTextContent('ACTIVE')
    await user.click(option)
    // 고를 때마다가 아니라 닫을 때 한 번 저장한다.
    expect(puts).toEqual([])
    await user.keyboard('{Escape}')
    await waitFor(() => expect(puts).toEqual([{ cycleIds: [1] }]))
    expect(await screen.findByText('사이클을 변경했습니다')).toBeInTheDocument()
  })

  // WP-659 — 완료 사이클에는 새로 붙이지 못한다(보드 드래그와 같은 규칙). 이미 붙은 완료 사이클은 뗄 수 있다.
  test('안 붙은 완료 사이클은 고를 수 없고, 붙은 완료 사이클은 떼어 PUT { cycleIds: [] } (WP-659)', async () => {
    const cycles = [
      createCycle({ id: 1, name: '스프린트 1', status: 'ACTIVE' }),
      createCycle({ id: 2, name: '지난 스프린트', status: 'COMPLETED' }),
      createCycle({ id: 3, name: '9월 스프린트', status: 'COMPLETED' }),
    ]
    const { user, puts } = await openIssue(cycles, [{ id: 3, name: '9월 스프린트', status: 'COMPLETED' }])
    // 붙은 사이클 이름이 트리거 접근 이름에도 붙는다(WP-853).
    expect(await screen.findByRole('button', { name: '사이클 편집: 9월 스프린트' })).toBeInTheDocument()
    await user.click(screen.getByTestId('cycle-picker-trigger'))
    await screen.findByTestId('cycle-picker')
    expect(within(screen.getByTestId('cycle-option-2')).getByRole('checkbox')).toBeDisabled()
    expect(within(screen.getByTestId('cycle-option-1')).getByRole('checkbox')).toBeEnabled()
    const linked = within(screen.getByTestId('cycle-option-3')).getByRole('checkbox')
    expect(linked).toBeChecked()
    await user.click(linked)
    await user.keyboard('{Escape}')
    await waitFor(() => expect(puts).toEqual([{ cycleIds: [] }]))
  })
})

describe('사이클 필터 — 이슈 목록', () => {
  test('「＋ 필터 › 사이클 › 스프린트 1」을 고르면 칩이 생기고 URL·검색 요청에 cycle=1 이 실린다', async () => {
    const searches: URL[] = []
    // group=none — 진행 중 사이클이 있으면 목록 기본이 사이클 그룹(#878)이라 그 구간이 이미 cycle=1 로 요청한다.
    const { user, location } = renderProjectScreen(`/projects/${KEY}?group=none`, {
      handlers: [
        http.get(`/api/v1/projects/${KEY}`, () => HttpResponse.json(createProject())),
        http.get(`/api/v1/projects/${KEY}/views`, () => HttpResponse.json([])),
        http.get(CYCLES, () => HttpResponse.json([createCycle()])),
        http.get(`/api/v1/projects/${KEY}/issues`, ({ request }) => {
          searches.push(new URL(request.url))
          return HttpResponse.json(createIssueSearchResponse([]))
        }),
      ],
    })
    await user.click(await screen.findByTestId('add-filter-trigger', {}, { timeout: SCREEN_LOAD_TIMEOUT }))
    await user.click(await screen.findByTestId('add-filter-facet-cycle'))
    await user.click(await screen.findByTestId('facet-value-cycle-1'))
    expect(await screen.findByTestId('filter-chip-cycle')).toBeInTheDocument()
    await waitFor(() => expect(searches.some((u) => u.searchParams.get('cycle') === '1')).toBe(true))
    expect(new URLSearchParams(location().split('?')[1]).get('cycle')).toBe('1')
  })
})
