// WP-1744 작성 방식 기본값 — 모바일 화면 테스트(한 파일 한 뷰포트). 휴대폰은 기본값과 상관없이 늘 화면 전체 작성이다.
// 데스크톱 판정은 mailComposeDefault.test.tsx.
import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, expect, test, vi } from 'vitest'

import { mailSettingsKey } from '@/hooks/queries/useMailSettings'
import { composeSettingsHandler } from '@/test/kits/mail/compose-default'
import { record, renderMail } from '@/test/kits/mail/testkit-b4'
import { mockViewport } from '@/test/viewport'

import { detail, summary } from '../../../e2e/factories/mail.factory'

mockViewport()

afterEach(() => {
  vi.restoreAllMocks()
})

/** 모바일 메일 헤더의 종 — 안 읽은 알림 수(기본 0). */
const BELL = http.get('/api/v1/notifications/unread-count', () => HttpResponse.json({ count: 0 }))

test('모바일에서는_기본값이_새_창이어도_화면_전체', async () => {
  const open = vi.spyOn(window, 'open')
  const post = record('post', '/api/v1/mail/drafts', () =>
    HttpResponse.json({ id: 101, version: 1, updatedAt: '2026-11-12T00:00:00Z' }, { status: 201 }),
  )
  const view = renderMail('/mail/1', {
    handlers: [
      post.handler,
      BELL,
      composeSettingsHandler('WINDOW'),
      http.get('/api/v1/mail/accounts/1/messages', () => HttpResponse.json([summary({ id: 5, fromAddress: 'alice@example.com', subject: '원문' })])),
      http.get('/api/v1/mail/messages/5', () =>
        HttpResponse.json(detail({ id: 5, threadId: 't1', messageId: 'orig@x', fromAddress: 'alice@example.com', subject: '원문', bodyText: '원문 본문', bodyHtml: null, attachments: [] })),
      ),
    ],
  })
  await waitFor(() => expect(view.queryClient.getQueryData(mailSettingsKey)).toEqual({ composeMode: 'WINDOW' }))
  await view.user.click(await screen.findByTestId('mail-row-5'))
  await view.user.click(await screen.findByTestId('mail-reply'))
  await screen.findByTestId('mail-composer-body')
  // 화면 전체 작성(대화상자) — 새 창을 열지도, 옮기려는 임시저장을 만들지도 않는다.
  const dock = screen.getByTestId('mail-compose-dock')
  expect(dock).toHaveAttribute('role', 'dialog')
  expect(dock).toHaveClass('inset-x-0')
  expect(dock).not.toHaveClass('invisible')
  expect(open).not.toHaveBeenCalled()
  expect(post.calls).toHaveLength(0)
})
