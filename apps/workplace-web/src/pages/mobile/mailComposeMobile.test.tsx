// 모바일 메일 작성(WP-583) — 페이지 테스트(WP-971).
// 회신·전달 제목, 쓴 내용이 없을 때 ✕ 가 바로 닫는 것, 받는사람만 고쳐도 ✕ 가 임시저장하는 것은
// 브라우저 없이 판정되므로 e2e/pages/mobile/mail-compose-mobile.spec.ts 에서 옮겼다.
// 화면 전체 덮기·서식 줄 위치·44px(@layout), 시스템 뒤로가기(@platform), 발송 배선 1건(@wiring)은 E2E 에 남는다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'
import { mockViewport } from '@/test/viewport'

import { detail, mailAccount, summary } from '../../../e2e/factories/mail.factory'

// 모바일(iPhone 13·터치) — 파일 안 첫 renderPage 전에 한 번.
mockViewport()

/** 받은편지함·메일 10 상세 — 임시저장 POST 본문은 drafts 에 쌓는다. */
function mailApi() {
  const drafts: unknown[] = []
  const handlers = [
    http.get('/api/v1/mail/accounts', () => HttpResponse.json([mailAccount()])),
    http.get('/api/v1/mail/accounts/1/messages', () => HttpResponse.json([summary()])),
    http.get('/api/v1/mail/messages/10', () => HttpResponse.json(detail())),
    // 화면이 함께 부르는 부가 조회 — 이 테스트는 보지 않으므로 빈 값·없음으로 둔다.
    http.get('/api/v1/mail/accounts/1/unread-counts', () =>
      HttpResponse.json({ classificationActive: false, inbox: 0, byCategory: {}, needsReply: 0 }),
    ),
    http.get('/api/v1/mail/messages/10/summary', () => new HttpResponse(null, { status: 404 })),
    http.get('/api/v1/mail/recent-recipients', () => HttpResponse.json([])),
    http.post('/api/v1/mail/drafts', async ({ request }) => {
      drafts.push(await request.json())
      return HttpResponse.json({ id: 900 })
    }),
  ]
  return { handlers, drafts }
}

/** 받은편지함에서 메일 10 을 열고 회신/전달 버튼이 뜰 때까지 기다린다. */
async function openMail() {
  const api = mailApi()
  const page = renderPage('/mail/1', { handlers: api.handlers })
  await page.user.click(await screen.findByTestId('mail-row-10', {}, { timeout: PAGE_LOAD_TIMEOUT }))
  await screen.findByTestId('mail-reply')
  return { ...page, api }
}

// 회신 작성 화면은 제목이 「회신」이고 원문 인용이 붙는다. 아무것도 안 고쳤으면 ✕ 는 묻거나 저장하지 않고 닫는다.
test('회신은 제목이 「회신」, 쓴 내용이 없으면 ✕ 로 바로 닫는다', async () => {
  const { user, api } = await openMail()
  await user.click(screen.getByTestId('mail-reply'))
  const dock = await screen.findByTestId('mail-compose-dock')
  expect(within(dock).getByRole('heading', { name: '회신' })).toBeInTheDocument()
  expect(within(dock).getByTestId('mail-compose-quote')).toBeInTheDocument()
  await user.click(screen.getByTestId('mail-compose-close'))
  await waitFor(() => expect(screen.queryByTestId('mail-compose-dock')).not.toBeInTheDocument())
  // 임시저장은 닫은 뒤 비동기로 나간다 — 「안 나간다」는 잠깐 기다려야 판정된다(부재 확인이라 조건 대기로 못 바꾼다).
  await new Promise((r) => setTimeout(r, 300))
  expect(api.drafts).toEqual([])
})

// 받는사람 칩만 바꿔도 「쓴 내용」으로 봐야 한다 — 놓치면 ✕ 가 고친 주소를 말없이 버린다.
test('받는사람만 고쳐도 쓴 내용으로 본다 — ✕ 가 임시저장한다', async () => {
  const { user, api } = await openMail()
  await user.click(screen.getByTestId('mail-reply'))
  await user.click(await screen.findByRole('button', { name: 'alice@example.com 빼기' }))
  await user.click(screen.getByTestId('mail-compose-to'))
  await user.paste('other@test.local')
  await user.click(screen.getByTestId('mail-compose-close'))
  await waitFor(() => expect(screen.queryByTestId('mail-compose-dock')).not.toBeInTheDocument())
  await waitFor(() => expect(api.drafts).toHaveLength(1))
  expect(api.drafts[0]).toMatchObject({ to: ['other@test.local'] })
})

// 전달 작성 화면의 제목은 「전달」 — 모바일 상단 바가 새 메일/회신/전달을 구분하는 유일한 표시다.
test('전달은 제목이 「전달」이다', async () => {
  const { user } = await openMail()
  await user.click(screen.getByTestId('mail-forward'))
  const dock = await screen.findByTestId('mail-compose-dock')
  expect(within(dock).getByRole('heading', { name: '전달' })).toBeInTheDocument()
})
