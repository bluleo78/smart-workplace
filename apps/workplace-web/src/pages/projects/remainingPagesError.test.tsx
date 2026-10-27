// 에픽 패널 「종료된 에픽」의 다음 페이지 실패 안내(WP-1007) — 페이지 테스트(WP-971), 데스크톱.
// 종료 에픽은 전량을 끝까지 받는데(useFetchAllPages), 다음 페이지가 실패하면 자동 로드가 멈춰 받은 만큼만 보인 채
// 안내도 다시 시도도 없었다. 모바일(타임라인 아젠다·에픽 시트)은 remainingPagesErrorMobile.test.tsx.
import { screen, waitFor } from '@testing-library/react'
import { describe, expect, test } from 'vitest'

import { closedEpicHandlers } from '@/test/msw/remainingPagesHandlers'
import { KEY, versionApi } from '@/test/msw/versionHandlers'
import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'

describe('에픽 패널 「종료된 에픽」 — 다음 페이지 실패 (WP-1007)', () => {
  test('접혀 있어도 안내가 보이고, 다시 시도로 나머지를 받으면 개수가 늘고 안내가 사라진다', async () => {
    const closed = closedEpicHandlers()
    window.localStorage.setItem(`epicSidePanel.open.${KEY}`, 'true')
    const { user } = renderPage(`/projects/${KEY}`, { handlers: [...closed.handlers, ...versionApi().handlers] })

    const notice = await screen.findByTestId('epic-closed-load-error', {}, { timeout: PAGE_LOAD_TIMEOUT })
    expect(notice).toHaveTextContent('나머지 종료 에픽을 불러오지 못했습니다.')
    expect(screen.getByTestId('epic-closed-toggle')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByTestId('epic-closed-toggle')).toHaveTextContent('1')
    // 실패한 페이지를 저절로 다시 부르지 않는다(끝없는 재요청 방지 — WP-996).
    expect(closed.cursors.filter((c) => c === '1')).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: '다시 시도' }))
    await waitFor(() => expect(screen.queryByTestId('epic-closed-load-error')).not.toBeInTheDocument())
    expect(screen.getByTestId('epic-closed-toggle')).toHaveTextContent('2')
    expect(closed.cursors.filter((c) => c === '1')).toHaveLength(2)
  })
})
