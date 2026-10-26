// 모바일 연락처 상세 딥링크(?contact=member:<id>|external:<id>)(WP-206) — 페이지 테스트(WP-971).
// 딥링크로 연 상세에서 ‹ 를 누르면 ?contact 만 지워 목록으로 돌아오는 것, 404 는 찾을 수 없음 안내가 되는 것은
// URL 상태·조건부 렌더라 브라우저 없이 판정되므로 e2e/pages/mobile/back-contacts.spec.ts 에서 옮겼다.
// 브라우저 뒤로가기(goBack)가 상세만 닫는 것(@platform)은 E2E 에 남는다.
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'

import { contactHandlers } from '@/test/kits/mobile/contacts'
import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'
import { mockViewport } from '@/test/viewport'

// 모바일(iPhone 13 폭·터치) — matchMedia 결과가 파일 안에서 캐시되므로 첫 렌더 전에 한 번.
mockViewport()

describe('모바일 연락처 상세 딥링크', () => {
  // 외부 연락처 딥링크 → 상세 → ‹ 는 /contacts 로 돌아가 목록을 보인다(쿼리가 남거나 다른 화면으로 가면 실패).
  test('딥링크(?contact=external) 진입 후 ‹ → 연락처 목록', async () => {
    const { user, location } = renderPage('/contacts?contact=external:100', { handlers: contactHandlers() })
    expect(await screen.findByTestId('contact-detail-external', {}, { timeout: PAGE_LOAD_TIMEOUT })).toBeInTheDocument()
    await user.click(within(screen.getByTestId('contact-back')).getByTestId('mobile-back'))
    await waitFor(() => expect(location()).toBe('/contacts'))
    expect(await screen.findByTestId('contact-list')).toBeInTheDocument()
  })

  // 404 는 빈 상세가 아니라 「찾을 수 없거나 볼 수 없습니다」 안내(WP-555)이고, ‹ 로 닫힌다.
  test('없는 연락처 딥링크는 찾을 수 없음 상태를 보이고 ‹ 로 닫힌다', async () => {
    const { user, location } = renderPage('/contacts?contact=member:999', { handlers: contactHandlers() })
    expect(await screen.findByTestId('contact-detail-not-found', {}, { timeout: PAGE_LOAD_TIMEOUT })).toBeInTheDocument()
    await user.click(within(screen.getByTestId('contact-back')).getByTestId('mobile-back'))
    await waitFor(() => expect(location()).toBe('/contacts'))
  })
})
