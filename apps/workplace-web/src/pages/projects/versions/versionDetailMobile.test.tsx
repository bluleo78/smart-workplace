// 모바일 버전 상세(WP-1089) — 페이지 테스트.
// 모바일 헤더는 meta(데스크톱의 상태 배지)를 그리지 않아, 버전 상태(미출시·출시됨·보관됨)가 화면 어디에도 없었다.
// 모바일에선 본문 기간 줄 위에 상태 배지를 보이는지 상태 셋 모두 확인한다. 뷰포트는 파일 하나에 하나라 데스크톱 판정(versionManage.test.tsx)과 나눴다.
import { screen, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'

import VersionDetailPage from '@/pages/projects/versions/VersionDetailPage'
import { atRoute } from '@/test/kits/projects/atRoute'
import { shellHandlers } from '@/test/msw/baseHandlers'
import { KEY, versionApi } from '@/test/msw/versionHandlers'
import { renderScreen } from '@/test/renderScreen'
import { mockViewport } from '@/test/viewport'

import { createVersion } from '../../../../e2e/factories/version.factory'

mockViewport()

describe('모바일 버전 상세 — 상태 표시', () => {
  test.each([
    ['UNRELEASED', '미출시'],
    ['RELEASED', '출시됨'],
    ['ARCHIVED', '보관됨'],
  ] as const)('%s 버전은 기간 줄 위에 「%s」 배지를 보인다', async (status, label) => {
    const api = versionApi({ versions: [createVersion({ id: 1, name: '1.0.0', status })] })
    renderScreen(atRoute('/projects/:key/versions/:versionId', <VersionDetailPage />), {
      path: `/projects/${KEY}/versions/1`,
      handlers: [...api.handlers, ...shellHandlers],
    })
    const badge = await screen.findByTestId('version-status-mobile')
    expect(within(badge).getByText(label)).toBeInTheDocument()
    // 기간 줄보다 앞(위)에 온다.
    expect(badge.compareDocumentPosition(screen.getByTestId('version-period')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
