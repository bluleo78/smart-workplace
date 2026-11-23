// 모듈 레이아웃 안쪽 Suspense 경계 회귀 테스트(WP-2021) — 본문 청크가 걸려도 모듈 사이드바가 먼저 커밋돼야 한다.
import { screen } from '@testing-library/react'
import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { ResponsiveModuleLayout } from '@/components/mobile/ResponsiveModuleLayout'
import { renderScreen } from '@/test/renderScreen'

// 끝나지 않는 lazy 본문 — 청크가 영영 로드 중인 상태를 흉내 낸다.
const Never = lazy(() => new Promise<never>(() => {}))

describe('ResponsiveModuleLayout Suspense 경계 (WP-2021)', () => {
  it('본문 청크가 걸려 있어도 모듈 사이드바가 먼저 그려진다', async () => {
    renderScreen(
      <Suspense fallback={<div>outer-fallback</div>}>
        <Routes>
          <Route
            path="/issues"
            element={
              <ResponsiveModuleLayout
                sidebar={<nav aria-label="테스트 사이드바" />}
                widthKey="test"
                rootPath="/issues"
                title="이슈"
              />
            }
          >
            <Route path="*" element={<Never />} />
          </Route>
        </Routes>
      </Suspense>,
      { path: '/issues/x' },
    )
    expect(await screen.findByRole('navigation', { name: '테스트 사이드바' })).toBeTruthy()
    expect(screen.queryByText('outer-fallback')).toBeNull()
  })
})
