// 사이클 관리·피커·필터 — 페이지 테스트(WP-971).
// 진행바 색 칸·집계 문구, 도구 줄의 새 사이클(머리줄은 프로젝트 탭 레이아웃 몫, WP-1477), 생성(입력 상한)·종료일 역전 차단·수정·삭제 payload,
// 이슈 상세 사이클 피커 PUT(완료 사이클 규칙 WP-659), 목록 사이클 필터 → 요청 cycle=1 은 브라우저 없이 판정되므로
// e2e/pages/projects/cycles.spec.ts 에서 옮겼다. 그 spec 에는 사이클 화면 배선 1건(@wiring)과 실제 오프라인 저장(@platform)이 남는다.
// 화면 테스트(WP-1002) — 사이클 화면(CyclesPage)·이슈 상세의 사이클 피커(CyclePickerPopover)는 그것만, 목록 필터는 필터 바와 목록 검색이
// 한 화면에서 이어져 프로젝트 상세 화면만 renderScreen 으로 띄운다(App·앱 셸 없이).
import { act, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { CycleCompleteDialog } from '@/components/cycle/CycleCompleteDialog'
import { CyclePickerPopover } from '@/components/cycle/CyclePickerPopover'
import { renderProjectScreen } from '@/test/kits/projects/projectDetailScreen'
import { InProjectTabs } from '@/test/kits/projects/projectTabs'
import { openQuickFacet } from '@/test/kits/projects/quickFilter'
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
async function openCycles(
  cycles: { current: CycleResponse[] },
  // 함수면 그 응답을 그대로 쓴다 — 집계를 늦추거나 실패시키는 테스트용(WP-1578).
  progress: CycleProgress[] | (() => Promise<Response>) = [],
  role: 'OWNER' | 'MEMBER' = 'OWNER',
) {
  const view = renderRouteScreen('/projects/:key/cycles', <InProjectTabs><CyclesPage /></InProjectTabs>, `/projects/${KEY}/cycles`, {
    handlers: [
      http.get(`/api/v1/projects/${KEY}`, () => HttpResponse.json(createProject())),
      http.get(CYCLES, () => HttpResponse.json(cycles.current)),
      http.get(`${CYCLES}/progress`, () => (typeof progress === 'function' ? progress() : HttpResponse.json(progress))),
      // 새 사이클·수정·삭제는 프로젝트 OWNER 만 보인다(WP-1008) — 로그인 사용자(id 1)를 OWNER 로 둔다.
      // role 로 관리 권한 없는 멤버 화면도 띄운다(WP-1578 — 사이클 완료 버튼 노출).
      http.get(`/api/v1/projects/${KEY}/members`, () => HttpResponse.json([createMember({ userId: 1, role })])),
    ],
  })
  await screen.findByTestId('cycles-page', {}, { timeout: SCREEN_LOAD_TIMEOUT })
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

  test('사이클 탭은 자기 머리줄·「프로젝트로 돌아가기」 없이 본문 도구 줄에 「새 사이클」을 둔다 (#667 → WP-1477)', async () => {
    await openCycles({ current: [] })
    // 머리줄(이름·키·탭 줄)은 프로젝트 탭 레이아웃이 하나만 그린다 — 사이클 본문은 자기 머리줄이 없고, 탭으로 오가므로 ← 복귀 단추도 없다.
    expect(screen.getAllByTestId('page-header')).toHaveLength(1)
    expect(within(screen.getByTestId('cycles-page')).queryByTestId('page-header')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '프로젝트로 돌아가기' })).not.toBeInTheDocument()
    expect(within(screen.getByTestId('cycles-page')).getByTestId('cycle-new')).toHaveTextContent('새 사이클')
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
    // WP-1316: 기간은 필수 — 비어 있는 동안은 안내를 보이고 저장이 잠긴다.
    expect(screen.getByTestId('cycle-date-required')).toHaveTextContent('시작일과 종료일을 모두 입력해 주세요')
    expect(screen.getByTestId('cycle-submit')).toBeDisabled()
    await user.type(screen.getByLabelText('시작일'), '2026-09-01')
    expect(screen.getByTestId('cycle-submit')).toBeDisabled()
    await user.type(screen.getByLabelText('종료일'), '2026-09-14')
    expect(screen.queryByTestId('cycle-date-required')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('cycle-submit'))
    await waitFor(() => expect(posts).toHaveLength(1))
    expect(posts[0]).toMatchObject({ name: '스프린트 A', startDate: '2026-09-01', endDate: '2026-09-14' })
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

  /** 새 사이클 창에 이름·기간을 채운다(WP-1554 테스트 공용). */
  async function fillNewCycle(user: Awaited<ReturnType<typeof openCycles>>['user'], name: string) {
    await user.click(screen.getByTestId('cycle-new'))
    await screen.findByTestId('cycle-form-dialog')
    await user.click(screen.getByTestId('cycle-name-input'))
    await user.paste(name)
    await user.type(screen.getByLabelText('시작일'), '2026-09-01')
    await user.type(screen.getByLabelText('종료일'), '2026-09-14')
  }

  test('저장을 빠르게 두 번 눌러도 POST 는 한 번, 저장 중에는 버튼이 잠긴다 (WP-1554)', async () => {
    let posts = 0
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => { release = r })
    const { user } = await openCycles({ current: [] })
    server.use(
      http.post(CYCLES, async () => {
        posts++
        await gate
        return HttpResponse.json(createCycle({ name: '스프린트' }), { status: 201 })
      }),
    )
    await fillNewCycle(user, '스프린트')
    // 같은 틱에 두 번 클릭 — 다시 그리기 전이라 disabled 가 아닌 ref 가드가 막아야 한다(fireEvent·dblClick 은 사이에 다시 그린다).
    const submit = screen.getByTestId('cycle-submit')
    act(() => {
      submit.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      submit.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    // 응답이 오기 전에는 저장 버튼이 잠겨 있다.
    await waitFor(() => expect(screen.getByTestId('cycle-submit')).toBeDisabled())
    // 저장 중에는 취소도 잠기고 Esc 로도 창이 닫히지 않는다.
    expect(screen.getByRole('button', { name: '취소' })).toBeDisabled()
    await user.keyboard('{Escape}')
    expect(screen.getByTestId('cycle-form-dialog')).toBeInTheDocument()
    release()
    // 성공 뒤 창이 닫힌 다음에 요청 수를 센다 — 고정 대기 없이 보이는 결과를 기다린다.
    await waitFor(() => expect(screen.queryByTestId('cycle-form-dialog')).not.toBeInTheDocument())
    expect(posts).toBe(1)
    expect(screen.getAllByText('사이클을 생성했습니다')).toHaveLength(1)
  })

  test('저장이 실패하면 버튼이 다시 풀려 고쳐서 저장할 수 있다 (WP-1554)', async () => {
    let posts = 0
    const { user } = await openCycles({ current: [] })
    server.use(
      http.post(CYCLES, () => {
        posts++
        if (posts === 1) {
          return HttpResponse.json({ status: 409, message: '이미 존재하는 사이클 이름입니다: 스프린트' }, { status: 409 })
        }
        return HttpResponse.json(createCycle({ name: '스프린트 2' }), { status: 201 })
      }),
    )
    await fillNewCycle(user, '스프린트')
    await user.click(screen.getByTestId('cycle-submit'))
    expect(await screen.findByText('이미 존재하는 사이클 이름입니다: 스프린트')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('cycle-submit')).not.toBeDisabled())
    await user.click(screen.getByTestId('cycle-submit'))
    await waitFor(() => expect(posts).toBe(2))
  })

  test('수정 — 이름이 채워져 열리고, 고치면 PATCH { name } 뒤 성공 토스트', async () => {
    const cycles = { current: [createCycle({ startDate: '2026-09-01', endDate: '2026-09-14' })] }
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
    await waitFor(() =>
      expect(patches.at(-1)).toMatchObject({ name: '스프린트 1 (수정됨)', startDate: '2026-09-01', endDate: '2026-09-14' }),
    )
    expect(await screen.findByText('사이클을 수정했습니다')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('cycle-row-1')).toHaveTextContent('스프린트 1 (수정됨)'))
  })

  test('수정도 저장을 두 번 눌러도 PATCH 는 한 번, 실패하면 풀려 다시 저장된다 (WP-1554)', async () => {
    const cycles = { current: [createCycle({ startDate: '2026-09-01', endDate: '2026-09-14' })] }
    let patches = 0
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => { release = r })
    const { user } = await openCycles(cycles)
    server.use(
      http.patch(`${CYCLES}/1`, async () => {
        patches++
        if (patches === 1) {
          await gate
          return HttpResponse.json({ status: 409, message: '이미 존재하는 사이클 이름입니다: 새 이름' }, { status: 409 })
        }
        return HttpResponse.json({ ...cycles.current[0], name: '새 이름' })
      }),
    )
    await user.click(within(screen.getByTestId('cycle-row-1')).getByRole('button', { name: '스프린트 1 수정' }))
    const name = await screen.findByTestId('cycle-name-input')
    await user.clear(name)
    await user.paste('새 이름')
    await user.dblClick(screen.getByTestId('cycle-submit'))
    await waitFor(() => expect(screen.getByTestId('cycle-submit')).toBeDisabled())
    release()
    expect(await screen.findByText('이미 존재하는 사이클 이름입니다: 새 이름')).toBeInTheDocument()
    expect(patches).toBe(1)
    await waitFor(() => expect(screen.getByTestId('cycle-submit')).not.toBeDisabled())
    await user.click(screen.getByTestId('cycle-submit'))
    await waitFor(() => expect(patches).toBe(2))
  })

  test('날짜 없이 만들어진 예전 사이클은 수정할 때 기간을 채워야 저장된다 (WP-1316)', async () => {
    const cycles = { current: [createCycle()] }
    const patches: unknown[] = []
    const { user } = await openCycles(cycles)
    server.use(
      http.patch(`${CYCLES}/1`, async ({ request }) => {
        patches.push(await request.json())
        return HttpResponse.json(cycles.current[0])
      }),
    )
    await user.click(within(screen.getByTestId('cycle-row-1')).getByRole('button', { name: '스프린트 1 수정' }))
    await screen.findByTestId('cycle-name-input')
    expect(screen.getByTestId('cycle-date-required')).toBeInTheDocument()
    const submit = screen.getByTestId('cycle-submit')
    expect(submit).toBeDisabled()
    await user.click(submit)
    await user.type(screen.getByLabelText('시작일'), '2026-10-01')
    await user.type(screen.getByLabelText('종료일'), '2026-10-14')
    await user.click(submit)
    await waitFor(() => expect(patches).toHaveLength(1))
    expect(patches[0]).toMatchObject({ startDate: '2026-10-01', endDate: '2026-10-14' })
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

// 사이클 완료 창(WP-1578, 시안 B안) — 진입 버튼 노출(권한·상태), 보낼 곳별 요청 본문, 서버 오류의 창 안 표시.
describe('사이클 완료 (WP-1578)', () => {
  const GW7 = createCycle({ id: 7, name: 'GW-7', startDate: '2026-11-03', endDate: '2026-11-16', status: 'ACTIVE' })
  const GW6 = createCycle({ id: 6, name: 'GW-6', startDate: '2026-10-20', endDate: '2026-11-02', status: 'COMPLETED' })
  const GW9 = createCycle({ id: 9, name: 'GW-9', startDate: '2026-12-01', endDate: '2026-12-14', status: 'PLANNED' })
  const GW10 = createCycle({ id: 10, name: 'GW-10', startDate: '2026-12-15', endDate: '2026-12-28', status: 'PLANNED' })
  /** GW-7 진행 — 24개 중 18개 완료(미완료 6). */
  const P7: CycleProgress = { cycleId: 7, total: 24, done: 18, byStatus: { DONE: 18, TODO: 6 } }
  const P9: CycleProgress = { cycleId: 9, total: 3, done: 0, byStatus: { TODO: 3 } }

  /** 완료 요청 본문을 모으는 핸들러 — reply 가 있으면 그 응답(오류)을 돌려준다. */
  function captureComplete(reply?: () => Response) {
    const bodies: unknown[] = []
    server.use(
      http.post(`${CYCLES}/:id/complete`, async ({ request, params }) => {
        bodies.push({ id: Number(params.id), ...((await request.json()) as object) })
        if (reply) return reply()
        return HttpResponse.json({ completedCycle: { ...GW7, status: 'COMPLETED' }, targetCycle: null })
      }),
    )
    return bodies
  }

  /** GW-7 행의 「사이클 완료」로 창을 연다. */
  async function openComplete(user: Awaited<ReturnType<typeof openCycles>>['user']) {
    await user.click(within(await screen.findByTestId('cycle-row-7')).getByRole('button', { name: 'GW-7 사이클 완료' }))
    return screen.findByTestId('cycle-complete-dialog')
  }

  test('진행 중 사이클에만 관리자에게 「사이클 완료」 버튼이 보인다', async () => {
    await openCycles({ current: [GW7, GW9, GW6] }, [P7])
    // 멤버 목록(OWNER)이 온 뒤에야 관리 버튼이 그려진다.
    // 행마다 같은 글자라 접근성 이름에 사이클 이름을 넣는다(수정·삭제와 같은 모양, WP-923).
    await within(screen.getByTestId('cycle-row-7')).findByRole('button', { name: 'GW-7 사이클 완료' })
    expect(screen.getAllByRole('button', { name: /사이클 완료$/ })).toHaveLength(1)
    // 수정 아이콘 왼쪽에 둔다(시안 B안).
    const buttons = within(screen.getByTestId('cycle-row-7')).getAllByRole('button')
    expect(buttons.map((b) => b.getAttribute('aria-label') ?? b.textContent)).toEqual(['GW-7 사이클 완료', 'GW-7 수정', 'GW-7 삭제'])
  })

  test('관리 권한 없는 멤버에게는 「사이클 완료」 버튼이 없다', async () => {
    const memberRequests: string[] = []
    const onEnd = ({ request }: { request: Request }) => {
      if (request.url.endsWith(`/projects/${KEY}/members`)) memberRequests.push(request.url)
    }
    server.events.on('request:end', onEnd)
    try {
      await openCycles({ current: [GW7, GW9, GW6] }, [P7], 'MEMBER')
      await waitFor(() => expect(memberRequests.length).toBeGreaterThan(0))
      // 멤버에게는 권한이 정해졌음을 알리는 표식이 없다(새 사이클·수정·삭제 모두 숨김) — 응답을 화면에 반영할 짧은 틈을 둔다.
      await new Promise((r) => setTimeout(r, 50))
      expect(screen.queryAllByRole('button', { name: /사이클 완료$/ })).toHaveLength(0)
      expect(screen.queryByTestId('cycle-new')).not.toBeInTheDocument()
    } finally {
      server.events.removeListener('request:end', onEnd)
    }
  })

  test('기본값(예정 없음) — 새 사이클 GW-8·다음 기간으로 보낸다', async () => {
    const { user } = await openCycles({ current: [GW7, GW6] }, [P7])
    const bodies = captureComplete()
    const dialog = await openComplete(user)
    expect(within(dialog).getByRole('heading', { name: 'GW-7 완료' })).toBeInTheDocument()
    expect(dialog).toHaveTextContent('2026-11-03 ~ 2026-11-16 · 이슈 24개')
    expect(within(dialog).getByTestId('cycle-complete-done')).toHaveTextContent('18완료')
    expect(within(dialog).getByTestId('cycle-complete-incomplete')).toHaveTextContent('6미완료')
    expect(within(dialog).getByText('미완료 이슈 6개 보낼 곳')).toBeInTheDocument()
    expect(within(dialog).getByRole('combobox', { name: '미완료 이슈 6개 보낼 곳' })).toHaveTextContent('새 사이클')
    const summary = within(dialog).getByTestId('cycle-complete-summary')
    expect(summary).toHaveTextContent('GW-8')
    expect(summary).toHaveTextContent('2026-11-17 ~ 2026-11-30 · 바로 진행 중')
    // 요약 줄일 때는 이름 칸이 접혀 있다.
    expect(within(dialog).queryByLabelText('새 사이클 이름')).not.toBeInTheDocument()
    await user.click(within(dialog).getByTestId('cycle-complete-submit'))
    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0]).toEqual({
      id: 7, destination: 'NEW', newCycleName: 'GW-8', newCycleStartDate: '2026-11-17', newCycleEndDate: '2026-11-30',
    })
    await waitFor(() => expect(screen.queryByTestId('cycle-complete-dialog')).not.toBeInTheDocument())
    expect(await screen.findByText('GW-7 완료')).toBeInTheDocument()
  })

  test('「수정」을 누르면 이름·기간 칸이 펼쳐지고 고친 값으로 보낸다', async () => {
    const { user } = await openCycles({ current: [GW7] }, [P7])
    const bodies = captureComplete()
    const dialog = await openComplete(user)
    await user.click(within(dialog).getByRole('button', { name: '수정' }))
    const name = within(dialog).getByLabelText('새 사이클 이름')
    expect(name).toHaveValue('GW-8')
    expect(within(dialog).getByLabelText('새 사이클 시작일')).toHaveValue('2026-11-17')
    expect(within(dialog).getByLabelText('새 사이클 종료일')).toHaveValue('2026-11-30')
    await user.clear(name)
    await user.paste('GW-8 마무리')
    await user.click(within(dialog).getByTestId('cycle-complete-submit'))
    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0]).toMatchObject({ destination: 'NEW', newCycleName: 'GW-8 마무리', newCycleStartDate: '2026-11-17' })
  })

  test('예정 사이클이 있으면 가장 이른 것이 기본 — 바로 시작 끄면 startImmediately false', async () => {
    // GW-10 을 앞에 두어 목록 순서가 아니라 시작일 순으로 고르는지 본다.
    const { user } = await openCycles({ current: [GW7, GW10, GW9] }, [P7, P9])
    const bodies = captureComplete()
    const dialog = await openComplete(user)
    expect(within(dialog).getByRole('combobox', { name: '미완료 이슈 6개 보낼 곳' })).toHaveTextContent('GW-9')
    const summary = within(dialog).getByTestId('cycle-complete-summary')
    expect(summary).toHaveTextContent('GW-9')
    expect(summary).toHaveTextContent('2026-12-01 ~ 2026-12-14 · 이슈 3개 → 9개')
    const start = within(dialog).getByRole('checkbox', { name: 'GW-9 바로 시작' })
    expect(start).toBeChecked()
    await user.click(start)
    expect(start).not.toBeChecked()
    await user.click(within(dialog).getByTestId('cycle-complete-submit'))
    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0]).toEqual({ id: 7, destination: 'SCHEDULED', targetCycleId: 9, startImmediately: false })
  })

  test('사이클 없음 — 안내 문구와 NONE', async () => {
    const { user } = await openCycles({ current: [GW7, GW9] }, [P7, P9])
    const bodies = captureComplete()
    const dialog = await openComplete(user)
    await user.click(within(dialog).getByRole('combobox', { name: '미완료 이슈 6개 보낼 곳' }))
    // 맨 위 새 사이클(다음 이름·기간), 가운데 「예정 사이클」 묶음, 맨 아래 사이클 없음.
    const options = await screen.findAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual([
      '새 사이클,GW-8 · 2026-11-17 ~ 2026-11-30',
      'GW-9,2026-12-01 ~ 2026-12-14 · 이슈 3개',
      '사이클 없음',
    ])
    expect(screen.getByText('예정 사이클')).toBeInTheDocument()
    // 이름과 보조 글자가 붙어 읽히지 않는다(이름 끝 sr-only 쉼표). jsdom 의 이름 계산은 요소 경계에 공백을 넣어 공백은 느슨하게 본다.
    expect(screen.getByRole('option', { name: /^새 사이클\s*,\s*GW-8 · 2026-11-17 ~ 2026-11-30$/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /^GW-9\s*,\s*2026-12-01 ~ 2026-12-14 · 이슈 3개$/ })).toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: '사이클 없음' }))
    expect(within(dialog).getByText('미완료 이슈는 백로그에서 볼 수 있습니다.')).toBeInTheDocument()
    expect(within(dialog).queryByTestId('cycle-complete-summary')).not.toBeInTheDocument()
    await user.click(within(dialog).getByTestId('cycle-complete-submit'))
    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0]).toEqual({ id: 7, destination: 'NONE' })
  })

  test('진행 집계가 오기 전에는 0/0 대신 불러오는 중이고 완료가 막힌다 — 오면 기본 보낼 곳이 보인다', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => { release = r })
    const { user } = await openCycles({ current: [GW7, GW9] }, async () => {
      await gate
      return HttpResponse.json([P7, P9])
    })
    const bodies = captureComplete()
    const dialog = await openComplete(user)
    expect(within(dialog).getByTestId('cycle-complete-progress-loading')).toBeInTheDocument()
    expect(within(dialog).queryByTestId('cycle-complete-incomplete')).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('combobox')).not.toBeInTheDocument()
    const submit = within(dialog).getByTestId('cycle-complete-submit')
    expect(submit).toBeDisabled()
    await user.click(submit)
    release()
    expect(await within(dialog).findByRole('combobox', { name: '미완료 이슈 6개 보낼 곳' })).toHaveTextContent('GW-9')
    expect(within(dialog).queryByTestId('cycle-complete-progress-loading')).not.toBeInTheDocument()
    expect(submit).toBeEnabled()
    expect(bodies).toEqual([])
  })

  test('진행 집계를 못 받으면 오류를 보이고 완료가 막힌다', async () => {
    const { user } = await openCycles({ current: [GW7] }, async () =>
      HttpResponse.json({ status: 500, message: '서버 오류' }, { status: 500 }),
    )
    const bodies = captureComplete()
    const dialog = await openComplete(user)
    expect(await within(dialog).findByTestId('cycle-complete-progress-error')).toBeInTheDocument()
    expect(within(dialog).queryByTestId('cycle-complete-incomplete')).not.toBeInTheDocument()
    expect(within(dialog).getByTestId('cycle-complete-submit')).toBeDisabled()
    expect(bodies).toEqual([])
  })

  test('미완료 0개면 드롭다운 없이 NONE', async () => {
    const { user } = await openCycles({ current: [GW7, GW9] }, [{ cycleId: 7, total: 5, done: 5, byStatus: { DONE: 5 } }])
    const bodies = captureComplete()
    const dialog = await openComplete(user)
    expect(within(dialog).getByTestId('cycle-complete-incomplete')).toHaveTextContent('0미완료')
    expect(within(dialog).queryByRole('combobox')).not.toBeInTheDocument()
    expect(dialog).not.toHaveTextContent('보낼 곳')
    await user.click(within(dialog).getByTestId('cycle-complete-submit'))
    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0]).toEqual({ id: 7, destination: 'NONE' })
  })

  test('이름 중복(409)이면 창이 남고 이름 칸 아래에 오류', async () => {
    const { user } = await openCycles({ current: [GW7] }, [P7])
    // 실제 응답 형태 — GlobalExceptionHandler 의 CycleNameDuplicatedException(409) 메시지.
    const bodies = captureComplete(() =>
      HttpResponse.json({ status: 409, message: '이미 존재하는 사이클 이름입니다: GW-8' }, { status: 409 }),
    )
    const dialog = await openComplete(user)
    await user.click(within(dialog).getByTestId('cycle-complete-submit'))
    await waitFor(() => expect(bodies).toHaveLength(1))
    // 요약 줄이던 새 사이클 칸이 펼쳐지고 이름 칸 아래에 서버 메시지가 보인다.
    const name = await within(dialog).findByLabelText('새 사이클 이름')
    expect(name).toHaveValue('GW-8')
    expect(name).toHaveAttribute('aria-invalid', 'true')
    expect(within(dialog).getByTestId('cycle-complete-name-error')).toHaveTextContent('이미 존재하는 사이클 이름입니다: GW-8')
    expect(screen.getByTestId('cycle-complete-dialog')).toBeInTheDocument()
    await waitFor(() => expect(within(dialog).getByTestId('cycle-complete-submit')).toBeEnabled())
  })

  test('그 밖의 오류는 창을 남기고 완료 버튼 위에 서버 메시지를 알린다', async () => {
    const { user } = await openCycles({ current: [GW7] }, [P7])
    captureComplete(() =>
      HttpResponse.json({ status: 400, message: '진행 중인 사이클만 완료할 수 있습니다' }, { status: 400 }),
    )
    const dialog = await openComplete(user)
    await user.click(within(dialog).getByTestId('cycle-complete-submit'))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('진행 중인 사이클만 완료할 수 있습니다')
    expect(screen.getByTestId('cycle-complete-dialog')).toBeInTheDocument()
  })

  test('끝 숫자 없는 이름이면 칸이 펼쳐지고 이름이 비어 완료가 막힌다', async () => {
    const autumn = createCycle({ id: 7, name: '가을 스프린트', startDate: '2026-11-03', endDate: '2026-11-16', status: 'ACTIVE' })
    const { user } = await openCycles({ current: [autumn] }, [P7])
    const bodies = captureComplete()
    await user.click(within(await screen.findByTestId('cycle-row-7')).getByRole('button', { name: '가을 스프린트 사이클 완료' }))
    const dialog = await screen.findByTestId('cycle-complete-dialog')
    const name = within(dialog).getByLabelText('새 사이클 이름')
    expect(name).toHaveValue('')
    expect(within(dialog).getByLabelText('새 사이클 시작일')).toHaveValue('2026-11-17')
    const submit = within(dialog).getByTestId('cycle-complete-submit')
    expect(submit).toBeDisabled()
    await user.click(name)
    await user.paste('겨울 스프린트')
    expect(submit).toBeEnabled()
    // 날짜를 하나라도 지우면 다시 막힌다.
    await user.clear(within(dialog).getByLabelText('새 사이클 종료일'))
    expect(submit).toBeDisabled()
    expect(bodies).toEqual([])
  })

  test('기간 없는 사이클이면 칸이 펼쳐지고 날짜를 채워야 완료된다', async () => {
    const noDates = createCycle({ id: 7, name: 'GW-7', status: 'ACTIVE' })
    const { user } = await openCycles({ current: [noDates] }, [P7])
    const dialog = await openComplete(user)
    expect(dialog).toHaveTextContent('이슈 24개')
    expect(within(dialog).getByLabelText('새 사이클 이름')).toHaveValue('GW-8')
    expect(within(dialog).getByTestId('cycle-complete-submit')).toBeDisabled()
  })

  test('사이클 목록이 오기 전에는 불러오는 중이고 완료가 막힌다 — 오면 예정 GW-9 가 기본 보낼 곳이다', async () => {
    // 창만 띄운다 — 화면(CyclesPage)은 목록을 먼저 받아 캐시를 채우므로, 목록이 늦는 경우는 창 단독으로만 재현된다.
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => { release = r })
    const bodies = captureComplete()
    renderScreen(<CycleCompleteDialog projectKey={KEY} cycle={GW7} open onOpenChange={() => {}} />, {
      handlers: [
        http.get(CYCLES, async () => {
          await gate
          return HttpResponse.json([GW7, GW9])
        }),
        http.get(`${CYCLES}/progress`, () => HttpResponse.json([P7, P9])),
      ],
    })
    const dialog = await screen.findByTestId('cycle-complete-dialog')
    // 집계는 왔어도 목록이 없으면 기본 보낼 곳이 조용히 「새 사이클」로 잡히지 않게 그리지 않는다.
    expect(await within(dialog).findByTestId('cycle-complete-progress-loading')).toBeInTheDocument()
    expect(within(dialog).queryByRole('combobox')).not.toBeInTheDocument()
    const submit = within(dialog).getByTestId('cycle-complete-submit')
    expect(submit).toBeDisabled()
    act(() => release())
    expect(await within(dialog).findByRole('combobox', { name: '미완료 이슈 6개 보낼 곳' })).toHaveTextContent('GW-9')
    expect(within(dialog).queryByTestId('cycle-complete-progress-loading')).not.toBeInTheDocument()
    expect(submit).toBeEnabled()
    expect(bodies).toEqual([])
  })

  test('사이클 목록을 못 받으면 오류를 보이고 완료가 막힌다', async () => {
    renderScreen(<CycleCompleteDialog projectKey={KEY} cycle={GW7} open onOpenChange={() => {}} />, {
      handlers: [
        http.get(CYCLES, () => HttpResponse.json({ status: 500, message: '서버 오류' }, { status: 500 })),
        http.get(`${CYCLES}/progress`, () => HttpResponse.json([P7])),
      ],
    })
    const dialog = await screen.findByTestId('cycle-complete-dialog')
    expect(await within(dialog).findByTestId('cycle-complete-progress-error')).toBeInTheDocument()
    expect(within(dialog).queryByRole('combobox')).not.toBeInTheDocument()
    expect(within(dialog).getByTestId('cycle-complete-submit')).toBeDisabled()
  })

  test('추천 이름이 60자를 넘으면 칸을 펼쳐 이름 칸 아래에 알리고 완료를 막는다', async () => {
    // 60자 이름 끝이 9 → 추천 이름은 61자(서버 상한 60). 입력 칸 maxLength 로는 막히지 않는다.
    const longName = `${'가'.repeat(59)}9`
    const long = createCycle({ id: 7, name: longName, startDate: '2026-11-03', endDate: '2026-11-16', status: 'ACTIVE' })
    const { user } = await openCycles({ current: [long] }, [P7])
    const bodies = captureComplete()
    await user.click(within(await screen.findByTestId('cycle-row-7')).getByRole('button', { name: `${longName} 사이클 완료` }))
    const dialog = await screen.findByTestId('cycle-complete-dialog')
    // 요약 줄이 아니라 칸이 펼쳐져 있다.
    expect(within(dialog).queryByTestId('cycle-complete-summary')).not.toBeInTheDocument()
    const name = within(dialog).getByLabelText('새 사이클 이름')
    expect(name).toHaveValue(`${'가'.repeat(59)}10`)
    expect(name).toHaveAttribute('aria-invalid', 'true')
    expect(within(dialog).getByTestId('cycle-complete-name-error')).toHaveTextContent('사이클 이름은 60자 이하로 입력하세요')
    const submit = within(dialog).getByTestId('cycle-complete-submit')
    expect(submit).toBeDisabled()
    // 60자 안으로 고치면 안내가 사라지고 완료할 수 있다.
    await user.clear(name)
    await user.paste('GW-8')
    expect(within(dialog).queryByTestId('cycle-complete-name-error')).not.toBeInTheDocument()
    expect(submit).toBeEnabled()
    expect(bodies).toEqual([])
  })

  test('창을 닫았다 다시 열면 고른 보낼 곳이 처음으로 돌아간다', async () => {
    const { user } = await openCycles({ current: [GW7] }, [P7])
    let dialog = await openComplete(user)
    await user.click(within(dialog).getByRole('combobox', { name: '미완료 이슈 6개 보낼 곳' }))
    await user.click(await screen.findByRole('option', { name: '사이클 없음' }))
    await user.click(within(dialog).getByRole('button', { name: '취소' }))
    await waitFor(() => expect(screen.queryByTestId('cycle-complete-dialog')).not.toBeInTheDocument())
    dialog = await openComplete(user)
    expect(within(dialog).getByRole('combobox', { name: '미완료 이슈 6개 보낼 곳' })).toHaveTextContent('새 사이클')
    expect(within(dialog).getByTestId('cycle-complete-summary')).toHaveTextContent('GW-8')
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
    await screen.findByTestId('quick-filter-bar', {}, { timeout: SCREEN_LOAD_TIMEOUT })
    await openQuickFacet(user, 'cycle')
    await user.click(await screen.findByTestId('facet-value-cycle-1'))
    await waitFor(() => expect(screen.getByTestId('quick-filter-cycle')).toHaveAttribute('data-active', 'true'))
    await waitFor(() => expect(searches.some((u) => u.searchParams.get('cycle') === '1')).toBe(true))
    expect(new URLSearchParams(location().split('?')[1]).get('cycle')).toBe('1')
  })
})
