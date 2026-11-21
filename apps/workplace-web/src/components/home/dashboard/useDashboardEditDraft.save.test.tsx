// 편집 저장(WP-1953) — 편집을 시작할 때 읽은 version 을 PUT 에 싣고, 409 면 편집을 끝내고 최신을 다시 불러와 서버 문구로 알린다.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { beforeEach, expect, test, vi } from 'vitest'

import { useDashboardLayout } from '@/hooks/queries/useDashboard'
import { server } from '@/test/msw/server'
import type { DashboardWidgetConfig } from '@/types/dashboard'

const toastError = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: toastError, success: vi.fn(), info: vi.fn(), dismiss: vi.fn() }) }))

import { useDashboardEditDraft } from './useDashboardEditDraft'

const CONFLICT_MESSAGE = '다른 곳에서 대시보드 레이아웃이 바뀌었습니다. 최신 레이아웃을 불러왔으니 확인한 뒤 다시 저장해 주세요.'
const saved: DashboardWidgetConfig[] = [{ id: 'my_tasks', type: 'my_tasks', count: 5, hidden: false }]

beforeEach(() => toastError.mockClear())

/** 레이아웃 조회 + 편집 초안 훅을 Dashboard 와 같은 방식으로 엮는다(provider 밖 = 로컬 저장소). */
function setup(putStatus: 200 | 409) {
  const state = { gets: 0, puts: [] as { version?: number }[] }
  server.use(
    http.get('/api/v1/me/dashboard', () => {
      state.gets += 1
      return HttpResponse.json({ widgets: saved, version: 3 })
    }),
    http.put('/api/v1/me/dashboard', async ({ request }) => {
      const body = (await request.json()) as { widgets: DashboardWidgetConfig[]; version?: number }
      state.puts.push(body)
      return putStatus === 409
        ? HttpResponse.json({ message: CONFLICT_MESSAGE }, { status: 409 })
        : HttpResponse.json({ widgets: body.widgets, version: 4 })
    }),
  )
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  const hook = renderHook(
    () => {
      const q = useDashboardLayout('desktop')
      const edit = useDashboardEditDraft({
        device: 'desktop',
        savedWidgets: q.data?.widgets,
        savedVersion: q.data?.version,
        collapseSaving: false,
        layoutFailed: false,
      })
      return { q, edit }
    },
    { wrapper },
  )
  return { state, ...hook }
}

test('편집 저장은 편집을 시작한 때 읽은 version 을 보낸다', async () => {
  const { state, result } = setup(200)
  await waitFor(() => expect(result.current.edit.canEnterEdit).toBe(true))
  act(() => result.current.edit.enterEdit())
  act(() => result.current.edit.saveEdit())
  await waitFor(() => expect(state.puts).toHaveLength(1))
  expect(state.puts[0].version).toBe(3)
  await waitFor(() => expect(result.current.edit.editing).toBe(false))
})

test('편집 저장 409 면 편집을 끝내고 재조회하며 서버 문구를 알린다', async () => {
  const { state, result } = setup(409)
  await waitFor(() => expect(result.current.edit.canEnterEdit).toBe(true))
  act(() => result.current.edit.enterEdit())
  expect(result.current.edit.editing).toBe(true)
  act(() => result.current.edit.saveEdit())
  await waitFor(() => expect(result.current.edit.editing).toBe(false))
  await waitFor(() => expect(state.gets).toBe(2))
  expect(toastError).toHaveBeenCalledWith(CONFLICT_MESSAGE)
})
