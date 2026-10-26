// 모바일 U5 스크린리더용 「메시지 작업」 버튼(A1) — 페이지 테스트(WP-981).
// 이슈 채팅에서 본인 메시지의 버튼이 수정·삭제가 있는 시트를 여는 것(작성자에 따른 조건부 렌더)은 브라우저 없이 판정되므로
// e2e/pages/mobile/uiux-u5.spec.ts 에서 옮겼다. 포커스 복원(@input)·클립보드(@platform)·히스토리 앞으로가기(@platform)는 E2E 에 남는다.
import { screen, within } from '@testing-library/react'
import { expect, test } from 'vitest'

import { ISSUE_KEY, issueChatHandlers } from '@/test/kits/mobile/chatHistory'
import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'
import { mockViewport } from '@/test/viewport'

mockViewport()

test('이슈 채팅: 본인 메시지 버튼은 수정·삭제가 있는 시트를 연다(aria-haspopup=dialog)', async () => {
  const { user } = renderPage(`/projects/${ISSUE_KEY}/issues/1?chat=1`, { handlers: issueChatHandlers() })
  const own = await screen.findByTestId('chat-message-502', {}, { timeout: PAGE_LOAD_TIMEOUT })
  const button = within(own).getByRole('button', { name: '메시지 작업' })
  expect(button).toHaveAttribute('aria-haspopup', 'dialog')
  await user.click(button)
  const sheet = await screen.findByTestId('message-action-sheet')
  expect(within(sheet).getByTestId('message-action-edit')).toBeInTheDocument()
  expect(within(sheet).getByTestId('message-action-delete')).toBeInTheDocument()
})
