// 앱 목록(/apps)은 모바일 전용 화면(WP-121) — 데스크톱 폭에서는 홈으로 보낸다. 페이지 테스트(WP-981).
// e2e/pages/mobile/apps.spec.ts 에서 옮겼다. 뷰포트를 흉내 내지 않는 파일(jsdom 기본 matchMedia = 데스크톱)이라
// 모바일 폭 테스트(mobileApps.test.tsx)와 파일을 나눈다 — matchMedia 결과가 파일 안에서 캐시된다.
import { screen, waitFor } from '@testing-library/react'
import { expect, test } from 'vitest'

import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'

test('데스크톱 폭에서 /apps 는 홈으로 가고 모바일 탭바가 없다', async () => {
  const { location } = renderPage('/apps')
  await waitFor(() => expect(location()).toBe('/'), { timeout: PAGE_LOAD_TIMEOUT })
  expect(screen.queryByTestId('mobile-tabbar')).not.toBeInTheDocument()
  expect(screen.queryByTestId('apps-app-settings')).not.toBeInTheDocument()
})
