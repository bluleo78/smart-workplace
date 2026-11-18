// 작성창 원문 블록의 지난 원문 접기(WP-1747) — 컴포넌트 단독으로 본다.
// 원본(raw) 원문을 먼저 자르고 조각마다 cid 이미지를 치환하는지, 지난 원문 프레임 높이·aria-controls,
// 원문이 바뀌면 지난 원문 펼침이 접힘으로 돌아가는지 확인한다.
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import type { QuoteInlineImage } from '@/lib/mailInlineImages'
import { server } from '@/test/msw/server'
import { renderWithProviders } from '@/test/renderWithProviders'

import { MailQuoteBlock } from './MailQuoteBlock'

/** 우리 감싸기 안에 바로 앞 원문과 Gmail 지난 원문 한 통. */
function threadQuote(recent: string, older: string): string {
  return (
    `<div class="wp_quote gmail_quote"><hr><div><b>보낸 사람:</b> a</div><br>${recent}` +
    `<div class="gmail_quote">${older}</div></div>`
  )
}

const META = { from: '홍길동', dateShort: '11/18', subject: 'Re: 회의' }

function block(quoteHtml: string, inlineImages: QuoteInlineImage[] = []) {
  return (
    <MailQuoteBlock quoteHtml={quoteHtml} meta={META} variant="reply" onRemove={() => {}} inlineImages={inlineImages} />
  )
}

function image(id: number, contentId: string): QuoteInlineImage {
  return {
    contentId,
    attachment: { id, filename: `${contentId}.png`, contentType: 'image/png', sizeBytes: 3, contentId: `<${contentId}>` },
  }
}

const toggle = () => screen.getByTestId('mail-compose-quote-older-toggle')

test('지난 원문 프레임은 바로 앞 원문 프레임보다 높고, 단추의 aria-controls 가 펼친 영역을 가리킨다', async () => {
  const user = userEvent.setup()
  renderWithProviders(block(threadQuote('<p>최근</p>', '<p>지난</p>')))

  expect(screen.getByTestId('mail-compose-quote-frame')).toHaveClass('h-40')
  await user.click(toggle())
  const older = await screen.findByTestId('mail-compose-quote-older-frame')
  expect(older).toHaveClass('h-64')
  const controls = toggle().getAttribute('aria-controls')
  expect(controls).toBeTruthy()
  expect(document.getElementById(controls!)).toContainElement(older)

  // 「전체 높이」에서도 지난 원문 쪽이 더 높다
  await user.click(screen.getByRole('button', { name: '전체 높이' }))
  expect(screen.getByTestId('mail-compose-quote-frame')).toHaveClass('h-64')
  expect(screen.getByTestId('mail-compose-quote-older-frame')).toHaveClass('h-96')
})

test('원문이 바뀌면 펼쳐 둔 지난 원문은 다시 접힌다', async () => {
  const user = userEvent.setup()
  const view = renderWithProviders(block(threadQuote('<p>최근</p>', '<p>지난</p>')))
  await user.click(toggle())
  await screen.findByTestId('mail-compose-quote-older-frame')

  view.rerender(block(threadQuote('<p>다른 최근</p>', '<p>다른 지난</p>')))
  expect(toggle()).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByTestId('mail-compose-quote-older-frame')).not.toBeInTheDocument()
})

test('원본 원문을 먼저 자르고 조각마다 cid 이미지를 치환한다 — 접힌 지난 원문 이미지는 펼칠 때 받는다', async () => {
  const fetched: string[] = []
  server.use(
    http.get('/api/v1/mail/attachments/:id/content', ({ params }) => {
      fetched.push(String(params.id))
      return new HttpResponse(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/png' } })
    }),
  )
  const user = userEvent.setup()
  renderWithProviders(
    block(
      threadQuote('<p>최근</p><img src="cid:recent@x">', '<p>지난</p><img src="cid:older@x">'),
      [image(1, 'recent@x'), image(2, 'older@x')],
    ),
  )

  await waitFor(() =>
    expect(screen.getByTestId('mail-compose-quote-frame').getAttribute('srcdoc')).toContain('data:image/png'),
  )
  expect(fetched).toEqual(['1'])

  await user.click(toggle())
  await waitFor(() =>
    expect(screen.getByTestId('mail-compose-quote-older-frame').getAttribute('srcdoc')).toContain('data:image/png'),
  )
  expect(fetched).toEqual(['1', '2'])
})
