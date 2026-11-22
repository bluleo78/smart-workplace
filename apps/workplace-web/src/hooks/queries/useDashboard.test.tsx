// useDashboard(WP-1953) — 읽은 version 을 실어 저장하고, 다른 곳에서 바뀌어 409 가 오면 최신을 다시 불러와 서버 문구로 알린다.
// 접기 연타는 PUT 마다 version 을 이어 보내 409 를 맞지 않는다. MSW 로 PUT 본문을 모아 비교한다.
import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { beforeEach, expect, test, vi } from 'vitest'

import { server } from '@/test/msw/server'
import type { DashboardWidgetConfig } from '@/types/dashboard'

const toastError = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: toastError, success: vi.fn(), info: vi.fn(), dismiss: vi.fn() }) }))

import { useDashboardLayout, useSaveDashboardLayout, useToggleWidgetCollapsed } from './useDashboard'

const CONFLICT_MESSAGE = '다른 곳에서 대시보드 레이아웃이 바뀌었습니다. 최신 레이아웃을 불러왔으니 확인한 뒤 다시 저장해 주세요.'

const widgets = (): DashboardWidgetConfig[] => [
  { id: 'a', type: 'my_tasks', count: 3, hidden: false, collapsed: false },
  { id: 'b', type: 'unread_mail', count: 3, hidden: false, collapsed: false },
]

beforeEach(() => toastError.mockClear())

function wrapperFor() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  return { qc, wrapper }
}

/** GET 은 저장본(version 고정)을 주고 호출 수를 센다. PUT 은 handler 가 정한다. */
function useServer(version: number, onPut: (body: { widgets: DashboardWidgetConfig[]; version?: number }) => Response) {
  const state = { gets: 0, puts: [] as { widgets: DashboardWidgetConfig[]; version?: number }[] }
  server.use(
    http.get('/api/v1/me/dashboard', () => {
      state.gets += 1
      return HttpResponse.json({ widgets: widgets(), version })
    }),
    http.put('/api/v1/me/dashboard', async ({ request }) => {
      const body = (await request.json()) as { widgets: DashboardWidgetConfig[]; version?: number }
      state.puts.push(body)
      return onPut(body)
    }),
  )
  return state
}

const conflict = () => HttpResponse.json({ message: CONFLICT_MESSAGE }, { status: 409 })

test('저장은 읽은 version 을 보낸다', async () => {
  const state = useServer(3, (b) => HttpResponse.json({ widgets: b.widgets, version: 4 }))
  const { qc, wrapper } = wrapperFor()
  const { result } = renderHook(() => ({ q: useDashboardLayout('desktop'), save: useSaveDashboardLayout() }), { wrapper })
  await waitFor(() => expect(result.current.q.data?.version).toBe(3))
  await act(() => result.current.save.mutateAsync({ device: 'desktop', widgets: widgets(), version: result.current.q.data!.version }))
  expect(state.puts.map((p) => p.version)).toEqual([3])
  // 성공 응답의 새 version 이 캐시에 들어간다.
  expect(qc.getQueryData<{ version: number }>(['dashboard', 'layout', 'desktop'])?.version).toBe(4)
})

test('저장 409 면 최신 레이아웃을 다시 불러온다', async () => {
  const state = useServer(3, conflict)
  const { wrapper } = wrapperFor()
  const { result } = renderHook(() => ({ q: useDashboardLayout('desktop'), save: useSaveDashboardLayout() }), { wrapper })
  await waitFor(() => expect(result.current.q.data?.version).toBe(3))
  await act(async () => {
    await result.current.save.mutateAsync({ device: 'desktop', widgets: widgets(), version: 3 }).catch(() => {})
  })
  await waitFor(() => expect(state.gets).toBe(2))
})

test('연속 접기는 version 을 이어 보낸다', async () => {
  const state = useServer(5, (b) => HttpResponse.json({ widgets: b.widgets, version: (b.version ?? 0) + 1 }))
  const { wrapper } = wrapperFor()
  const { result } = renderHook(() => ({ q: useDashboardLayout('mobile'), toggle: useToggleWidgetCollapsed() }), { wrapper })
  await waitFor(() => expect(result.current.q.data?.version).toBe(5))
  act(() => {
    result.current.toggle.mutate({ id: 'a', collapsed: true })
    result.current.toggle.mutate({ id: 'b', collapsed: true })
  })
  await waitFor(() => expect(state.puts).toHaveLength(2))
  expect(state.puts.map((p) => p.version)).toEqual([5, 6])
  expect(toastError).not.toHaveBeenCalled()
})

test('접기 409 면 롤백하고 재조회하며 서버 문구를 알린다', async () => {
  const state = useServer(5, conflict)
  const { wrapper } = wrapperFor()
  const { result } = renderHook(() => ({ q: useDashboardLayout('mobile'), toggle: useToggleWidgetCollapsed() }), { wrapper })
  await waitFor(() => expect(result.current.q.data?.version).toBe(5))
  act(() => result.current.toggle.mutate({ id: 'a', collapsed: true }))
  // 낙관 반영 → 실패 → 원래대로
  await waitFor(() => expect(toastError).toHaveBeenCalledWith(CONFLICT_MESSAGE))
  await waitFor(() => expect(state.gets).toBe(2))
  expect(result.current.q.data?.widgets.find((w) => w.id === 'a')?.collapsed).toBe(false)
})

test('접기 저장 중 창 포커스가 와도 재조회하지 않아 version 이 되돌아가지 않고, 연속 접기는 version 을 이어 보낸다', async () => {
  // 첫 PUT 을 우리가 풀어 줄 때까지 붙잡아 「저장 진행 중」 상태를 만든다.
  let release!: () => void
  const gate = new Promise<void>((resolve) => (release = resolve))
  const state = useServer(5, (b) => HttpResponse.json({ widgets: b.widgets, version: (b.version ?? 0) + 1 }))
  server.use(
    http.put('/api/v1/me/dashboard', async ({ request }) => {
      const body = (await request.json()) as { widgets: DashboardWidgetConfig[]; version?: number }
      state.puts.push(body)
      if (state.puts.length === 1) await gate
      return HttpResponse.json({ widgets: body.widgets, version: (body.version ?? 0) + 1 })
    }),
  )
  const { wrapper } = wrapperFor()
  const { result } = renderHook(() => ({ q: useDashboardLayout('mobile'), toggle: useToggleWidgetCollapsed() }), { wrapper })
  await waitFor(() => expect(result.current.q.data?.version).toBe(5))
  act(() => {
    result.current.toggle.mutate({ id: 'a', collapsed: true })
    result.current.toggle.mutate({ id: 'b', collapsed: true })
  })
  await waitFor(() => expect(state.puts).toHaveLength(1))
  // 저장 진행 중에 창이 다시 포커스를 받는다(숨김 → 보임).
  act(() => {
    focusManager.setFocused(false)
    focusManager.setFocused(true)
  })
  release()
  await waitFor(() => expect(state.puts).toHaveLength(2))
  focusManager.setFocused(undefined)
  // 재조회가 없었으므로 GET 은 처음 한 번뿐이고, 두 번째 PUT 은 첫 PUT 이 올린 version 을 싣는다(409 없음).
  expect(state.gets).toBe(1)
  expect(state.puts.map((p) => p.version)).toEqual([5, 6])
  expect(toastError).not.toHaveBeenCalled()
})

test('저장 시작 전에 이미 날아가던 GET 이 PUT 뒤에 도착해도 캐시는 PUT 의 version 을 유지한다', async () => {
  // 두 번째 GET(저장 직전에 시작된 재조회)을 붙잡아 PUT 성공 뒤에 낡은 version 으로 늦게 풀어 준다.
  let release!: () => void
  const gate = new Promise<void>((resolve) => (release = resolve))
  const state = useServer(3, (b) => HttpResponse.json({ widgets: b.widgets, version: 4 }))
  server.use(
    http.get('/api/v1/me/dashboard', async () => {
      state.gets += 1
      if (state.gets === 2) await gate
      return HttpResponse.json({ widgets: widgets(), version: 3 })
    }),
  )
  const { qc, wrapper } = wrapperFor()
  const { result } = renderHook(() => ({ q: useDashboardLayout('desktop'), save: useSaveDashboardLayout() }), { wrapper })
  await waitFor(() => expect(result.current.q.data?.version).toBe(3))
  // 저장 직전에 재조회가 시작돼 응답 대기 중인 상황.
  act(() => void qc.refetchQueries({ queryKey: ['dashboard', 'layout', 'desktop'] }))
  await waitFor(() => expect(state.gets).toBe(2))
  await act(() => result.current.save.mutateAsync({ device: 'desktop', widgets: widgets(), version: 3 }))
  release()
  // 늦은 GET 이 도착할 시간을 준 뒤에도 PUT 이 올린 version 4 가 그대로여야 한다.
  await act(() => new Promise((r) => setTimeout(r, 50)))
  expect(qc.getQueryData<{ version: number }>(['dashboard', 'layout', 'desktop'])?.version).toBe(4)
})

test('접기 연타가 모두 409 면 토스트는 한 번만 띄우고 재조회한다', async () => {
  const state = useServer(5, conflict)
  const { wrapper } = wrapperFor()
  const { result } = renderHook(() => ({ q: useDashboardLayout('mobile'), toggle: useToggleWidgetCollapsed() }), { wrapper })
  await waitFor(() => expect(result.current.q.data?.version).toBe(5))
  act(() => {
    result.current.toggle.mutate({ id: 'a', collapsed: true })
    result.current.toggle.mutate({ id: 'b', collapsed: true })
    result.current.toggle.mutate({ id: 'a', collapsed: false })
  })
  await waitFor(() => expect(state.puts).toHaveLength(3))
  await waitFor(() => expect(state.gets).toBe(2))
  expect(toastError).toHaveBeenCalledTimes(1)
  expect(toastError).toHaveBeenCalledWith(CONFLICT_MESSAGE)
})

test('version 없이 저장하면 PUT 본문에서 version 을 생략한다', async () => {
  const state = useServer(3, (b) => HttpResponse.json({ widgets: b.widgets, version: 4 }))
  const { wrapper } = wrapperFor()
  const { result } = renderHook(() => useSaveDashboardLayout(), { wrapper })
  await act(() => result.current.mutateAsync({ device: 'desktop', widgets: widgets() }))
  expect(state.puts[0]).not.toHaveProperty('version')
})
