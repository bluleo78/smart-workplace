// 프로젝트 정기 리포트 설정 훅(WP-1654) — 저장 위치 바꾸기는 위치 전용 PUT 을 보내고 응답을 설정 캐시에 넣으며 개요 카드 리포트 줄을 무효화한다.
// 「지금 생성」은 템플릿 재생성·위치 되돌림을 했을 수 있어 설정 캐시도 무효화한다.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { server } from '@/test/msw/server'
import type { ProjectReportSettings } from '@/types/projectReport'

import { projectReportsKey } from './useProjectReports'
import {
  projectReportSettingsKey,
  useGenerateProjectReport,
  useUpdateProjectReportLocation,
} from './useProjectReportSettings'

const KEY = 'WP'

/** 위치를 「회의록 › 주간 보고」로 바꾼 뒤의 서버 응답. */
const changed: ProjectReportSettings = {
  enabled: true,
  cadence: 'WEEKLY',
  weekday: 'MONDAY',
  timeOfDay: '09:00',
  templatePageId: 321,
  nextRunAt: null,
  canManage: true,
  noteSpaceId: 7,
  templateRootPageId: 320,
  templatePath: ['템플릿', '정기 리포트'],
  templateRecreatedAt: null,
  reportLocationPageId: 55,
  reportLocationPath: ['회의록', '주간 보고'],
}

/** 훅마다 새 쿼리 클라이언트 — 캐시·무효화를 직접 들여다보려고 바깥으로 꺼낸다. */
function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  const invalidate = vi.spyOn(qc, 'invalidateQueries')
  return { qc, wrapper, invalidate }
}

describe('useUpdateProjectReportLocation', () => {
  it('위치 전용 PUT 에 pageId 를 싣고, 응답을 설정 캐시에 넣고, 개요 카드 리포트 줄을 무효화한다', async () => {
    const bodies: unknown[] = []
    server.use(
      http.put(`*/api/v1/projects/${KEY}/report-settings/location`, async ({ request }) => {
        bodies.push(await request.json())
        return HttpResponse.json(changed)
      }),
    )
    const { qc, wrapper, invalidate } = setup()
    const { result } = renderHook(() => useUpdateProjectReportLocation(KEY), { wrapper })
    await act(async () => {
      await result.current.mutateAsync(55)
    })
    expect(bodies).toEqual([{ pageId: 55 }])
    expect(qc.getQueryData(projectReportSettingsKey(KEY))).toEqual(changed)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: projectReportsKey(KEY) })
  })
})

describe('useGenerateProjectReport', () => {
  it('만든 뒤 설정 캐시도 무효화한다(템플릿을 다시 만들었거나 위치가 되돌아갔을 수 있다)', async () => {
    server.use(
      http.post(`*/api/v1/projects/${KEY}/reports/generate`, () =>
        HttpResponse.json({ pageId: 900, title: '11월 3주차 주간 리포트', replaced: false }),
      ),
    )
    const { wrapper, invalidate } = setup()
    const { result } = renderHook(() => useGenerateProjectReport(KEY), { wrapper })
    await act(async () => {
      await result.current.mutateAsync()
    })
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: projectReportSettingsKey(KEY) }))
  })
})
