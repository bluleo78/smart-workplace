// 연락처 2단(데스크톱 폭) 딥링크 상세와 필터(WP-206) — 페이지 테스트(WP-971).
// 상세를 연 채 필터를 바꾸면 contact 키가 함께 지워지는 것은 URL 상태라 브라우저 없이 판정되므로
// e2e/pages/mobile/back-contacts.spec.ts 에서 옮겼다. 뷰포트를 바꾸지 않는다(jsdom 기본 = 데스크톱 폭).
import { screen, waitFor } from '@testing-library/react'
import { expect, test } from 'vitest'

import { contactHandlers } from '@/test/kits/mobile/contacts'
import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'

// 필터를 바꾸면 이전 필터 결과에서 고른 상세는 더 이상 유효하지 않으므로 contact 키를 지우고 빈 상세로 돌아간다.
test('딥링크 상세에서 필터를 바꾸면 contact 키가 함께 지워진다', async () => {
  const { user, location } = renderPage('/contacts?contact=member:1', { handlers: contactHandlers() })
  expect(await screen.findByTestId('contact-detail-member', {}, { timeout: PAGE_LOAD_TIMEOUT })).toBeInTheDocument()
  await user.click(screen.getByTestId('contact-filter-EXTERNAL'))
  await waitFor(() => expect(location()).toBe('/contacts?type=EXTERNAL'))
  expect(await screen.findByTestId('contact-detail-empty')).toBeInTheDocument()
})
