// 휴대폰 폭 드라이브 목록의 「드라이브에서 열기」 도착 강조(WP-1732) — 데스크톱 판정은 drivePage.test.tsx 「드라이브에서 열기 도착 강조」.
// matchMedia 결과가 파일 안에서 캐시되므로(뷰포트는 파일당 하나) 모바일 판정만 이 파일에 둔다.
import { screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

import { driveBaseHandlers, manyMeetingNotes, renderDrivePage, spyScrollIntoView } from '@/test/kits/drive/testkit-b6'
import { PAGE_LOAD_TIMEOUT } from '@/test/renderPage'
import { mockViewport } from '@/test/viewport'

mockViewport()

afterEach(() => {
  vi.restoreAllMocks()
})

test('휴대폰 목록에서도 행을 강조하고 그 행으로 스크롤하며, 뷰어 없이 주소에서 highlight 만 지운다', async () => {
  const scrolled = spyScrollIntoView()
  const { location } = renderDrivePage(1, {
    search: '?highlight=129',
    handlers: driveBaseHandlers({ items: { folders: [], files: manyMeetingNotes() } }),
  })
  const row = await screen.findByTestId('drive-row-file-129', {}, { timeout: PAGE_LOAD_TIMEOUT })
  await waitFor(() => expect(row).toHaveAttribute('data-highlighted', 'true'))
  // 모바일 행(⋮ 시트 단추)인지 — 휴대폰 목록 그대로에서 강조한다.
  expect(screen.getByTestId('drive-row-more-file-129')).toBeInTheDocument()
  await waitFor(() => expect(scrolled).toContain(row))
  expect(screen.queryByTestId('preview-body')).not.toBeInTheDocument()
  await waitFor(() => expect(location()).toBe('/drive/spaces/1'))
})
