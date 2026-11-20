// 메일 예약 보내기(WP-1787) — 모바일 작성창 상단 바 ⋯ → 예약 보내기 시트 화면 테스트(한 파일 한 뷰포트).
import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { record, renderMail } from '@/test/kits/mail/testkit-b4'
import { mockViewport } from '@/test/viewport'

import { detail, summary } from '../../../e2e/factories/mail.factory'

mockViewport()

const BELL = http.get('/api/v1/notifications/unread-count', () => HttpResponse.json({ count: 0 }))

test('모바일_상단_바_더보기에서_예약_보내기를_고르면_sendAt_이_실려_나간다', async () => {
  const send = record<{ sendAt?: string }>('post', '/api/v1/mail/accounts/1/send', () =>
    HttpResponse.json({ draftId: 900, sendAt: '2026-11-19T00:00:10Z' }),
  )
  const view = renderMail('/mail/1', {
    handlers: [
      send.handler,
      BELL,
      http.get('/api/v1/mail/accounts/1/messages', () => HttpResponse.json([summary({ id: 5, fromAddress: 'alice@example.com', subject: '원문' })])),
      http.get('/api/v1/mail/messages/5', () =>
        HttpResponse.json(detail({ id: 5, threadId: 't1', messageId: 'orig@x', fromAddress: 'alice@example.com', subject: '원문', bodyText: '원문 본문', bodyHtml: null, attachments: [] })),
      ),
    ],
  })
  await view.user.click(await screen.findByTestId('mail-row-5'))
  await view.user.click(await screen.findByTestId('mail-reply'))
  await screen.findByTestId('mail-composer-body')
  await view.user.click(screen.getByTestId('mail-compose-schedule-trigger'))
  await view.user.click(await screen.findByRole('menuitem', { name: '예약 보내기' }))
  const sheet = await screen.findByTestId('mail-schedule-sheet')
  expect(sheet).toHaveTextContent('내일 오전 9:00')
  await view.user.click(await screen.findByTestId('mail-schedule-preset-tomorrow'))
  await waitFor(() => expect(send.calls).toHaveLength(1))
  expect(new Date(send.calls[0].body.sendAt as string).getHours()).toBe(9)
})
