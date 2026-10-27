// IssueCommentList — 코멘트 본문 마크다운 렌더(WP-1015). 사람·AI 코멘트 모두 같은 모습으로 서식이 보이고,
// 멘션 칩·평문 줄바꿈·원시 HTML 비허용은 그대로다. 이슈 상세 배선은 issue-comments E2E 가 맡는다.
// 모바일 최신순에서 내가 쓴 새 코멘트로 스크롤하는 것(WP-1016)도 여기서 본다.
import { screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '@/test/renderWithProviders'

import { createAgentComment, createComment } from '../../../../e2e/factories/issue.factory'
import type { ActivityOrder } from '../../../lib/activityOrder'
import { formatDateTimeMinute } from '../../../lib/formatters'
import { IssueCommentList } from './IssueCommentList'

vi.mock('../../../hooks/queries/useProjectMembers', () => ({
  useProjectMembers: () => ({
    data: [
      { userId: 1, name: 'Tester', kind: 'HUMAN', username: 'tester' },
      { userId: 99, name: 'AI Agent', kind: 'AGENT', username: 'ai' },
    ],
  }),
}))
vi.mock('../../../hooks/queries/useIssueComments', () => ({
  useCreateComment: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateComment: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteComment: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('../../../hooks/queries/useToggleCommentReaction', () => ({
  useToggleCommentReaction: () => ({ mutate: vi.fn(), isPending: false }),
}))

const TABLE_BODY = [
  '## 진행 보고',
  '',
  '**원인**: 재시도 시 `idempotency-key` 누락. 담당 <@1> 확인 부탁드립니다.',
  '',
  '| 단계 | 상태 |',
  '| --- | --- |',
  '| 로그 수집 | 완료 |',
  '',
  '```',
  'SELECT 1',
  '```',
  '',
  '<b>raw</b>',
].join('\n')

function renderList(comments: ReturnType<typeof createComment>[]) {
  return renderWithProviders(
    <IssueCommentList projectKey="WP" issueNumber={1} issueId={100} comments={comments} canReact={false} hideComposer />,
  )
}

describe('IssueCommentList — 코멘트 마크다운 렌더 (WP-1015)', () => {
  it('사람 코멘트도 제목·굵게·인라인 코드·표·코드 블록을 서식대로 그리고, 기호는 남기지 않는다', () => {
    renderList([createComment({ id: 1, authorKind: 'HUMAN', authorId: 2, authorName: '김개발', body: TABLE_BODY })])

    const md = screen.getByTestId('markdown-content')
    expect(within(md).getByRole('heading', { name: '진행 보고' })).toBeInTheDocument()
    expect(md.querySelector('strong')).toHaveTextContent('원인')
    expect(md.querySelector('p code')).toHaveTextContent('idempotency-key')
    // 표 — 칸 경계(th/td)가 있고 넓으면 가로 스크롤되는 래퍼 안에 있다.
    expect(within(md).getByRole('columnheader', { name: '단계' })).toBeInTheDocument()
    expect(within(md).getByRole('cell', { name: '로그 수집' })).toBeInTheDocument()
    expect(md.querySelector('table')?.parentElement).toHaveClass('overflow-x-auto')
    expect(md.querySelector('pre')).toHaveTextContent('SELECT 1')
    expect(md).not.toHaveTextContent('##')
    expect(md).not.toHaveTextContent('**')
    // 원시 HTML 은 해석하지 않는다.
    expect(md.querySelector('b')).toBeNull()
  })

  it('멘션 토큰은 사람·AI 모두 칩으로 남는다(AI 는 AI 색)', () => {
    renderList([
      createComment({ id: 1, authorId: 2, body: '담당 <@1> 와 <@99> 확인' }),
      createAgentComment({ id: 2, body: '<@1> 님 확인 부탁' }),
    ])

    const human = screen.getAllByTestId('comment-mention-chip-1')
    expect(human).toHaveLength(2)
    expect(human[0]).toHaveTextContent('@Tester')
    expect(human[0]).toHaveClass('bg-muted')
    expect(screen.getByTestId('comment-mention-chip-99')).toHaveClass('bg-ai-accent-subtle', 'text-ai-accent')
  })

  it('서식 없는 평문 코멘트는 줄바꿈을 그대로 보존한다', () => {
    renderList([createComment({ id: 1, authorId: 2, body: '첫 줄\n둘째 줄' })])

    const p = screen.getByTestId('markdown-content').querySelector('p')
    expect(p).toHaveClass('whitespace-pre-wrap')
    expect(p?.textContent).toBe('첫 줄\n둘째 줄')
  })

  it('멤버 목록에 없는 멘션은 「알 수 없음」 칩으로 그린다', () => {
    renderList([createComment({ id: 1, authorId: 2, body: '<@555> 확인' })])
    expect(screen.getByTestId('comment-mention-chip-555')).toHaveTextContent('@알 수 없음')
  })
})

// ─── 코멘트 머리 띠(WP-1034) ────────────────────────────────────────────
// 코멘트가 여러 개 쌓여도 어디까지가 한 코멘트인지·누가 썼는지 보이게 — 코멘트마다 아바타·굵은 이름·시각이 든 머리 띠를 둔다.

describe('코멘트 머리 띠 (WP-1034)', () => {
  it('코멘트마다 머리 띠에 아바타·굵은 작성자 이름·작성 시각이 있다 — 같은 사람이 연달아 써도 각각', () => {
    const at = '2026-10-27T00:12:00Z'
    renderList([
      createComment({ id: 1, authorId: 7, authorName: '박철순', body: '첫 번째', createdAt: at }),
      createComment({ id: 2, authorId: 7, authorName: '박철순', body: '두 번째', createdAt: at }),
    ])

    for (const id of [1, 2]) {
      const header = screen.getByTestId(`issue-comment-header-${id}`)
      expect(within(header).getByTestId('chat-avatar-7')).toHaveTextContent('박')
      expect(within(header).getByText('박철순')).toBeInTheDocument()
      expect(within(header).getByTestId(`issue-comment-time-${id}`)).toHaveTextContent(formatDateTimeMinute(at))
      // 본문은 띠 밖(같은 코멘트 카드 안)에 있다.
      expect(header).not.toHaveTextContent(id === 1 ? '첫 번째' : '두 번째')
    }
    const [first, second] = screen.getAllByRole('listitem')
    expect(within(first).getByText('첫 번째')).toBeInTheDocument()
    expect(within(second).getByText('두 번째')).toBeInTheDocument()
    expect(within(first).queryByText('두 번째')).toBeNull()
  })

  it('AI 코멘트는 머리 띠에 AI 봇 표식 아바타와 AI 배지가 있다', () => {
    renderList([createAgentComment({ id: 5 })])

    const header = screen.getByTestId('issue-comment-header-5')
    expect(within(header).getByTestId('chat-avatar-agent-99')).toBeInTheDocument()
    expect(within(header).getByText('AI')).toHaveAttribute('data-variant', 'ai')
  })
})

// ─── 방금 쓴 코멘트로 스크롤(WP-1016 리뷰) ────────────────────────────────────────────
// 모바일은 작성창이 화면 하단에 따로 있어(hideComposer) 목록에 붙은 새 코멘트가 스크롤하지 않으면 보이지 않는다.
// 스크롤은 작성 성공이 알려 준 id(scrollToCommentId)로만 한다 — 다른 곳에서 온 코멘트는 읽던 자리를 빼앗지 않는다.

const OLD = [1, 2].map((n) => createComment({ id: n, body: `코멘트 ${n}`, authorId: 2, authorName: '다른 사람' }))

function setupMobile(order: ActivityOrder = 'newest') {
  const scroll = vi.spyOn(Element.prototype, 'scrollIntoView')
  const onScrolled = vi.fn()
  const list = (comments: ReturnType<typeof createComment>[], scrollToCommentId: number | null) => (
    <IssueCommentList
      projectKey="WP"
      issueNumber={1}
      issueId={100}
      comments={comments}
      canReact
      hideComposer
      order={order}
      scrollToCommentId={scrollToCommentId}
      onScrolledToComment={onScrolled}
    />
  )
  const view = renderWithProviders(list(OLD, null))
  return { scroll, onScrolled, show: (comments: ReturnType<typeof createComment>[], id: number | null) => view.rerender(list(comments, id)) }
}

/** 스크롤한 요소들의 코멘트 id. */
const scrolledIds = (scroll: { mock: { contexts: unknown[] } }) =>
  scroll.mock.contexts.map((el) => (el as HTMLElement).dataset.messageId)

const MINE = createComment({ id: 3, body: '새 코멘트', authorId: 1 })

describe('방금 쓴 코멘트로 스크롤', () => {
  afterEach(() => vi.restoreAllMocks())

  it('작성한 id 의 코멘트가 다시 받은 목록에 나타나면 그 코멘트를 가운데로 스크롤하고 끝났다고 알린다', () => {
    const { scroll, onScrolled, show } = setupMobile()
    // 작성 직후 — 목록을 다시 받기 전에는 행이 없어 기다린다.
    show(OLD, 3)
    expect(scroll).not.toHaveBeenCalled()
    show([...OLD, MINE], 3)
    expect(scrolledIds(scroll)).toEqual(['3'])
    expect(scroll).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' })
    expect(onScrolled).toHaveBeenCalledTimes(1)
  })

  it('오래된 순(새 코멘트가 목록 맨 끝)에서도 스크롤한다', () => {
    const { scroll, show } = setupMobile('oldest')
    show([...OLD, MINE], 3)
    expect(scrolledIds(scroll)).toEqual(['3'])
  })

  it('작성 알림 없이 붙은 코멘트(다른 탭·AI·실시간 갱신)는 내 것이어도 스크롤하지 않는다', () => {
    const { scroll, show } = setupMobile()
    show([...OLD, MINE, createComment({ id: 4, body: '남의 코멘트', authorId: 2 })], null)
    expect(scroll).not.toHaveBeenCalled()
  })

  it('움직임 줄이기 설정이면 애니메이션 없이 옮긴다', () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) => ({ matches: query.includes('reduce'), media: query }) as MediaQueryList,
    )
    const { scroll, show } = setupMobile()
    show([...OLD, MINE], 3)
    expect(scroll).toHaveBeenCalledWith({ block: 'center', behavior: 'auto' })
  })
})
