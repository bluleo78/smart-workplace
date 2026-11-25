// IssueCommentList — 코멘트 본문 마크다운 렌더(WP-1015). 사람·AI 코멘트 모두 같은 모습으로 서식이 보이고,
// 멘션 칩·평문 줄바꿈·원시 HTML 비허용은 그대로다. 이슈 상세 배선은 issue-comments E2E 가 맡는다.
// 모바일 최신순에서 내가 쓴 새 코멘트로 스크롤하는 것(WP-1016)도 여기서 본다.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { server } from '@/test/msw/server'
import { renderWithProviders } from '@/test/renderWithProviders'

import { createAgentComment, createComment } from '../../../../e2e/factories/issue.factory'
import type { ActivityOrder } from '../../../lib/activityOrder'
import { formatDateTimeMinute } from '../../../lib/formatters'
import { IssueCommentList } from './IssueCommentList'

// 멤버 목록 — 실제 TanStack Query 는 캐시 데이터의 참조를 유지하지만 목 함수는 매번 새 배열을 만들면
// mentionUsers·mentionCandidates useMemo 가 매 렌더 새로워져 행 메모이제이션 판정이 흔들린다 — 참조를 고정한다(WP-2073).
const membersData = vi.hoisted(() => [
  { userId: 1, name: 'Tester', kind: 'HUMAN', username: 'tester' },
  { userId: 99, name: 'AI Agent', kind: 'AGENT', username: 'ai' },
])
vi.mock('../../../hooks/queries/useProjectMembers', () => ({
  useProjectMembers: () => ({
    data: membersData,
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
// 이 파일은 Toaster 없이 컴포넌트만 렌더한다 — sonner 토스트는 DOM 에 남지 않으므로 모킹해
// 「찾을 수 없습니다」 같은 안내가 뜨는지(호출 횟수)로 판정한다(WP-2073).
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
  Toaster: () => null,
}))
// 마크다운 렌더 횟수 — 코멘트 행이 다시 그려졌는지 세는 계기(WP-2073). 모듈을 모킹하지 않으면 세지 못하므로
// vi.hoisted 로 카운터를 올리고 importOriginal 로 실제 컴포넌트를 그대로 쓴다. 본문(children)이 곧 코멘트 식별자다.
// 테스트마다 넘겨 쓰는 배열이 남아 초기 렌더와 재렌더가 섞이지 않게 비운다(WP-2073).
const markdownRenderCounts = vi.hoisted(() => new Map<string, number>())
beforeEach(() => markdownRenderCounts.clear())
vi.mock('@/components/ai/MarkdownMessage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ai/MarkdownMessage')>()
  const { createElement } = await import('react')
  return {
    ...actual,
    MarkdownMessage: (props: Parameters<typeof actual.MarkdownMessage>[0]) => {
      const key = String(props.children)
      markdownRenderCounts.set(key, (markdownRenderCounts.get(key) ?? 0) + 1)
      return createElement(actual.MarkdownMessage, props)
    },
  }
})
// 반응자 전체 보기 오버레이 — 열린 대상(코멘트 id)만 적어 보이게 바꿔, 반응 칩이 자기 코멘트의 오버레이를
// 여는지(시그니처 회귀) 판정한다(WP-2073).
vi.mock('@/components/reactions/ReactorsOverlay', async () => {
  const { createElement } = await import('react')
  return {
    ReactorsOverlay: ({ target, open }: { target?: { id: number } | null; open: boolean }) =>
      open && target ? createElement('div', { 'data-testid': 'reactors-overlay-target' }, String(target.id)) : null,
  }
})

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

/** id 1..n 코멘트 n개 — 오래된 순(서버 기본)으로 받는다. */
const manyComments = (n: number) => Array.from({ length: n }, (_, i) => createComment({ id: i + 1 }))
/** 「코멘트」 영역 안에서 그려진 코멘트 행 수 — 「더 보기」 버튼·작성창은 <ul> 밖이라 세는 데 섞이지 않는다. */
const countRows = () => within(screen.getByRole('region', { name: '코멘트' })).queryAllByRole('listitem').length

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

  it('코드(`…`·펜스) 안의 멘션 토큰은 칩이나 마크다운 링크 원문이 아니라 쓴 글자 그대로 보인다 — 채팅과 같은 규칙(WP-1093)', () => {
    renderList([createComment({ id: 1, authorId: 2, body: '표시 <@1> / 코드 `<@1>`\n\n```\n담당 <@99>\n```' })])

    const md = screen.getByTestId('markdown-content')
    // 코드 밖 멘션은 칩 하나뿐 — 코드 안 토큰은 칩이 되지 않는다.
    expect(screen.getAllByTestId('comment-mention-chip-1')).toHaveLength(1)
    expect(screen.queryByTestId('comment-mention-chip-99')).toBeNull()
    expect(md.querySelector('p code')?.textContent).toBe('<@1>')
    expect(md.querySelector('pre code')?.textContent).toBe('담당 <@99>\n')
  })

  it('멤버 목록에도 서버 멘션에도 없는 멘션(탈퇴 등)은 「알 수 없음」 칩으로 그린다', () => {
    renderList([createComment({ id: 1, authorId: 2, body: '<@555> 확인' })])
    expect(screen.getByTestId('comment-mention-chip-555')).toHaveTextContent('@알 수 없음')
  })

  it('삭제 확인 창의 미리보기는 멘션을 토큰 원문이 아니라 「@이름」으로 보인다(WP-1134)', async () => {
    renderList([createComment({ id: 1, authorKind: 'HUMAN', authorId: 1, body: '담당 <@1> 확인 부탁' })])

    await userEvent.setup().click(screen.getByRole('button', { name: '코멘트 삭제' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('"담당 @Tester 확인 부탁" 코멘트를')
    expect(dialog).not.toHaveTextContent('<@1>')
  })

  it('멘션 칩은 「@」와 이름이 줄바뀜되지 않게 한 덩어리다(WP-1134)', () => {
    renderList([createComment({ id: 1, authorId: 2, body: '<@1> 확인' })])
    expect(screen.getByTestId('comment-mention-chip-1')).toHaveClass('whitespace-nowrap')
  })

  it('프로젝트에서 빠진 사람의 멘션은 서버가 준 멘션 이름으로 그린다 — 멤버 목록에 없어도 「알 수 없음」이 아니다(WP-1095)', () => {
    renderList([
      createComment({
        id: 1,
        authorId: 2,
        body: '<@555> 와 <@1> 확인',
        mentions: [{ id: 555, username: 'left', name: '떠난 사람', kind: 'HUMAN' }],
      }),
      // 서버 멘션이 없는 다른 코멘트(구버전 서버)는 멤버 목록만 쓴다 — 다른 코멘트의 서버 멘션이 새지 않는다.
      createComment({ id: 2, authorId: 2, body: '<@555> 다시' }),
    ])

    const chips = screen.getAllByTestId('comment-mention-chip-555')
    expect(chips[0]).toHaveTextContent('@떠난 사람')
    expect(chips[1]).toHaveTextContent('@알 수 없음')
    expect(screen.getByTestId('comment-mention-chip-1')).toHaveTextContent('@Tester')
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

// ─── 렌더 윈도우(WP-2073) ────────────────────────────────────────────────
// 이슈 상세가 코멘트 200개를 한 번에 그려 LCP·INP 가 늘어났다 — 처음 30건만 그리고
// 「더 보기」를 누를 때마다 30건씩 늘린다. 목록 크기는 「코멘트」 영역 안의 listitem 으로 센다
// (「더 보기」 버튼은 <ul> 바깥이라 세는 데 섞이지 않는다).

describe('IssueCommentList — 렌더 윈도우 (WP-2073)', () => {
  it('초기에는 30건만 그려진다', () => {
    renderList(manyComments(40))

    expect(countRows()).toBe(30)
    // 40번째 코멘트는 아직 그려지지 않았다.
    expect(screen.queryByTestId('issue-comment-header-40')).toBeNull()
  })

  it('「더 보기」를 누르면 30건씩 늘어난다', async () => {
    renderList(manyComments(100))

    await userEvent.setup().click(screen.getByTestId('issue-comment-more'))
    // 100개가 되면 한꺼번에 전부 펼친 것 — 한 번에 30건씩만 늘어야 한다.
    expect(countRows()).toBe(60)
    // 남은 40건이 있어 버튼이 그대로 남아 있고, 남은 수를 문구로 알려 준다.
    expect(screen.getByTestId('issue-comment-more')).toBeInTheDocument()
    expect(screen.getByTestId('issue-comment-more')).toHaveTextContent('댓글 40개 더 보기')
  })

  it('이슈가 바뀌면 늘려 둔 창이 다음 이슈로 새지 않고 30건으로 돌아간다', async () => {
    // 이슈 A·B 가 같은 리스트 인스턴스를 쓰는 SPA 이동(캐시에 있으면 로딩 화면이 없어 재마운트도 없다)을 그대로 둔다.
    const build = (issueId: number, comments: ReturnType<typeof createComment>[]) => (
      <IssueCommentList projectKey="WP" issueNumber={1} issueId={issueId} comments={comments} canReact={false} hideComposer />
    )
    const view = renderWithProviders(build(100, manyComments(40)))
    // 이슈 A 에서 「더 보기」 를 눌러 창을 늘린다 — 40건뿐이라 눌르면 40건이 전부 그려진다(작성 성공이면 ALL_VISIBLE 로 전부 펼쳐진다).
    await userEvent.setup().click(screen.getByTestId('issue-comment-more'))
    expect(countRows()).toBe(40)

    // 캐시에 있던 이슈 B(댓글 200건)로 이동 — 앞 이슈에서 펼쳐 둔 창이 새면 200행이 한 번에 마운트된다.
    view.rerender(build(200, manyComments(200)))
    expect(countRows()).toBe(30)
  })

  it('30건 이하면 더 보기 버튼이 없다', () => {
    renderList(manyComments(30))

    expect(screen.queryByTestId('issue-comment-more')).toBeNull()
  })

  it('정렬 전환 뒤에도 같은 수가 보인다', () => {
    // 최신순(order)으로 그려도 윈도우는 30건 — 순서만 바뀌고 개수는 같다.
    renderWithProviders(
      <IssueCommentList
        projectKey="WP"
        issueNumber={1}
        issueId={100}
        comments={manyComments(40)}
        canReact={false}
        hideComposer
        order="newest"
      />,
    )

    expect(countRows()).toBe(30)
    expect(screen.getByTestId('issue-comment-more')).toBeInTheDocument()
  })

  // 설계 결정 2 — 최신순은 「화면 순서의 앞 30건」이어야 한다. 원시 ASC 배열을 먼저 슬라이스하면
  // 개수는 똑같이 30건으로 나오지만 가장 오래된 30건이 그려진다 — 경계 id 로 가른다.
  it('최신순은 화면 순서의 앞 30건(40→11)을 그린다 — 원시 오래된 순을 슬라이스하지 않는다', () => {
    renderWithProviders(
      <IssueCommentList
        projectKey="WP"
        issueNumber={1}
        issueId={100}
        comments={manyComments(40)}
        canReact={false}
        hideComposer
        order="newest"
      />,
    )

    expect(countRows()).toBe(30)
    // 최신순 화면 순서는 40 → 11 — 맨 앞(40)과 윈도우 마지막 경계(11)는 있고, 바깥(10 이하)은 없다.
    expect(screen.getByTestId('issue-comment-header-40')).toBeInTheDocument()
    expect(screen.getByTestId('issue-comment-header-11')).toBeInTheDocument()
    expect(screen.queryByTestId('issue-comment-header-10')).toBeNull()
  })

  // 마지막 「더 보기」 클릭에서 버튼이 사라지면 초점을 가진 컨트롤이 없어져 document.activeElement 가 body 로
  // 떨어진다 — 다음 Tab 이 페이지 맨 위에서 시작한다(WCAG 2.4.3). useListFocusRescue 는 버튼이 <ul> 밖이라 잡지 못한다.
  it('「더 보기」 마지막 클릭으로 버튼이 사라져도 초점이 body 로 떨어지지 않고 막 드러난 마지막 행으로 간다', async () => {
    renderList(manyComments(40))
    const user = userEvent.setup()
    const more = screen.getByTestId('issue-comment-more')
    more.focus()
    expect(document.activeElement).toBe(more)

    await user.click(more)

    // 40건 전부가 그려져 버튼이 남은 개수 0이 되어 사라진다.
    expect(screen.queryByTestId('issue-comment-more')).toBeNull()
    expect(countRows()).toBe(40)
    // 초점은 body 가 아니라 이 클릭으로 막 드러난 마지막 행(40번째 코멘트)에 있다.
    expect(document.getElementById('comment-40')).toHaveFocus()
  })

  // 설계 결정 6 — 목록이 늘려 둔 윈도우(60) 아래로 줄어들면(삭제·다른 탭 갱신) 창은 그대로 두고
  // 남은 행만 그린다. 이때 숨은 코멘트가 없으므로 「더 보기」 버튼도 함께 사라진다.
  it('목록이 윈도우 아래로 줄어들면 행만 줄고 「더 보기」 버튼도 남지 않는다', async () => {
    const build = (comments: ReturnType<typeof createComment>[]) => (
      <IssueCommentList projectKey="WP" issueNumber={1} issueId={100} comments={comments} canReact={false} hideComposer />
    )
    const view = renderWithProviders(build(manyComments(100)))
    await userEvent.setup().click(screen.getByTestId('issue-comment-more'))
    // 100건 중 60칸까지 펼친 상태 — 남은 40건이 있어 버튼이 있다.
    expect(countRows()).toBe(60)
    expect(screen.getByTestId('issue-comment-more')).toBeInTheDocument()

    // 코멘트가 5건만 남았다 — 늘려 둔 창은 그대로 두고 남은 5건만 그린다.
    view.rerender(build(manyComments(5)))
    expect(countRows()).toBe(5)
    expect(screen.queryByTestId('issue-comment-more')).toBeNull()
  })
})

// ─── 윈도우 밖 대상은 먼저 전부 펼친다(WP-2073) ──────────────────────────
// 렌더 윈도우(30건) 바깥의 대상 — 링크로 온 코멘트·방금 쓴 코멘트는 아직 안 그려진 행이라
// 그대로 두면 「찾을 수 없습니다」 토스트·아무 일도 없는 스크롤로 끝난다.
// 목록에는 있는데 아직 안 그려졌으면 ALL_VISIBLE_COMMENTS 로 전부 펼친 뒤 다시 찾는다.

describe('IssueCommentList — 윈도우 밖 대상은 전부 펼친다 (WP-2073)', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('윈도우 밖 코멘트 링크도 펼치고 강조한다', async () => {
    const handled = vi.fn()
    renderWithProviders(
      <IssueCommentList
        projectKey="WP"
        issueNumber={1}
        issueId={100}
        comments={manyComments(40)}
        canReact={false}
        hideComposer
        linkedCommentId={40}
        onLinkedCommentHandled={handled}
      />,
    )

    // 목록에 있는 코멘트라 「찾을 수 없습니다」 토스트 없이 40개가 전부 그려진다.
    await waitFor(() => expect(countRows()).toBe(40))
    const row = document.getElementById('comment-40')
    expect(row).not.toBeNull()
    // 펼친 뒤 다시 찾아 그 코멘트를 강조하고 처리 완료를 알린다.
    await waitFor(() => expect(row).toHaveAttribute('data-highlighted', 'true'))
    expect(toast.info).not.toHaveBeenCalled()
    expect(handled).toHaveBeenCalled()
  })

  it('방금 쓴 코멘트가 윈도우 밖이면 펼쳐지고 가운데로 간다', async () => {
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView')
    const onScrolled = vi.fn()
    renderWithProviders(
      <IssueCommentList
        projectKey="WP"
        issueNumber={1}
        issueId={100}
        comments={manyComments(40)}
        canReact={false}
        hideComposer
        scrollToCommentId={40}
        onScrolledToComment={onScrolled}
      />,
    )

    await waitFor(() => expect(countRows()).toBe(40))
    expect(screen.getByTestId('issue-comment-header-40')).toBeInTheDocument()
    expect(onScrolled).toHaveBeenCalledTimes(1)
    // 가운데로 옮긴 대상이 40번째 코멘트 행이다.
    expect(scroll.mock.contexts.map((el) => (el as HTMLElement).dataset.messageId)).toEqual(['40'])
    expect(scroll).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' })
  })
})

// ─── 코멘트 행 메모이제이션(WP-2073) ─────────────────────────────────────
// 페이지 레벨 상태(이슈 타이틀·본문 편집·탭 전환 등)가 바뀌면 목록이 다시 그려지는데, 이때 코멘트 행이
// 전부 다시 그려져 INP 가 늘어났다 — CommentItem 을 memo 로 감싸 같은 props 면 행을 다시 그리지 않는다.
// 마크다운 렌더 횟수(위 모듈 목)가 늘지 않는지로 판정한다.

describe('IssueCommentList — 코멘트 행 메모이제이션 (WP-2073)', () => {
  /** 본문이 서로 다른 코멘트 5건 — 본문 문자열이 곧 마크다운 렌더 횟수의 키다. */
  const fiveComments = () =>
    Array.from({ length: 5 }, (_, i) => createComment({ id: i + 1, authorId: 2, body: `메모 대상 ${i + 1}` }))
  /** 렌더 직후 각 코멘트 본문의 마크다운 렌더 횟수 스냅샷. */
  const snapshot = () => new Map(markdownRenderCounts)
  /** 스냅샷 이후 어느 코멘트의 마크다운도 다시 그려지지 않았는지(=행이 재렌더되지 않았는지) 본다. */
  const expectNoExtraRenders = (before: Map<string, number>, comments: ReturnType<typeof createComment>[]) => {
    for (const c of comments) {
      // 스냅샷 때 이미 그려져 카운터가 채워졌는지 먼저 본다 — 안 그려진 본문은 undefined === undefined 로 공허하게 통과한다.
      expect(before.get(c.body), `코멘트 ${c.id} 마크다운 렌더 횟수(스냅샷)`).toBeGreaterThanOrEqual(1)
      expect(markdownRenderCounts.get(c.body), `코멘트 ${c.id} 마크다운 렌더 횟수`).toBe(before.get(c.body))
    }
  }

  it('같은 props 로 다시 렌더해도 코멘트 마크다운은 다시 그려지지 않는다', () => {
    const comments = fiveComments()
    const view = renderWithProviders(
      <IssueCommentList projectKey="WP" issueNumber={1} issueId={100} comments={comments} canReact={false} hideComposer />,
    )
    const before = snapshot()

    // 부모(페이지 상태 변화)가 같은 props 로 한 번 더 그려도 — memo 없으면 5행이 전부 다시 그려진다.
    view.rerender(
      <IssueCommentList projectKey="WP" issueNumber={1} issueId={100} comments={comments} canReact={false} hideComposer />,
    )

    expectNoExtraRenders(before, comments)
  })

  it('정렬 전환에서도 코멘트 행은 다시 그려지지 않는다', () => {
    const comments = fiveComments()
    const view = renderWithProviders(
      <IssueCommentList projectKey="WP" issueNumber={1} issueId={100} comments={comments} canReact={false} hideComposer />,
    )
    const before = snapshot()

    // order 는 CommentItem prop 이 아니라 목록이 계산하는 값 — 정렬이 바뀌어도 memo 가 행을 막아야 한다.
    view.rerender(
      <IssueCommentList
        projectKey="WP"
        issueNumber={1}
        issueId={100}
        comments={comments}
        canReact={false}
        hideComposer
        order="newest"
      />,
    )

    expectNoExtraRenders(before, comments)
  })

  it('반응 토글로 comments 가 새 참조가 되어도 다른 코멘트 행은 다시 그려지지 않는다', () => {
    const comments = fiveComments()
    const view = renderWithProviders(
      <IssueCommentList projectKey="WP" issueNumber={1} issueId={100} comments={comments} canReact={false} hideComposer />,
    )
    const before = snapshot()

    // 반응 토글·수정·삭제는 detail 쿼리를 무효화해 목록을 새 참조로 다시 준다 — 구조적 공유라 실제로 바뀐 행은 하나뿐이다.
    const toggled = comments.map((c, i) =>
      i === 0 ? { ...c, reactions: [{ emoji: '👍', count: 1, reacted: true }] } : c,
    )
    view.rerender(
      <IssueCommentList projectKey="WP" issueNumber={1} issueId={100} comments={toggled} canReact={false} hideComposer />,
    )

    // 바뀐 첫 행은 다시 그려지지만 openReactors 가 comments 참조에 의존하면 나머지 네 행도 전부 다시 그려진다.
    expect(markdownRenderCounts.get(toggled[0].body)).toBeGreaterThan(before.get(toggled[0].body) ?? 0)
    expectNoExtraRenders(before, comments.slice(1))
  })

  it('반응 칩이 자기 코멘트의 오버레이를 연다', async () => {
    // 호버 카드가 부르는 반응자 조회만 이 테스트에서 핸들러를 깐다(모킹 누락 요청은 setup 이 실패시킨다).
    server.use(
      http.get('/api/v1/issues/:issueId/comments/:commentId/reactions/users', () =>
        HttpResponse.json({ items: [], nextCursor: null, hasMore: false }),
      ),
    )
    const user = userEvent.setup()
    renderWithProviders(
      <IssueCommentList
        projectKey="WP"
        issueNumber={1}
        issueId={100}
        comments={[
          createComment({ id: 1, authorId: 2, body: '첫 코멘트' }),
          createComment({ id: 2, authorId: 2, body: '둘째 코멘트', reactions: [{ emoji: '👍', count: 1, reacted: false }] }),
        ]}
        canReact
        hideComposer
      />,
    )

    // 두 번째 코멘트의 반응 칩을 호버해 「모두 보기」를 연다 — onOpenReactors 를 잘못 감싸면 첫 코멘트의 오버레이가 열린다.
    await user.hover(screen.getByTestId('comment-reaction-pill-2-👍'))
    await user.click(await screen.findByTestId('reaction-hover-all-2', {}, { timeout: 3000 }))

    expect(await screen.findByTestId('reactors-overlay-target')).toHaveTextContent(/^2$/)
  })
})
