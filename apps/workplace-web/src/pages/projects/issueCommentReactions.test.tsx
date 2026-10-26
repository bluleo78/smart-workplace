// 이슈 코멘트 이모지 반응(WP-504) — 페이지 테스트(WP-980).
// 빠른 반응·전체 피커 → POST payload, 내 칩 취소 → DELETE, 같은 틱 연속 토글, 404 롤백, AI 코멘트 반응, 읽기 전용 칩,
// 수정 중 칩 숨김·수정 뒤 유지, 반응자 호버 카드·전체 보기 다이얼로그는 브라우저 없이 판정되므로
// e2e/pages/projects/issue-comment-reactions.spec.ts 에서 옮겼다. 호버 때만 드러나는 😊+·상시 ＋ 의 투명도와
// 키보드 반응 뒤 포커스 이동(WP-830)은 E2E(@input)에 남는다.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { delay, http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { DETAIL_PATH, detailHandlers, type DetailRef,detailRefOf, ISSUE_ID, ME_ID, setRichText } from '@/test/kits/projects/issueDetailRef'
import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'
import type { IssueCommentResponse, IssueDetailResponse } from '@/types/issue'

import { createAgentComment, createComment } from '../../../e2e/factories/issue.factory'

const REACTIONS = `/api/v1/issues/${ISSUE_ID}/comments/:commentId/reactions`

type Call = { method: string; path: string; body: unknown; emoji: string | null }

/** detailRef 의 commentId 코멘트에 내 반응을 더하거나(+1) 뺀다(-1) — 서버가 저장한 것처럼. */
function applyServerReaction(ref: DetailRef, commentId: number, emoji: string, delta: 1 | -1) {
  ref.current = {
    ...ref.current,
    comments: ref.current.comments.map((c) => {
      if (c.id !== commentId) return c
      const others = c.reactions.filter((r) => r.emoji !== emoji)
      const count = (c.reactions.find((r) => r.emoji === emoji)?.count ?? 0) + delta
      return { ...c, reactions: count > 0 ? [...others, { emoji, count, reacted: delta > 0 }] : others }
    }),
  }
}

type Opts = {
  /** 반응 쓰기 응답 지연(ms) — 요청 진행 중 연속 클릭 재현. */
  delayMs?: number
  /** 반응 쓰기를 이 상태로 실패시킨다. */
  failStatus?: number
  detail?: Partial<IssueDetailResponse>
  /** 반응자 목록(commentId → 이모지별 사람). */
  reactors?: Record<number, Record<string, { userId: number; name: string }[]>>
}

/** 코멘트로 이슈 상세를 열고 첫 코멘트 본문이 뜰 때까지 기다린다. 반응 쓰기는 calls 에 쌓고 ref 에 반영한다. */
async function open(comments: IssueCommentResponse[], opts: Opts = {}) {
  const ref = detailRefOf({ comments, ...opts.detail })
  const calls: Call[] = []
  const write = async ({ request, params }: { request: Request; params: Record<string, string | readonly string[] | undefined> }) => {
    const url = new URL(request.url)
    // 도착 순서대로 쌓는다 — 본문을 읽기(await) 전에 자리를 잡아 POST·DELETE 순서가 뒤바뀌지 않게.
    const call: Call = { method: request.method, path: url.pathname, body: null, emoji: url.searchParams.get('emoji') }
    calls.push(call)
    const body = request.method === 'POST' ? ((await request.json()) as { emoji: string }) : null
    call.body = body
    if (opts.delayMs) await delay(opts.delayMs)
    if (opts.failStatus) return HttpResponse.json({}, { status: opts.failStatus })
    applyServerReaction(ref, Number(params.commentId), body?.emoji ?? url.searchParams.get('emoji') ?? '', body ? 1 : -1)
    return new HttpResponse(null, { status: 204 })
  }
  const handlers = [
    ...detailHandlers(ref),
    http.post(REACTIONS, write),
    http.delete(REACTIONS, write),
    http.get(`${REACTIONS}/users`, ({ request, params }) => {
      const emoji = new URL(request.url).searchParams.get('emoji') ?? ''
      const items = (opts.reactors?.[Number(params.commentId)]?.[emoji] ?? []).map((r) => ({ kind: 'HUMAN', ...r }))
      return HttpResponse.json({ items, nextCursor: null, hasMore: false })
    }),
    http.patch(`/api/v1/issues/${ISSUE_ID}/comments/:id`, async ({ request, params }) => {
      const { body } = (await request.json()) as { body: string }
      calls.push({ method: 'PATCH', path: new URL(request.url).pathname, body: { body }, emoji: null })
      ref.current = { ...ref.current, comments: ref.current.comments.map((c) => (c.id === Number(params.id) ? { ...c, body } : c)) }
      return HttpResponse.json(ref.current.comments.find((c) => c.id === Number(params.id)))
    }),
  ]
  const view = renderPage(DETAIL_PATH, { handlers })
  await screen.findByText(comments[0].body, {}, { timeout: PAGE_LOAD_TIMEOUT })
  return { ...view, ref, calls }
}

const pathOf = (commentId: number) => `/api/v1/issues/${ISSUE_ID}/comments/${commentId}/reactions`

describe('코멘트 반응 추가·취소 (WP-504)', () => {
  test('빠른 반응 6종 중 👍 → 칩(내 반응, 1)과 POST { emoji }, 고르면 팝오버가 닫힌다', async () => {
    const { user, calls } = await open([createComment({ id: 32, issueId: ISSUE_ID, authorId: 2, body: '빠른 반응 대상' })])
    await user.click(screen.getByTestId('comment-reaction-add-32'))
    for (const e of ['👍', '❤️', '😄', '🎉', '😢', '🙏']) {
      expect(await screen.findByTestId(`comment-reaction-quick-32-${e}`)).toBeInTheDocument()
    }
    await user.click(screen.getByTestId('comment-reaction-quick-32-👍'))
    expect(await screen.findByTestId('comment-reaction-pill-32-👍')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('comment-reaction-count-32-👍')).toHaveTextContent('1')
    await waitFor(() => expect(calls).toEqual([{ method: 'POST', path: pathOf(32), body: { emoji: '👍' }, emoji: null }]))
    await waitFor(() => expect(screen.queryByTestId('comment-reaction-quick-32-👍')).not.toBeInTheDocument())
  })

  test('더 보기 → 채팅 피커와 같은 40종에서 🚀 를 고르면 그 이모지로 POST', async () => {
    const { user, calls } = await open([createComment({ id: 39, issueId: ISSUE_ID, authorId: 2, body: '더보기 대상' })])
    await user.click(screen.getByTestId('comment-reaction-add-39'))
    await user.click(await screen.findByTestId('comment-reaction-more-39'))
    await waitFor(() => expect(document.querySelectorAll('[data-testid^="comment-reaction-pick-39-"]')).toHaveLength(40))
    await user.click(screen.getByTestId('comment-reaction-pick-39-🚀'))
    expect(await screen.findByTestId('comment-reaction-pill-39-🚀')).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => expect(calls.map((c) => c.body)).toEqual([{ emoji: '🚀' }]))
  })

  test('내 반응 칩을 누르면 칩이 사라지고 DELETE ?emoji=👍', async () => {
    const { user, calls } = await open([
      createComment({ id: 33, issueId: ISSUE_ID, authorId: 2, body: '내 반응 취소 대상', reactions: [{ emoji: '👍', count: 1, reacted: true }] }),
    ])
    await user.click(screen.getByTestId('comment-reaction-pill-33-👍'))
    await waitFor(() => expect(screen.queryByTestId('comment-reaction-pill-33-👍')).not.toBeInTheDocument())
    await waitFor(() => expect(calls).toEqual([{ method: 'DELETE', path: pathOf(33), body: null, emoji: '👍' }]))
  })

  test('요청 진행 중 같은 칩을 두 번 누르면 POST → DELETE 로 나가고 원래 상태(남의 반응 1개)로 돌아온다(#702)', async () => {
    // 렌더 클로저로 판정하면 두 번 다 add(POST) 가 나간다 — 같은 틱 두 번 클릭으로 재현한다.
    const { calls } = await open(
      [createComment({ id: 34, issueId: ISSUE_ID, authorId: 2, body: '연속 토글 대상', reactions: [{ emoji: '🎉', count: 1, reacted: false }] })],
      { delayMs: 200 },
    )
    const pill = screen.getByTestId('comment-reaction-pill-34-🎉')
    act(() => {
      pill.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      pill.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await waitFor(() => expect(calls.map((c) => c.method)).toEqual(['POST', 'DELETE']))
    await waitFor(() => expect(screen.getByTestId('comment-reaction-pill-34-🎉')).toHaveAttribute('aria-pressed', 'false'))
    expect(screen.getByTestId('comment-reaction-count-34-🎉')).toHaveTextContent('1')
  })

  test('지워진 코멘트(404)에 반응하면 기본 문구 토스트 + 칩·칩 줄이 롤백되고 추가 버튼은 헤더로 돌아간다', async () => {
    const { user } = await open([createComment({ id: 37, issueId: ISSUE_ID, authorId: 2, body: '지워진 코멘트' })], { failStatus: 404 })
    await user.click(screen.getByTestId('comment-reaction-add-37'))
    await user.click(await screen.findByTestId('comment-reaction-quick-37-❤️'))
    expect(await screen.findByText('반응을 저장하지 못했어요')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByTestId('comment-reaction-pill-37-❤️')).not.toBeInTheDocument())
    expect(screen.queryByTestId('comment-reaction-bar-37')).not.toBeInTheDocument()
    const item = screen.getByText('지워진 코멘트').closest('li')!
    expect(within(item).getAllByTestId('comment-reaction-add-37')).toHaveLength(1)
  })

  test('AI 코멘트에도 반응할 수 있다', async () => {
    const { user, calls } = await open([createAgentComment({ id: 38, issueId: ISSUE_ID })])
    await user.click(screen.getByTestId('comment-reaction-add-38'))
    await user.click(await screen.findByTestId('comment-reaction-quick-38-🎉'))
    expect(await screen.findByTestId('comment-reaction-pill-38-🎉')).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => expect(calls.map((c) => c.path)).toEqual([pathOf(38)]))
  })
})

describe('코멘트 반응 — 권한·수정 (WP-504)', () => {
  test('작성 권한이 없으면 추가 버튼이 없고 칩은 비활성(눌러도 요청 없음), 반응자 호버 카드는 뜬다', async () => {
    const { calls } = await open(
      [
        createComment({ id: 41, issueId: ISSUE_ID, authorId: 2, body: '반응 있는 코멘트(읽기 전용)', reactions: [{ emoji: '👍', count: 2, reacted: false }] }),
        createComment({ id: 42, issueId: ISSUE_ID, authorId: 2, body: '반응 없는 코멘트(읽기 전용)' }),
      ],
      { detail: { viewerCanEditContent: false }, reactors: { 41: { '👍': [{ userId: 3, name: '이영희' }, { userId: 4, name: '박지훈' }] } } },
    )
    expect(document.querySelectorAll('[data-testid^="comment-reaction-add-"]')).toHaveLength(0)
    const pill = screen.getByTestId('comment-reaction-pill-41-👍')
    expect(pill).toBeDisabled()
    act(() => {
      pill.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await new Promise((r) => setTimeout(r, 300))
    expect(calls).toEqual([])
    expect(screen.getByTestId('comment-reaction-count-41-👍')).toHaveTextContent('2')
    // user.hover 는 비활성 요소에 포인터 이벤트를 보내지 않는다 — 브라우저처럼 마우스 진입(pointerover)을 직접 보낸다.
    fireEvent.pointerOver(pill, { pointerType: 'mouse' })
    expect(await screen.findByTestId('reaction-hover-summary-41', {}, { timeout: 3000 })).toHaveTextContent('이영희, 박지훈이 반응했습니다')
  })

  test('반응자 호버 카드 — 나를 「나」로 묶어 요약하고, 전체 보기는 이모지 탭별 반응자 다이얼로그를 연다', async () => {
    const { user } = await open(
      [
        createComment({
          id: 36,
          issueId: ISSUE_ID,
          authorId: 2,
          body: '반응자 확인 대상',
          reactions: [
            { emoji: '👍', count: 3, reacted: true },
            { emoji: '🙏', count: 1, reacted: false },
          ],
        }),
      ],
      {
        reactors: {
          36: {
            '👍': [
              { userId: ME_ID, name: '양동희' },
              { userId: 3, name: '이영희' },
              { userId: 4, name: '박지훈' },
            ],
            '🙏': [{ userId: 3, name: '이영희' }],
          },
        },
      },
    )
    await user.hover(screen.getByTestId('comment-reaction-pill-36-👍'))
    expect(await screen.findByTestId('reaction-hover-summary-36', {}, { timeout: 3000 })).toHaveTextContent('나, 이영희, 박지훈이 반응했습니다')
    await user.click(screen.getByTestId('reaction-hover-all-36'))
    const dialog = await screen.findByTestId('reactors-dialog')
    expect(within(dialog).getByTestId('reactors-tab-👍')).toHaveAttribute('aria-selected', 'true')
    expect(within(dialog).getByText('이 코멘트에 반응한 사람')).toBeInTheDocument()
    expect(await within(dialog).findByTestId('reactor-row-me')).toHaveTextContent('양동희')
    expect(dialog.querySelectorAll('[data-testid^="reactor-row-"]')).toHaveLength(3)
    await user.click(within(dialog).getByTestId('reactors-tab-🙏'))
    await waitFor(() => expect(dialog.querySelectorAll('[data-testid^="reactor-row-"]')).toHaveLength(1))
  })

  test('내 코멘트를 수정하는 동안 칩 줄을 숨기고, 취소하면 다시 보인다', async () => {
    const { user } = await open([
      createComment({ id: 40, issueId: ISSUE_ID, authorId: ME_ID, body: '내 코멘트', reactions: [{ emoji: '👍', count: 1, reacted: false }] }),
    ])
    expect(screen.getByTestId('comment-reaction-bar-40')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '코멘트 수정' }))
    expect(await screen.findByTestId('issue-comment-edit-input')).toBeInTheDocument()
    expect(screen.queryByTestId('comment-reaction-bar-40')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('issue-comment-edit-cancel'))
    expect(await screen.findByTestId('comment-reaction-pill-40-👍')).toBeInTheDocument()
  })

  test('수정 저장 뒤에도 칩·개수·내 반응 강조가 그대로 남는다', async () => {
    const { user, calls } = await open([
      createComment({
        id: 43,
        issueId: ISSUE_ID,
        authorId: ME_ID,
        body: '수정 전 내 코멘트',
        reactions: [
          { emoji: '👍', count: 2, reacted: true },
          { emoji: '🎉', count: 1, reacted: false },
        ],
      }),
    ])
    await user.click(screen.getByRole('button', { name: '코멘트 수정' }))
    setRichText(await screen.findByTestId('issue-comment-edit-input'), '수정 후 내 코멘트')
    await user.click(screen.getByTestId('issue-comment-edit-save'))
    await waitFor(() => expect(calls.map((c) => c.method)).toEqual(['PATCH']))
    expect(await screen.findByText('수정 후 내 코멘트')).toBeInTheDocument()
    expect(screen.getByTestId('comment-reaction-pill-43-👍')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('comment-reaction-count-43-👍')).toHaveTextContent('2')
    expect(screen.getByTestId('comment-reaction-count-43-🎉')).toHaveTextContent('1')
  })
})
