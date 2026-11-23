// 앱 셸 안쪽 Suspense 경계 회귀 테스트(WP-2021) — 페이지 청크가 걸려도 셸이 먼저 커밋돼 전역 조회가 나가야 한다.
import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { DriveUploadProvider } from '@/components/drive/upload/DriveUploadProvider'
import { AppLayout } from '@/components/layout/AppLayout'
import { shellHandlers } from '@/test/msw/baseHandlers'
import { renderScreen } from '@/test/renderScreen'

// 끝나지 않는 lazy 페이지 — 청크가 영영 로드 중인 상태를 흉내 낸다.
const Never = lazy(() => new Promise<never>(() => {}))

describe('AppLayout Suspense 경계 (WP-2021)', () => {
  it('페이지 청크가 걸려 있어도 앱 셸이 먼저 그려지고 전역 조회가 나간다', async () => {
    let unreadCalls = 0
    renderScreen(
      <DriveUploadProvider>
        <Suspense fallback={<div>outer-fallback</div>}>
          <Routes>
            <Route element={<AppLayout />}>
              <Route path="*" element={<Never />} />
            </Route>
          </Routes>
        </Suspense>
      </DriveUploadProvider>,
      {
        path: '/issues',
        handlers: [
          http.get('/api/v1/notifications/unread-count', () => {
            unreadCalls += 1
            return HttpResponse.json({ count: 0 })
          }),
          ...shellHandlers,
        ],
      },
    )
    // 셸의 전역 조회가 페이지 청크를 기다리지 않고 나간다.
    await waitFor(() => expect(unreadCalls).toBeGreaterThan(0))
    // 레일 내비게이션이 보이고, 바깥 fallback 은 보이지 않는다.
    expect((await screen.findAllByRole('navigation')).length).toBeGreaterThan(0)
    expect(screen.queryByText('outer-fallback')).toBeNull()
  })
})
