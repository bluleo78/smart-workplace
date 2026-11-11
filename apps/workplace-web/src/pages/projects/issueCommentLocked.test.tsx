// 이슈 상세 댓글 입력 잠금(WP-1495) — viewerCanComment 가 false 면 입력 대신 안내, true 면 입력. 데스크톱(목록 아래 입력).
import { screen } from '@testing-library/react'
import { expect, test } from 'vitest'

import { renderIssueDetailScreen } from '@/test/kits/projects/issueDetailScreen'
import { issueDetailHandlers } from '@/test/kits/projects/issueDetailStubs'
import { SCREEN_LOAD_TIMEOUT } from '@/test/kits/projects/routeScreen'

import { createIssue, createIssueDetail } from '../../../e2e/factories/issue.factory'


const KEY = 'PROJ'
const NOTICE = '이 프로젝트 멤버만 댓글을 달 수 있어요'

function renderDetail(viewerCanComment: boolean) {
  return renderIssueDetailScreen(`/projects/${KEY}/issues/1`, {
    handlers: issueDetailHandlers({ key: KEY, detail: createIssueDetail({ summary: createIssue({ projectKey: KEY }), viewerCanComment }) }),
  })
}

test('댓글 권한이 없으면 입력 대신 안내를 보인다', async () => {
  renderDetail(false)
  expect(await screen.findByTestId('comment-locked-notice', {}, { timeout: SCREEN_LOAD_TIMEOUT })).toHaveTextContent(NOTICE)
  expect(screen.queryByLabelText('코멘트 작성')).not.toBeInTheDocument()
})

test('댓글 권한이 있으면 입력이 보이고 안내는 없다', async () => {
  renderDetail(true)
  expect(await screen.findByLabelText('코멘트 작성', {}, { timeout: SCREEN_LOAD_TIMEOUT })).toBeInTheDocument()
  expect(screen.queryByTestId('comment-locked-notice')).not.toBeInTheDocument()
})
