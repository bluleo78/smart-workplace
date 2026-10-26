// 이슈 코멘트 이미지(WP-362) — 목록 이미지 → 뷰어, 삭제 확인창의 이미지 수 안내 — 페이지 테스트(WP-980).
// 클릭 → 대화상자 열림과 확인창 문구(이미지 수·[이미지] 줄임)는 브라우저 없이 판정되므로
// e2e/pages/projects/issue-comment-images.spec.ts 에서 옮겼다. 입력창 안 이미지(붙여넣기·파일 선택·Backspace 삭제)는 E2E(@input)에 남는다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { beforeAll, expect, test } from 'vitest'

import { openIssueDetail } from '@/test/kits/projects/issueDetailStubs'

import { createComment, createIssueDetail } from '../../../e2e/factories/issue.factory'

const IMG_URL = '/api/v1/projects/WP/issue-images/77'

// 본문 이미지는 인증 요청으로 받은 blob 을 objectURL 로 그린다 — jsdom 엔 createObjectURL 이 없어 가짜 URL 을 준다(픽셀 렌더는 관심사가 아니다).
beforeAll(() => {
  if (!URL.createObjectURL) URL.createObjectURL = () => 'blob:fake'
  if (!URL.revokeObjectURL) URL.revokeObjectURL = () => {}
})

const withImage = () => createComment({ id: 40, issueId: 100, authorId: 1, body: `재현 화면\n![bug.png](${IMG_URL})\n확인 부탁` })

const imageHandler = http.get(IMG_URL, () => new HttpResponse(new Uint8Array([137, 80, 78, 71]), { headers: { 'Content-Type': 'image/png' } }))

/** 코멘트 목록의 첫 항목. */
const firstComment = () => within(screen.getByRole('region', { name: '코멘트' })).getAllByRole('listitem')[0]

test('코멘트 본문 이미지를 누르면 뷰어 대화상자로 크게 열린다', async () => {
  const { user } = await openIssueDetail({ detail: createIssueDetail({ comments: [withImage()] }), handlers: [imageHandler] })
  // 인증 blob 을 받기 전엔 자리표시(span role=img)다 — 실제 <img> 로 바뀐 뒤 누른다.
  await waitFor(() => expect(within(firstComment()).getByRole('img', { name: 'bug.png' }).tagName).toBe('IMG'))
  await user.click(within(firstComment()).getByRole('img', { name: 'bug.png' }))
  expect(await screen.findByRole('dialog')).toBeInTheDocument()
})

test('삭제 확인창이 함께 지워질 이미지 수를 알리고, 미리보기는 URL 대신 [이미지] 로 줄인다', async () => {
  const { user } = await openIssueDetail({ detail: createIssueDetail({ comments: [withImage()] }), handlers: [imageHandler] })
  await user.click(within(firstComment()).getByRole('button', { name: '코멘트 삭제' }))
  const dialog = await screen.findByRole('alertdialog')
  expect(dialog).toHaveTextContent('이미지 1개도 본문이나 다른 코멘트에서 쓰지 않으면 함께 삭제됩니다')
  expect(dialog).toHaveTextContent('[이미지]')
  expect(dialog).not.toHaveTextContent('issue-images')
})
