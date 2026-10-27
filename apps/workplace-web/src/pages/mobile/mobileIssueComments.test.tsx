// 모바일 이슈 코멘트 삭제(WP-223) — 페이지 테스트(WP-981).
// ⋯ → 액션 시트 → 삭제 확인창(취소면 유지, 확인이면 DELETE 후 목록에서 사라짐)은 브라우저 없이 판정되므로
// e2e/pages/mobile/issue-comments.spec.ts 에서 옮겼다. ⋯ 44px·인라인 수정(Tiptap 입력)·카드 폭(@layout·@input)은 E2E 에 남는다.
// 앱 셸을 보지 않으므로 이슈 상세 화면만 renderScreen 으로 띄운다(WP-1002).
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { renderMobileRoute } from '@/test/kits/mobile/mobileScreen'
import { mockViewport } from '@/test/viewport'
import type { IssueCommentResponse } from '@/types/issue'

import { createChatThread } from '../../../e2e/factories/chat.factory'
import { createComment, createIssue, createIssueDetail, createIssueSearchResponse } from '../../../e2e/factories/issue.factory'
import { makeTaskType, systemTypes } from '../../../e2e/factories/issueType.factory'
import { createProject } from '../../../e2e/factories/project.factory'
import IssueDetailPage from '../projects/IssueDetailPage'

// 휴대폰 폭·터치 포인터 — hover 아이콘 대신 ⋯ → 액션 시트가 그려진다.
mockViewport()

const KEY = 'WP'
const BASE = `/api/v1/projects/${KEY}/issues/7`
const ISSUE_ID = 7

/** 이슈 7 상세 + 코멘트 API — DELETE 는 서버처럼 목록에서 빼고 지운 id 를 기록한다. */
async function open(initial: IssueCommentResponse[]) {
  let comments = [...initial]
  const deletes: number[] = []
  const issue = createIssue({ id: ISSUE_ID, number: 7, projectKey: KEY, type: makeTaskType(), title: '코멘트 액션 이슈' })
  const view = renderMobileRoute('/projects/:key/issues/:number', <IssueDetailPage />, {
    path: `/projects/${KEY}/issues/7`,
    handlers: [
      http.get(`/api/v1/projects/${KEY}`, () => HttpResponse.json(createProject({ key: KEY }))),
      http.get(`/api/v1/projects/${KEY}/types`, () => HttpResponse.json(systemTypes())),
      http.get(`/api/v1/projects/${KEY}/issues`, () => HttpResponse.json(createIssueSearchResponse([], null))),
      http.get(BASE, () => HttpResponse.json(createIssueDetail({ summary: issue, body: '본문', comments }))),
      ...['watchers', 'labels', 'attachments', 'drive-links'].map((s) => http.get(`${BASE}/${s}`, () => HttpResponse.json([]))),
      http.get(`${BASE}/chat/thread`, () => HttpResponse.json(createChatThread({ threadId: 999, recentMessages: [] }))),
      http.get(`/api/v1/issues/${ISSUE_ID}/comments`, () => HttpResponse.json(comments)),
      http.delete(`/api/v1/issues/${ISSUE_ID}/comments/:id`, ({ params }) => {
        deletes.push(Number(params.id))
        comments = comments.filter((c) => c.id !== Number(params.id))
        return new HttpResponse(null, { status: 204 })
      }),
    ],
  })
  await screen.findByTestId('issue-title-heading')
  return { ...view, deletes }
}

// 바로 지우지 않고 확인창을 거친다 — 취소면 요청 없이 유지, 확인이면 DELETE 후 목록에서 사라진다.
test('내 코멘트 — ⋯ → 삭제는 확인창에서 취소하면 유지, 확인하면 DELETE 후 사라진다', async () => {
  const { user, deletes } = await open([createComment({ id: 10, issueId: ISSUE_ID, authorId: 1, body: '내 코멘트 원본' })])
  await user.click(await screen.findByTestId('issue-comment-more-10'))
  await user.click(within(await screen.findByTestId('issue-comment-sheet')).getByTestId('mobile-action-delete'))
  const dialog = await screen.findByRole('alertdialog')
  expect(screen.queryByTestId('issue-comment-sheet')).not.toBeInTheDocument()
  await user.click(within(dialog).getByRole('button', { name: '취소' }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  expect(deletes).toHaveLength(0)
  expect(screen.getByText('내 코멘트 원본')).toBeInTheDocument()

  await user.click(screen.getByTestId('issue-comment-more-10'))
  await user.click(within(await screen.findByTestId('issue-comment-sheet')).getByTestId('mobile-action-delete'))
  await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: '삭제' }))
  await waitFor(() => expect(deletes).toEqual([10]))
  await waitFor(() => expect(screen.queryByText('내 코멘트 원본')).not.toBeInTheDocument())
})

// 남의 코멘트에는 ⋯ 가 없다(수정·삭제는 작성자만) — 권한 분기.
test('남의 코멘트에는 ⋯ 메뉴가 없다', async () => {
  await open([createComment({ id: 11, issueId: ISSUE_ID, authorId: 999, body: '다른 사람 코멘트' })])
  expect(await screen.findByText('다른 사람 코멘트')).toBeInTheDocument()
  expect(screen.queryByTestId('issue-comment-more-11')).not.toBeInTheDocument()
})
