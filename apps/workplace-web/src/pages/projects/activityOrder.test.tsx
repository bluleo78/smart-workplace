// 이슈 활동 정렬(WP-1016) — 페이지 테스트(WP-971).
// 기본은 오래된 순(지금 그대로)이고, 탭 옆 「오래된 순 / 최신순」으로 코멘트·이력 순서를 함께 바꾼다.
// 최신순이면 데스크톱 작성창은 목록 위(새 글이 붙는 쪽), 이력의 「이전 N건 더 보기」는 목록 아래로 간다.
// 고른 순서는 이슈별이 아니라 앱 전체 설정으로 이 브라우저에 기억한다 — 다시 열어도 그대로다.
import { cleanup, screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { BASE, versionApi } from '@/test/msw/versionHandlers'
import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'

import { createComment, createHistoryEntry, createIssue, createIssueDetail } from '../../../e2e/factories/issue.factory'

// 서버는 늘 오래된 순으로 준다 — 코멘트 3개, 이력 7개(제목을 T1→T2… 로 바꾼 기록).
const COMMENTS = [1, 2, 3].map((n) =>
  createComment({ id: n, body: `코멘트 ${n}`, createdAt: `2026-10-2${n}T00:00:00Z`, updatedAt: `2026-10-2${n}T00:00:00Z` }),
)
const HISTORY = [1, 2, 3, 4, 5, 6, 7].map((n) =>
  createHistoryEntry({
    id: n,
    eventType: 'TITLE_CHANGED',
    fromValue: `T${n - 1}`,
    toValue: `T${n}`,
    createdAt: `2026-10-1${n}T00:00:00Z`,
  }),
)

async function openIssue() {
  const api = versionApi()
  const view = renderPage(`/projects/WP/issues/1`, {
    handlers: [
      http.get(`${BASE}/issues/1`, () =>
        HttpResponse.json(
          createIssueDetail({ summary: createIssue({ id: 1, number: 1 }), comments: COMMENTS, history: HISTORY }),
        ),
      ),
      ...api.handlers,
    ],
  })
  await screen.findByTestId('activity-order', {}, { timeout: PAGE_LOAD_TIMEOUT })
  await screen.findByText('코멘트 1')
  return view
}

/** 코멘트 목록에 보이는 본문 순서. */
const commentOrder = () =>
  within(screen.getByRole('region', { name: '코멘트' }))
    .getAllByText(/^코멘트 \d$/)
    .map((el) => el.textContent)

/** 이력 목록에 보이는 「바뀐 제목」 순서(T1 → T2 의 T2). */
const historyOrder = () =>
  within(screen.getByRole('list', { name: '활동 타임라인' }))
    .getAllByRole('listitem')
    .map((li) => li.textContent?.match(/→ (T\d)/)?.[1])

/** a 가 문서에서 b 보다 앞에 있는가. */
const isBefore = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)

describe('이슈 활동 정렬', () => {
  test('기본은 오래된 순 — 코멘트는 오래된 것부터, 작성창은 목록 아래, 이력은 최근 5건 위에 「이전 2건 더 보기」', async () => {
    const { user } = await openIssue()
    expect(screen.getByTestId('activity-order-oldest')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('activity-order-newest')).toHaveAttribute('aria-pressed', 'false')
    expect(commentOrder()).toEqual(['코멘트 1', '코멘트 2', '코멘트 3'])
    const list = within(screen.getByRole('region', { name: '코멘트' })).getByRole('list')
    expect(isBefore(list, screen.getByTestId('issue-comment-input'))).toBe(true)

    await user.click(screen.getByRole('tab', { name: '이력' }))
    expect(historyOrder()).toEqual(['T3', 'T4', 'T5', 'T6', 'T7'])
    const more = screen.getByRole('button', { name: '이전 2건 활동 더 보기' })
    expect(isBefore(more, screen.getByRole('list', { name: '활동 타임라인' }))).toBe(true)
  })

  test('최신순을 고르면 코멘트·이력이 최신부터 보이고, 작성창은 목록 위, 「이전 N건 더 보기」는 목록 아래다', async () => {
    const { user } = await openIssue()
    await user.click(screen.getByTestId('activity-order-newest'))
    expect(screen.getByTestId('activity-order-newest')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('activity-order-oldest')).toHaveAttribute('aria-pressed', 'false')

    expect(commentOrder()).toEqual(['코멘트 3', '코멘트 2', '코멘트 1'])
    const list = within(screen.getByRole('region', { name: '코멘트' })).getByRole('list')
    expect(isBefore(screen.getByTestId('issue-comment-input'), list)).toBe(true)

    await user.click(screen.getByRole('tab', { name: '이력' }))
    // 접어도 최근 5건 — 최신부터.
    expect(historyOrder()).toEqual(['T7', 'T6', 'T5', 'T4', 'T3'])
    const timeline = screen.getByRole('list', { name: '활동 타임라인' })
    const more = screen.getByRole('button', { name: '이전 2건 활동 더 보기' })
    expect(isBefore(timeline, more)).toBe(true)
    await user.click(more)
    expect(historyOrder()).toEqual(['T7', 'T6', 'T5', 'T4', 'T3', 'T2', 'T1'])
  })

  test('순서를 바꾸면 작성창은 다시 만들어지지 않고 자리만 옮긴다 — 쓰던 초안이 남는다', async () => {
    const { user } = await openIssue()
    // 편집기(tiptap)는 jsdom 에서 글자 입력을 재현하지 못한다 — 초안은 편집기 요소에 있으니 같은 요소가 남는지로 판정한다.
    const input = screen.getByTestId('issue-comment-input')

    await user.click(screen.getByTestId('activity-order-newest'))
    expect(screen.getByTestId('issue-comment-input')).toBe(input)
    const list = within(screen.getByRole('region', { name: '코멘트' })).getByRole('list')
    expect(isBefore(input, list)).toBe(true)
  })

  test('고른 순서는 다시 열어도(다른 이슈를 열어도) 그대로다 — 오래된 순으로 되돌리면 그것도 기억한다', async () => {
    const first = await openIssue()
    await first.user.click(screen.getByTestId('activity-order-newest'))
    cleanup()

    const second = await openIssue()
    expect(screen.getByTestId('activity-order-newest')).toHaveAttribute('aria-pressed', 'true')
    expect(commentOrder()).toEqual(['코멘트 3', '코멘트 2', '코멘트 1'])
    await second.user.click(screen.getByTestId('activity-order-oldest'))
    cleanup()

    await openIssue()
    expect(screen.getByTestId('activity-order-oldest')).toHaveAttribute('aria-pressed', 'true')
    expect(commentOrder()).toEqual(['코멘트 1', '코멘트 2', '코멘트 3'])
  })
})
