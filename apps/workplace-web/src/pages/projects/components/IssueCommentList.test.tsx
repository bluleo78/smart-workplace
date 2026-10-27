// IssueCommentList — 코멘트 본문 마크다운 렌더(WP-1015). 사람·AI 코멘트 모두 같은 모습으로 서식이 보이고,
// 멘션 칩·평문 줄바꿈·원시 HTML 비허용은 그대로다. 이슈 상세 배선은 issue-comments E2E 가 맡는다.
import { screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '@/test/renderWithProviders'

import { createAgentComment, createComment } from '../../../../e2e/factories/issue.factory'
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
