// 메일 작성창 모바일 화면 테스트(한 파일 한 뷰포트) — 기밀 토글(WP-2029). 데스크톱 판정은 mailCompose.test.tsx.
import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { renderMail } from '@/test/kits/mail/testkit-b4'
import { mockViewport } from '@/test/viewport'

import { detail, summary } from '../../../e2e/factories/mail.factory'

mockViewport()

/** 모바일 메일 헤더의 종 — 안 읽은 알림 수(기본 0). */
const BELL = http.get('/api/v1/notifications/unread-count', () => HttpResponse.json({ count: 0 }))

test('모바일 작성 화면에도 「기밀」 토글이 있고 누르면 켜진다(WP-2029)', async () => {
  const view = renderMail('/mail/1', {
    handlers: [
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
  const toggle = screen.getByRole('button', { name: '기밀' })
  expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await view.user.click(toggle)
  expect(toggle).toHaveAttribute('aria-pressed', 'true')
})
