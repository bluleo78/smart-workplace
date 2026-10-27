// 모바일 연락처 상세 딥링크(?contact=member:<id>|external:<id>)(WP-206) — 화면 테스트(WP-971, WP-1002).
// 딥링크로 연 상세에서 ‹ 를 누르면 ?contact 만 지워 목록으로 돌아오는 것, 404 는 찾을 수 없음 안내가 되는 것은
// URL 상태·조건부 렌더라 브라우저 없이 판정되므로 e2e/pages/mobile/back-contacts.spec.ts 에서 옮겼다.
// 브라우저 뒤로가기(goBack)가 상세만 닫는 것(@platform)은 E2E 에 남는다.
// 앱 셸을 보지 않으므로 연락처 모듈 레이아웃과 화면만 renderScreen 으로 띄운다.
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'

import { ContactModuleLayout } from '@/components/contacts/ContactModuleLayout'
import { contactHandlers } from '@/test/kits/mobile/contacts'
import { renderMobileModule } from '@/test/kits/mobile/mobileScreen'
import { mockViewport } from '@/test/viewport'

import { ContactsPage } from '../contacts/ContactsPage'
import { emptyTree } from '../contacts/testkit-b8'

/** /contacts 화면(모듈 레이아웃 + 목록·상세) — 모바일 헤더가 AI 버튼(useAssistant)을 읽어 AppLayout 상태 Provider 와 함께 띄운다. */
function renderContacts(path: string) {
  return renderMobileModule(<ContactModuleLayout />, [['/contacts', <ContactsPage />]], {
    path,
    handlers: [...contactHandlers(), emptyTree()],
  })
}

// 모바일(iPhone 13 폭·터치) — matchMedia 결과가 파일 안에서 캐시되므로 첫 렌더 전에 한 번.
mockViewport()

describe('모바일 연락처 상세 딥링크', () => {
  // 외부 연락처 딥링크 → 상세 → ‹ 는 /contacts 로 돌아가 목록을 보인다(쿼리가 남거나 다른 화면으로 가면 실패).
  test('딥링크(?contact=external) 진입 후 ‹ → 연락처 목록', async () => {
    const { user, location } = renderContacts('/contacts?contact=external:100')
    expect(await screen.findByTestId('contact-detail-external')).toBeInTheDocument()
    await user.click(within(screen.getByTestId('contact-back')).getByTestId('mobile-back'))
    await waitFor(() => expect(location()).toBe('/contacts'))
    expect(await screen.findByTestId('contact-list')).toBeInTheDocument()
  })

  // 404 는 빈 상세가 아니라 「찾을 수 없거나 볼 수 없습니다」 안내(WP-555)이고, ‹ 로 닫힌다.
  test('없는 연락처 딥링크는 찾을 수 없음 상태를 보이고 ‹ 로 닫힌다', async () => {
    const { user, location } = renderContacts('/contacts?contact=member:999')
    expect(await screen.findByTestId('contact-detail-not-found')).toBeInTheDocument()
    await user.click(within(screen.getByTestId('contact-back')).getByTestId('mobile-back'))
    await waitFor(() => expect(location()).toBe('/contacts'))
  })
})
