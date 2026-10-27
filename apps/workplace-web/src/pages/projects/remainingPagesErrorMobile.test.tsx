// 타임라인·모바일 에픽 시트의 다음 페이지 실패 안내(WP-1007) — 페이지 테스트(WP-971), 모바일 폭.
// 타임라인 간트(데스크톱)는 jsdom 에서 그릴 수 없어(SVG 측정) 같은 본문 안내를 모바일 아젠다로 본다 — 안내는 셸과 무관하게 본문 맨 위다.
import { screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { MOBILE_MEDIA_QUERY } from '@/lib/mobile/breakpoint'
import { closedEpicHandlers, failingSecondPage } from '@/test/msw/remainingPagesHandlers'
import { KEY, versionApi } from '@/test/msw/versionHandlers'
import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'

import { createIssue } from '../../../e2e/factories/issue.factory'

// 모바일 폭으로 판정되게 한다 — mediaQueryStore 가 처음 쓸 때 캐시하므로 렌더 전에(beforeEach). 진짜 matchMedia 는 모듈에서 한 번만 잡는다.
const realMatchMedia = window.matchMedia.bind(window)
beforeEach(() => {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => {
    const mql = realMatchMedia(query)
    return query === MOBILE_MEDIA_QUERY ? ({ ...mql, matches: true, media: query } as MediaQueryList) : mql
  })
})

describe('타임라인 — 다음 페이지 실패 (WP-1007)', () => {
  test('일부만 받은 채 멈추면 안내와 다시 시도가 보이고, 다시 시도로 나머지를 받으면 안내가 사라진다', async () => {
    const paged = failingSecondPage(() => true, (n) => createIssue({ id: n, number: n, title: `타임라인 이슈 ${n}`, status: 'TODO' }))
    const { user } = renderPage(`/projects/${KEY}/timeline`, { handlers: [paged.handler, ...versionApi().handlers] })
    const notice = await screen.findByTestId('timeline-load-error', {}, { timeout: PAGE_LOAD_TIMEOUT })
    expect(notice).toHaveTextContent('나머지 이슈를 불러오지 못했습니다. 일부 이슈만 보입니다.')
    // 실패한 페이지를 저절로 다시 부르지 않는다(끝없는 재요청 방지 — WP-996).
    expect(paged.cursors.filter((c) => c === '1')).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: '다시 시도' }))
    await waitFor(() => expect(screen.queryByTestId('timeline-load-error')).not.toBeInTheDocument())
    expect(paged.cursors.filter((c) => c === '1')).toHaveLength(2)
    expect(await screen.findByText('타임라인 이슈 2')).toBeInTheDocument()
  })
})

describe('모바일 에픽 시트 「종료된 에픽」 — 다음 페이지 실패 (WP-1007)', () => {
  test('시트를 열면 접힌 구역 아래 안내가 보이고, 다시 시도로 나머지를 받으면 사라진다', async () => {
    const closed = closedEpicHandlers()
    const { user } = renderPage(`/projects/${KEY}`, { handlers: [...closed.handlers, ...versionApi().handlers] })
    await user.click(await screen.findByTestId('mobile-chip-epic', {}, { timeout: PAGE_LOAD_TIMEOUT }))
    const sheet = await screen.findByTestId('mobile-epic-sheet')
    const notice = await within(sheet).findByTestId('mobile-epic-closed-load-error')
    expect(notice).toHaveTextContent('나머지 종료 에픽을 불러오지 못했습니다.')
    expect(within(sheet).getByTestId('mobile-epic-closed-toggle')).toHaveTextContent('1')

    await user.click(within(notice).getByRole('button', { name: '다시 시도' }))
    await waitFor(() => expect(within(sheet).queryByTestId('mobile-epic-closed-load-error')).not.toBeInTheDocument())
    expect(within(sheet).getByTestId('mobile-epic-closed-toggle')).toHaveTextContent('2')
  })
})

