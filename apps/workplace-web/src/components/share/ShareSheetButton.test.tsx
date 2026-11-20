// 공유 시트(ShareSheetButton·MobileActionSheet) 닫힘 초점 복귀 (WP-1804) — Esc·바깥 클릭으로 닫으면 초점이 body 로 사라지던 것(WCAG 2.4.3)을 지킨다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { useState } from 'react'
import { expect, test } from 'vitest'

import { MobileActionSheet } from '@/components/mobile/MobileActionSheet'
import type { ShareTarget } from '@/lib/shareTarget'
import { nextFrames } from '@/test/nextFrames'
import { renderScreen } from '@/test/renderScreen'

import { createChannel } from '../../../e2e/factories/messaging.factory'
import { SendToChatHost } from './SendToChatHost'
import { ShareSheetButton } from './ShareSheetButton'

const target: ShareTarget = { kind: 'folder', url: `${window.location.origin}/drive/spaces/3?folderId=4`, title: '디자인 자료' }

test('Esc 로 닫으면 초점이 공유 단추로 돌아온다', async () => {
  const { user } = renderScreen(<ShareSheetButton target={target} />, { path: '/drive/spaces/3?folderId=4' })
  await user.click(screen.getByTestId('mobile-share-button'))
  expect(await screen.findByTestId('share-sheet')).toBeInTheDocument()
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByTestId('share-sheet')).not.toBeInTheDocument())
  await waitFor(() => expect(screen.getByTestId('mobile-share-button')).toHaveFocus())
})

test('항목이 연 대화상자의 초점을 빼앗지 않는다', async () => {
  const { user } = renderScreen(
    <>
      <ShareSheetButton target={target} />
      <SendToChatHost />
    </>,
    {
      path: '/drive/spaces/3?folderId=4',
      handlers: [
        http.get('/api/v1/messaging/channels', () => HttpResponse.json([createChannel({ id: 10, name: '일반' })])),
        http.get('/api/v1/app-links/folders/4', () => HttpResponse.json({ kind: 'FOLDER', title: '디자인 자료', spaceName: '디자인팀' })),
      ],
    },
  )
  await user.click(screen.getByTestId('mobile-share-button'))
  await user.click(await screen.findByTestId('mobile-action-send-to-chat'))
  const dialog = await screen.findByTestId('send-to-chat-dialog')
  await nextFrames()
  expect(dialog.contains(document.activeElement)).toBe(true)
  expect(within(document.body).getByTestId('mobile-share-button')).not.toHaveFocus()
})

test('onCloseAutoFocus 없이 쓰는 시트는 닫아도 초점을 시트를 연 요소로 옮기지 않는다', async () => {
  function Harness() {
    const [open, setOpen] = useState(false)
    return (
      <>
        <button type="button" data-testid="opener" onClick={() => setOpen(true)}>열기</button>
        <MobileActionSheet open={open} onClose={() => setOpen(false)} title="시트" actions={[]} />
      </>
    )
  }
  const { user } = renderScreen(<Harness />, { path: '/' })
  await user.click(screen.getByTestId('opener'))
  expect(await screen.findByTestId('mobile-action-sheet')).toBeInTheDocument()
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByTestId('mobile-action-sheet')).not.toBeInTheDocument())
  await nextFrames()
  expect(screen.getByTestId('opener')).not.toHaveFocus()
  expect(document.body).toHaveFocus()
})
