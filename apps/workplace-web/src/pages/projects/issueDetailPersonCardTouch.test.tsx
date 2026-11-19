// 이슈 상세 사람 카드 × 터치 코멘트 행(WP-1767) — 터치에서는 코멘트 행 오른쪽이 ⋯ 메뉴라 hover 단추 대신 그것이 남는지 본다.
// 뷰포트는 파일당 하나(mockViewport)라 휴대폰 폭·터치 전용 판정은 issueDetailPersonCard.test.tsx 와 따로 둔다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { openIssueDetailScreen } from '@/test/kits/projects/issueDetailScreen'
import { mockViewport } from '@/test/viewport'

import { createComment, createIssue, createIssueDetail } from '../../../e2e/factories/issue.factory'
import { createMember } from '../../../e2e/factories/project.factory'

// 휴대폰 폭·터치 포인터 — 카드는 아래 시트로, 코멘트 행 액션은 ⋯ 메뉴로 그려진다.
mockViewport()

const KEY = 'WP'

test('작성자 카드를 열었다 닫아도 코멘트 행의 ⋯ 메뉴가 그대로 열린다', async () => {
  const detail = createIssueDetail({
    summary: createIssue({ id: 1, number: 1, projectKey: KEY, title: '카드 테스트' }),
    comments: [createComment({ id: 31, authorId: 7, authorName: '김민수', authorKind: 'HUMAN', body: '사람 코멘트' })],
  })
  const { user } = await openIssueDetailScreen({
    key: KEY,
    detail,
    members: [createMember({ userId: 7, username: 'minsu', name: '김민수' })],
    handlers: [
      http.get('/api/v1/members/:id', () =>
        HttpResponse.json({ userId: 7, username: 'minsu', name: '김민수', email: null, title: null, kind: 'HUMAN', active: true, membershipRole: null, membershipStatus: null }),
      ),
      http.get('/api/v1/contacts/members/:id', () => HttpResponse.json({ groups: [] })),
      http.get('/api/v1/mail/accounts', () => HttpResponse.json([])),
    ],
  })
  const header = await screen.findByTestId('issue-comment-header-31')
  await user.click(within(header).getByTestId('person-card-trigger-7'))
  await screen.findByTestId('person-card')
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByTestId('person-card')).not.toBeInTheDocument())

  // 닫힌 뒤에도 ⋯ 가 눌리고 액션 시트가 열린다(모달 잔재가 포인터를 막지 않는다).
  await user.click(within(header).getByTestId('issue-comment-more-31'))
  expect(await screen.findByTestId('issue-comment-sheet')).toBeInTheDocument()
})
