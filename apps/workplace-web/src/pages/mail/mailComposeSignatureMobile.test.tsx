// 메일 작성창 서명(WP-1517) — 모바일 화면 테스트. 상단 바 펜(🗑 와 📎 사이)의 빼기·넣기와, 서명이 없을 때 「서명 설정」이
// 화면 전체 작성창을 저장하고 닫은 뒤 설정으로 옮기는지를 본다. 데스크톱은 mailComposeSignature.test.tsx(한 파일 한 뷰포트). 새 창으로 열기(WP-1535)가 모바일에 없는지도 여기서 본다.
import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse, type RequestHandler } from 'msw'
import { expect, test } from 'vitest'

import { record, renderMail } from '@/test/kits/mail/testkit-b4'
import { mockViewport } from '@/test/viewport'
import type { MailSignature } from '@/types/mailSignature'

import { detail, summary } from '../../../e2e/factories/mail.factory'
import { createMailSignature } from '../../../e2e/factories/mailSignature.factory'

mockViewport()

/** 모바일 메일 헤더의 종 — 안 읽은 알림 수(기본 0). */
const BELL = http.get('/api/v1/notifications/unread-count', () => HttpResponse.json({ count: 0 }))

/** 서명 설정 + 원문 5 를 둔 메일함 — 모바일엔 편지쓰기 사이드바가 접혀 있어 답장으로 작성창을 연다. */
function renderMobile(over: Partial<MailSignature>, extra: RequestHandler[] = []) {
  return renderMail('/mail/1', {
    handlers: [
      ...extra,
      BELL,
      http.get('/api/v1/mail/signature', () => HttpResponse.json(createMailSignature(over))),
      http.get('/api/v1/mail/accounts/1/messages', () => HttpResponse.json([summary({ id: 5, fromAddress: 'alice@example.com', subject: '원문' })])),
      http.get('/api/v1/mail/messages/5', () =>
        HttpResponse.json(detail({ id: 5, threadId: 't1', messageId: 'orig@x', fromAddress: 'alice@example.com', subject: '원문', bodyText: '원문 본문', bodyHtml: null, attachments: [] })),
      ),
    ],
  })
}

async function openReply(view: ReturnType<typeof renderMobile>) {
  await view.user.click(await screen.findByTestId('mail-row-5'))
  await view.user.click(await screen.findByTestId('mail-reply'))
  await screen.findByTestId('mail-composer-body')
}

test('모바일_상단_바에_펜이_있고_빼기_넣기가_된다', async () => {
  const view = renderMobile({ html: '<p>홍길동</p>', autoReply: true })
  await openReply(view)
  await screen.findByTestId('mail-signature-block')
  const pen = () => screen.getByTestId('mail-compose-signature')
  expect(pen()).toHaveAttribute('aria-label', '서명 빼기')
  expect(pen().className).toMatch(/(?<![:\w-])text-primary/)
  // 상단 바 🗑 와 📎 사이.
  const order = Array.from(document.querySelectorAll('[data-testid="mail-compose-discard"], [data-testid="mail-compose-signature"], [data-testid="mail-compose-attach"]')).map((el) => el.getAttribute('data-testid'))
  expect(order).toEqual(['mail-compose-discard', 'mail-compose-signature', 'mail-compose-attach'])

  await view.user.click(pen())
  await waitFor(() => expect(screen.queryByTestId('mail-signature-block')).not.toBeInTheDocument())
  expect(pen()).toHaveAttribute('aria-label', '서명 넣기')
  expect(pen().className).toMatch(/(?<![:\w-])text-foreground/)
  await view.user.click(pen())
  expect(await screen.findByTestId('mail-signature-block')).toBeInTheDocument()
  expect(pen()).toHaveAttribute('aria-label', '서명 빼기')
})

test('모바일_서명_없음_안내는_작성창을_저장하고_닫은_뒤_이동한다', async () => {
  const drafts = record('post', '/api/v1/mail/drafts', () => HttpResponse.json({ id: 77, version: 1, updatedAt: '2026-10-21T01:00:00Z' }))
  const view = renderMobile({ html: '' }, [drafts.handler])
  await view.user.click(await screen.findByTestId('mail-row-5'))
  await view.user.click(await screen.findByTestId('mail-reply'))
  await view.user.click(await screen.findByTestId('mail-composer-body'))
  await view.user.keyboard('쓰던 답장')
  await view.user.click(screen.getByTestId('mail-compose-signature'))
  await view.user.click(await screen.findByRole('button', { name: '서명 설정' }))
  await waitFor(() => expect(drafts.calls).toHaveLength(1))
  await waitFor(() => expect(view.location()).toBe('/settings/mail'))
  expect(screen.queryByTestId('mail-compose-dock')).not.toBeInTheDocument()
})

// 새 창으로 열기(WP-1535)는 데스크톱 전용 — 모바일 작성은 화면 전체 시트라 ↗ 가 없다(데스크톱은 mailComposePopout.test.tsx).
test('모바일_작성창엔_새_창으로_열기가_없다', async () => {
  const view = renderMobile({ html: '' })
  await openReply(view)
  expect(screen.getByTestId('mail-compose-send')).toBeInTheDocument()
  expect(screen.queryByTestId('mail-compose-popout')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '새 창으로 열기' })).not.toBeInTheDocument()
})
