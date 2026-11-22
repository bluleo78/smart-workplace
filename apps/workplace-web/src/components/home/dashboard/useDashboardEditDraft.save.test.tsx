// 편집 저장(WP-1953) — 편집을 시작할 때 읽은 version 을 PUT 에 싣고, 409 면 편집을 끝내고 최신을 다시 불러와
// 초안을 버린 동작과 맞는 문구(DASHBOARD_EDIT_CONFLICT_MESSAGE)로 알린다(리뷰 후속 — 서버의 「다시 저장」과 어긋나지 않게).
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

import { DASHBOARD_EDIT_CONFLICT_MESSAGE, useDashboardEditDraft } from './useDashboardEditDraft'

const CONFLICT_MESSAGE = '다른 곳에서 대시보드 레이아웃이 바뀌었습니다. 최신 레이아웃을 불러왔으니 확인한 뒤 다시 저장해 주세요.'
const saved: DashboardWidgetConfig[] = [{ id: 'my_tasks', type: 'my_tasks', count: 5, hidden: false }]

beforeEach(() => toastError.mockClear())

/** 레이아웃 조회 + 편집 초안 훅을 Dashboard 와 같은 방식으로 엮는다(provider 밖 = 로컬 저장소). */
function setup(putStatus: 200 | 409 | 500) {
  const state = { gets: 0, puts: [] as { version?: number }[] }
  server.use(
    http.get('/api/v1/me/dashboard', () => {
      state.gets += 1
      return HttpResponse.json({ widgets: saved, version: 3 })
    }),
    http.put('/api/v1/me/dashboard', async ({ request }) => {
      const body = (await request.json()) as { widgets: DashboardWidgetConfig[]; version?: number }
      state.puts.push(body)
      if (putStatus === 409) return HttpResponse.json({ message: CONFLICT_MESSAGE }, { status: 409 })
      if (putStatus === 500) return HttpResponse.json({}, { status: 500 })
      return HttpResponse.json({ widgets: body.widgets, version: 4 })
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

test('편집 저장 409 면 편집을 끝내고(초안 버림) 재조회하며 초안 버림과 맞는 문구를 알린다', async () => {
  const { state, result } = setup(409)
  await waitFor(() => expect(result.current.edit.canEnterEdit).toBe(true))
  act(() => result.current.edit.enterEdit())
  expect(result.current.edit.editing).toBe(true)
  act(() => result.current.edit.saveEdit())
  await waitFor(() => expect(result.current.edit.editing).toBe(false))
  // 최신 레이아웃을 다시 불러온다(편집이 끝나 기준 레이아웃이 계속 있는 동작).
  await waitFor(() => expect(state.gets).toBe(2))
  // 초안을 버리는 동작이라 서버의 「다시 저장」 대신 「다시 편집」 을 말한다(WP-1953 리뷰 후속).
  // 안내는 하나만 뜬다 — 충돌 안내와 실패 안내가 겹쳐 서버 문구까지 함께 나가지 않게.
  expect(toastError).toHaveBeenCalledWith(DASHBOARD_EDIT_CONFLICT_MESSAGE)
  expect(toastError).toHaveBeenCalledTimes(1)
  expect(DASHBOARD_EDIT_CONFLICT_MESSAGE).toContain('다시 편집')
})

test('편집 저장이 409 가 아닌 실패면 편집을 끝내지 않고 초안을 남긴다', async () => {
  const { state, result } = setup(500)
  await waitFor(() => expect(result.current.edit.canEnterEdit).toBe(true))
  act(() => result.current.edit.enterEdit())
  // 초안에 손댄 뒤 저장한다 — 실패 뒤에도 그 변경이 남아 있는지(409 때와의 대비)까지 본다.
  act(() => result.current.edit.toggleHidden('my_tasks'))
  expect(result.current.edit.draft.find((w) => w.id === 'my_tasks')?.hidden).toBe(true)
  act(() => result.current.edit.saveEdit())
  await waitFor(() => expect(toastError).toHaveBeenCalledWith('대시보드 저장에 실패했습니다'))
  expect(result.current.edit.editing).toBe(true)
  expect(result.current.edit.draft.find((w) => w.id === 'my_tasks')?.hidden).toBe(true)
  // 충돌이 아니면 재조회하지 않는다(초안이 그대로 남으므로 기준 레이아웃도 그대로다).
  expect(state.gets).toBe(1)
})
