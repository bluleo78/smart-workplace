// 이슈 코멘트 이모지 반응 — 모바일·터치(WP-504) — 페이지 테스트(WP-981).
// ＋ → 하단 시트(빠른 6종·더보기 40종) → 반응 추가 payload·칩 반영, 작성 권한이 없으면 ＋ 가 없다는 것은 요청·조건부 렌더라
// e2e/pages/mobile/issue-comment-reactions.spec.ts 에서 옮겼다. ＋ 상시 노출(불투명도·높이)·포커스 복귀·길게 누르기·칩 줄바꿈은 그 E2E 가 지킨다.
// 앱 셸을 보지 않으므로 이슈 상세 화면만 renderScreen 으로 띄운다(WP-1002).
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { renderMobileRoute } from '@/test/kits/mobile/mobileScreen'
import { mockViewport } from '@/test/viewport'
import type { IssueCommentResponse, IssueDetailResponse } from '@/types/issue'

import { createChatThread } from '../../../e2e/factories/chat.factory'
import { createComment, createIssue, createIssueDetail, createIssueSearchResponse } from '../../../e2e/factories/issue.factory'
import { makeTaskType, systemTypes } from '../../../e2e/factories/issueType.factory'
import { createProject } from '../../../e2e/factories/project.factory'
import IssueDetailPage from '../projects/IssueDetailPage'

mockViewport()

const KEY = 'WP'
const BASE = `/api/v1/projects/${KEY}/issues/7`
const ISSUE_ID = 7

/**
 * 이슈 7 상세 + 반응 API. 반응 추가·취소는 서버처럼 상세의 반응 집계를 갱신해 재조회 뒤에도 화면이 맞게 하고,
 * 추가(POST) 본문은 posts 에 모은다 — E2E issue-comment-reactions.spec 의 setup 과 같은 구성.
 */
function handlers(initial: IssueCommentResponse[], detail: Partial<IssueDetailResponse> = {}) {
  let comments = [...initial]
  const posts: unknown[] = []
  const issue = createIssue({ id: ISSUE_ID, number: 7, projectKey: KEY, type: makeTaskType(), title: '코멘트 반응 이슈' })
  const react = (id: number, emoji: string, delta: number) => {
    comments = comments.map((c) => {
      if (c.id !== id) return c
      const cur = c.reactions.find((x) => x.emoji === emoji)
      const count = (cur?.count ?? 0) + delta
      const others = c.reactions.filter((x) => x.emoji !== emoji)
      return { ...c, reactions: count > 0 ? [...others, { emoji, count, reacted: delta > 0 }] : others }
    })
  }
  return {
    posts,
    list: [
      http.get(`/api/v1/projects/${KEY}`, () => HttpResponse.json(createProject({ key: KEY }))),
      http.get(`/api/v1/projects/${KEY}/types`, () => HttpResponse.json(systemTypes())),
      http.get(`/api/v1/projects/${KEY}/issues`, () => HttpResponse.json(createIssueSearchResponse([], null))),
      http.get(BASE, () => HttpResponse.json(createIssueDetail({ summary: issue, body: '본문', comments, ...detail }))),
      ...['watchers', 'labels', 'attachments', 'drive-links'].map((s) => http.get(`${BASE}/${s}`, () => HttpResponse.json([]))),
      http.get(`${BASE}/chat/thread`, () => HttpResponse.json(createChatThread({ threadId: 999, recentMessages: [] }))),
      http.post('/api/v1/issues/:issueId/comments/:id/reactions', async ({ request, params }) => {
        const body = (await request.json()) as { emoji: string }
        posts.push(body)
        react(Number(params.id), body.emoji, 1)
        return new HttpResponse(null, { status: 204 })
      }),
      http.delete('/api/v1/issues/:issueId/comments/:id/reactions', ({ request, params }) => {
        react(Number(params.id), new URL(request.url).searchParams.get('emoji') ?? '', -1)
        return new HttpResponse(null, { status: 204 })
      }),
    ],
  }
}

const other = (over: Partial<IssueCommentResponse> = {}) =>
  createComment({ id: 31, issueId: ISSUE_ID, authorId: 20, authorName: '동료', body: '반응 없는 코멘트', ...over })

test('＋ 를 누르면 팝오버가 아닌 하단 시트(빠른 6종)가 열리고, 고른 반응이 POST {emoji} 로 나가 칩이 켜진다 — 더보기는 40종', async () => {
  const h = handlers([other()])
  const { user } = renderMobileRoute('/projects/:key/issues/:number', <IssueDetailPage />, { path: `/projects/${KEY}/issues/7`, handlers: h.list })
  await user.click(await screen.findByTestId('comment-reaction-add-31'))
  const sheet = await screen.findByTestId('comment-reaction-sheet-31')
  expect(screen.queryByTestId('comment-reaction-popover-31')).not.toBeInTheDocument()
  for (const e of ['👍', '❤️', '😄', '🎉', '😢', '🙏']) expect(within(sheet).getByTestId(`comment-reaction-quick-31-${e}`)).toBeInTheDocument()
  await user.click(within(sheet).getByTestId('comment-reaction-quick-31-👍'))
  await waitFor(() => expect(screen.queryByTestId('comment-reaction-sheet-31')).not.toBeInTheDocument())
  expect(await screen.findByTestId('comment-reaction-pill-31-👍')).toHaveAttribute('aria-pressed', 'true')
  await waitFor(() => expect(h.posts).toEqual([{ emoji: '👍' }]))

  // 더보기 — 같은 시트 안에서 채팅 피커와 같은 40종 그리드를 펼친다.
  await user.click(screen.getByTestId('comment-reaction-add-31'))
  const again = await screen.findByTestId('comment-reaction-sheet-31')
  await user.click(within(again).getByTestId('comment-reaction-more-31'))
  expect(again.querySelectorAll('[data-testid^="comment-reaction-pick-31-"]')).toHaveLength(40)
  await user.click(within(again).getByTestId('comment-reaction-pick-31-🚀'))
  await waitFor(() => expect(screen.queryByTestId('comment-reaction-sheet-31')).not.toBeInTheDocument())
  expect(await screen.findByTestId('comment-reaction-pill-31-🚀')).toHaveAttribute('aria-pressed', 'true')
  await waitFor(() => expect(h.posts).toEqual([{ emoji: '👍' }, { emoji: '🚀' }]))
})

test('코멘트 작성 권한이 없으면 ＋ 가 없고 칩은 보인다', async () => {
  const h = handlers([other({ reactions: [{ emoji: '👍', count: 2, reacted: false }] })], { viewerCanEditContent: false })
  renderMobileRoute('/projects/:key/issues/:number', <IssueDetailPage />, { path: `/projects/${KEY}/issues/7`, handlers: h.list })
  expect(await screen.findByTestId('comment-reaction-pill-31-👍')).toBeInTheDocument()
  expect(document.querySelectorAll('[data-testid^="comment-reaction-add-"]')).toHaveLength(0)
})
