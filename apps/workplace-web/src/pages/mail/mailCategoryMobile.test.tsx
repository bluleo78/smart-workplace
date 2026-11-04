// 메일 분류 직접 바꾸기(WP-1341) — 휴대폰 화면 테스트.
// 상세 ⋯ 메뉴와 목록 길게 누르기(contextmenu 로 연다) 시트의 「분류 바꾸기」 → 분류 시트(「나에게만 적용돼요」·5종·현재 ✓) → PUT 본문을 본다.
// 길게 누르기 자체의 시간 판정은 이 파일의 관심사가 아니다(hooks/useMessageListLongPress). 한 파일 한 뷰포트라 데스크톱 판정과 나눴다.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { record, renderMail } from '@/test/kits/mail/testkit-b4'
import { mockViewport } from '@/test/viewport'

import { detail, summary } from '../../../e2e/factories/mail.factory'

mockViewport()

const LIST = '/api/v1/mail/accounts/1/messages'
// 휴대폰 메일 머리줄의 🔔 가 부르는 안 읽은 알림 수 — 이 파일의 관심사가 아니라 0 으로 둔다.
const BELL = http.get('/api/v1/notifications/unread-count', () => HttpResponse.json({ count: 0 }))

/** PUT 분류 — 바꾼 값을 그대로 돌려준다(학습 없음). */
function putCategory() {
  return record<{ category: string | null }>('put', '/api/v1/mail/messages/10/category', ({ body }) =>
    HttpResponse.json({ aiCategory: body.category, categoryByMe: body.category != null, learnable: false }),
  )
}

test('mobile sheet lists five categories with 나에게만 적용돼요', async () => {
  const put = putCategory()
  const { user } = renderMail('/mail/1?messageId=10', {
    handlers: [
      BELL,
      put.handler,
      http.get(LIST, () => HttpResponse.json([summary({ id: 10, seen: true, aiCategory: '뉴스레터' })])),
      http.get('/api/v1/mail/messages/10', () =>
        HttpResponse.json(detail({ id: 10, seen: true, aiCategory: '뉴스레터', categoryByMe: false })),
      ),
    ],
  })
  await user.click(await screen.findByRole('button', { name: '메일 메뉴' }))
  await user.click(screen.getByTestId('mail-category'))
  const sheet = await screen.findByTestId('mail-category-sheet')
  expect(within(sheet).getByText('분류 바꾸기')).toBeInTheDocument()
  expect(within(sheet).getByText('나에게만 적용돼요')).toBeInTheDocument()
  const options = within(sheet).getAllByRole('menuitemcheckbox')
  expect(options.map((o) => o.textContent)).toEqual(['업무', '개인', '알림', '프로모션', '뉴스레터'])
  expect(options[4]).toHaveAttribute('aria-checked', 'true')
  // 직접 바꾼 분류가 아니면 되돌리기 항목이 없다.
  expect(within(sheet).queryByText('AI 분류로 되돌리기')).not.toBeInTheDocument()
  await user.click(options[0])
  await waitFor(() => expect(put.calls).toHaveLength(1))
  expect(put.last().body).toEqual({ category: '업무' })
  expect(await screen.findByText('분류를 업무로 바꿨어요')).toBeInTheDocument()
  await waitFor(() => expect(screen.queryByTestId('mail-category-sheet')).not.toBeInTheDocument())
})

test('long-press sheet opens the category sheet with revert item when categoryByMe', async () => {
  const put = putCategory()
  const { user } = renderMail('/mail/1', {
    handlers: [
      BELL,
      put.handler,
      http.get(LIST, () => HttpResponse.json([summary({ id: 10, seen: true, aiCategory: '업무', categoryByMe: true })])),
    ],
  })
  // 길게 누르기와 같은 시트를 여는 contextmenu(안드로이드 길게 터치)로 연다.
  fireEvent.contextMenu(await screen.findByTestId('mail-row-10'))
  await user.click(await screen.findByRole('button', { name: '분류 바꾸기' }))
  const sheet = await screen.findByTestId('mail-category-sheet')
  expect(within(sheet).getByRole('menuitemcheckbox', { name: '업무' })).toHaveAttribute('aria-checked', 'true')
  await user.click(within(sheet).getByRole('menuitem', { name: 'AI 분류로 되돌리기' }))
  await waitFor(() => expect(put.calls).toHaveLength(1))
  expect(put.last().body).toEqual({ category: null })
})

test('mobile sheet: picking the current category closes the sheet without saving', async () => {
  const put = putCategory()
  const { user } = renderMail('/mail/1?messageId=10', {
    handlers: [
      BELL,
      put.handler,
      http.get(LIST, () => HttpResponse.json([summary({ id: 10, seen: true, aiCategory: '뉴스레터' })])),
      http.get('/api/v1/mail/messages/10', () =>
        HttpResponse.json(detail({ id: 10, seen: true, aiCategory: '뉴스레터', categoryByMe: false })),
      ),
    ],
  })
  await user.click(await screen.findByRole('button', { name: '메일 메뉴' }))
  await user.click(screen.getByTestId('mail-category'))
  const sheet = await screen.findByTestId('mail-category-sheet')
  await user.click(within(sheet).getByRole('menuitemcheckbox', { name: '뉴스레터' }))
  await waitFor(() => expect(screen.queryByTestId('mail-category-sheet')).not.toBeInTheDocument())
  expect(put.calls).toHaveLength(0)
  expect(screen.queryByText(/분류를 .* 바꿨어요/)).not.toBeInTheDocument()
})
