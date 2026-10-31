// 「채팅·이슈로 보내기」 휴대폰 화면(WP-1235) — 전체 화면 [취소 · 제목 · 보내기], 시스템 뒤로 가기로 닫힘. 뷰포트가 파일당 하나라 데스크톱과 나눈다.
import { act, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, expect, test } from 'vitest'

import { closeSendToChat, openSendToChat } from '@/lib/sendToChat'
import type { ShareTarget } from '@/lib/shareTarget'
import { renderScreen } from '@/test/renderScreen'
import { mockViewport } from '@/test/viewport'

import { createChannel } from '../../../e2e/factories/messaging.factory'
import { SendToChatHost } from './SendToChatHost'

mockViewport()

const target: ShareTarget = { kind: 'folder', url: `${window.location.origin}/drive/spaces/3?folderId=4`, title: '디자인 자료' }

function open() {
  const posted: unknown[] = []
  const view = renderScreen(<SendToChatHost />, {
    path: '/drive/spaces/3?folderId=4',
    handlers: [
      http.get('/api/v1/messaging/channels', () => HttpResponse.json([createChannel({ id: 10, name: '일반' })])),
      http.post('/api/v1/messaging/channels/:id/messages', async ({ request }) => {
        posted.push(await request.json())
        return HttpResponse.json({ id: 1 })
      }),
    ],
  })
  act(() => openSendToChat(target))
  return { ...view, posted }
}

afterEach(() => {
  act(() => closeSendToChat())
})

test('전체 화면 머리의 「보내기」로 고른 채널에 폴더 링크를 보낸다', async () => {
  const { user, posted } = open()
  const dialog = await screen.findByTestId('send-to-chat-dialog')
  // 머리 = 취소 · 제목 · 보내기(고르기 전엔 막힘).
  expect(within(dialog).getByRole('heading', { name: '채팅·이슈로 보내기' })).toBeInTheDocument()
  expect(within(dialog).getByTestId('send-to-chat-submit')).toBeDisabled()
  await user.click(within(await screen.findByTestId('send-to-chat-channels')).getByText('일반'))
  expect(screen.getByTestId('send-to-chat-preview')).toHaveTextContent('폴더')
  await user.click(within(dialog).getByTestId('send-to-chat-submit'))
  await waitFor(() => expect(posted).toEqual([{ body: target.url }]))
  await waitFor(() => expect(screen.queryByTestId('send-to-chat-dialog')).not.toBeInTheDocument())
})

test('시스템 뒤로 가기로 닫힌다', async () => {
  open()
  await screen.findByTestId('send-to-chat-dialog')
  act(() => window.history.back())
  await waitFor(() => expect(screen.queryByTestId('send-to-chat-dialog')).not.toBeInTheDocument())
})

test('받는 곳을 고른 뒤 시스템 뒤로 가기는 버림 확인을 띄우고, 「버리기」를 눌러야 닫힌다', async () => {
  const { user } = open()
  await user.click(within(await screen.findByTestId('send-to-chat-channels')).getByText('일반'))
  act(() => window.history.back())
  const confirm = await screen.findByTestId('send-to-chat-discard-dialog')
  expect(screen.getByTestId('send-to-chat-dialog')).toBeInTheDocument()
  // 「계속 쓰기」는 고른 곳을 그대로 둔다.
  await user.click(within(confirm).getByTestId('send-to-chat-discard-keep'))
  await waitFor(() => expect(screen.queryByTestId('send-to-chat-discard-dialog')).not.toBeInTheDocument())
  expect(screen.getByTestId('send-to-chat-destination')).toHaveTextContent('#일반')
  // 다시 뒤로 가기 → 「버리기」로 닫는다.
  act(() => window.history.back())
  await user.click(await screen.findByTestId('send-to-chat-discard-confirm'))
  await waitFor(() => expect(screen.queryByTestId('send-to-chat-dialog')).not.toBeInTheDocument())
})
