// 모바일 U4 메시지 작업 시트(WP-665) — 페이지 테스트(WP-981).
// 삭제된 메시지의 작업 시트에 이모지 줄이 없다는 조건부 렌더는 브라우저 없이 판정되므로 e2e/pages/mobile/uiux-u4.spec.ts 에서 옮겼다.
// 시트는 스크린리더용 「메시지 작업」 버튼(A1)으로 연다 — 길게 누르기와 같은 시트이고, 길게 누르기 입력 자체(@input)는 E2E 에 남는다.
import { screen, waitFor, within } from '@testing-library/react'
import { expect, test } from 'vitest'

import { channelMessageHandlers } from '@/test/kits/mobile/chatHistory'
import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'
import { mockViewport } from '@/test/viewport'

import { createMessage } from '../../../e2e/factories/messaging.factory'

// 터치 셸 — 툴바 대신 작업 시트를 쓰는 조건.
mockViewport()

test('삭제된 메시지의 작업 시트엔 이모지 줄이 없고 스레드 작업만 남는다 (WP-665)', async () => {
  const deleted = createMessage({
    id: 30, channelId: 1, authorId: 20, authorName: '동료', body: '(삭제됨)', deleted: true, replyCount: 1, createdAt: '2026-09-30T03:00:00Z',
  })
  const { user } = renderPage('/chat/channels/1', { handlers: channelMessageHandlers([deleted]) })
  const row = await screen.findByTestId('message-30', {}, { timeout: PAGE_LOAD_TIMEOUT })
  await user.click(within(row).getByRole('button', { name: '메시지 작업' }))
  const sheet = await screen.findByTestId('message-action-sheet')
  await waitFor(() => expect(within(sheet).getByTestId('message-action-thread')).toBeInTheDocument())
  expect(within(sheet).queryByTestId('message-action-react-👍')).not.toBeInTheDocument()
  expect(within(sheet).queryByTestId('message-action-react-more')).not.toBeInTheDocument()
})
