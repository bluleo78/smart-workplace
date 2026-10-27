// WP-106 모바일 반응 칩 짧은 탭 — 페이지 테스트(WP-981).
// 칩을 짧게 탭하면 반응자 시트가 아니라 반응 토글(POST emoji)이 나가는 것은 브라우저 없이 판정되므로
// e2e/pages/mobile/reaction-reactors.spec.ts 에서 옮겼다. 길게 누르기(@input)와 시트 높이·스크롤(@layout)은 E2E 에 남는다.
// 앱 셸을 보지 않으므로 채널 화면만 renderScreen 으로 띄운다(WP-1002).
import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { channelMessageHandlers } from '@/test/kits/mobile/chatHistory'
import { renderMobileRoute } from '@/test/kits/mobile/mobileScreen'
import { mockViewport } from '@/test/viewport'

import { createMessage, createReaction } from '../../../e2e/factories/messaging.factory'
import ChannelPage from '../chat/ChannelPage'

mockViewport()

const MSG = 10

test('칩 짧은 탭은 그대로 토글 — 반응자 시트는 열리지 않는다', async () => {
  const msg = createMessage({
    id: MSG, channelId: 1, authorId: 20, authorName: '동료', body: '배포 끝났습니다', createdAt: '2026-09-30T03:00:00Z',
    reactions: [createReaction({ emoji: '👍', count: 2, reacted: true }), createReaction({ emoji: '🎉', count: 1, reacted: false })],
  })
  const posts: unknown[] = []
  const { user } = renderMobileRoute('/chat/channels/:id', <ChannelPage />, {
    path: '/chat/channels/1',
    handlers: [
      ...channelMessageHandlers([msg]),
      http.post(`/api/v1/messaging/messages/${MSG}/reactions`, async ({ request }) => {
        posts.push(await request.json())
        return new HttpResponse(null, { status: 204 })
      }),
    ],
  })
  await user.click(await screen.findByTestId(`reaction-pill-${MSG}-🎉`))
  await waitFor(() => expect(posts).toEqual([expect.objectContaining({ emoji: '🎉' })]))
  expect(screen.queryByTestId('reactors-sheet')).not.toBeInTheDocument()
})
