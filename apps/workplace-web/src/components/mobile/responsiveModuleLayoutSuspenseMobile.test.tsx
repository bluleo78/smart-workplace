// 모바일 가지 — 모듈 레이아웃 안쪽 Suspense 경계 회귀 테스트(WP-2021). 뷰포트는 파일당 하나라 데스크톱 파일과 나눈다. 본문 청크가 걸려도 모듈 사이드바가 먼저 커밋돼야 한다.
import { screen } from '@testing-library/react'
import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { AIAssistantProvider } from '@/components/ai/AIAssistantContext'
import { ResponsiveModuleLayout } from '@/components/mobile/ResponsiveModuleLayout'
import { renderScreen } from '@/test/renderScreen'
import { mockViewport } from '@/test/viewport'

// 파일 맨 위에서 한 번 — 첫 렌더 전에 모바일 뷰포트로 맞춘다.
mockViewport()

// 끝나지 않는 lazy 본문 — 청크가 영영 로드 중인 상태를 흉내 낸다.
const Never = lazy(() => new Promise<never>(() => {}))

describe('ResponsiveModuleLayout Suspense 경계 — 모바일 (WP-2021)', () => {
  it('모바일 상세에서 본문 청크가 걸려 있어도 뒤로가기 바가 먼저 그려진다', async () => {
    renderScreen(
      <AIAssistantProvider hotkeysEnabled={false}>
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
      </Suspense>
      </AIAssistantProvider>,
      { path: '/issues/x' },
    )
    // 모바일 상세 분기는 사이드바 대신 뒤로가기 바(제목)를 먼저 그린다.
    expect(await screen.findByText('이슈')).toBeTruthy()
    expect(screen.queryByText('outer-fallback')).toBeNull()
  })
})
