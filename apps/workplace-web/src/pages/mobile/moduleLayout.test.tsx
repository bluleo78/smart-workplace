// 모바일 목록↔상세 스택(WP-124) — 페이지 테스트(WP-971, WP-981).
// 상세 헤더 ✦ 로 연 AI 시트 닫기, 딥링크 뒤 ‹ = 모듈 루트, /tasks·/settings·/drive 가 리다이렉트 없이 목록을 보이는 것,
// /profile 호환 리다이렉트는 주소·조건부 렌더라 브라우저 없이 판정되므로 e2e/pages/mobile/module-layout.spec.ts 에서 옮겼다.
// 목록 전체 폭·가로 넘침(@layout)은 E2E 에 남는다.
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { renderMobile } from '@/test/kits/mobile/shell'
import { PAGE_LOAD_TIMEOUT } from '@/test/renderPage'
import { mockViewport } from '@/test/viewport'

// 휴대폰 폭·터치 포인터 — 모바일 셸(탭바·상세 헤더 ‹ ✦)로 뜬다.
mockViewport()

/** 채널 상세가 더 부르는 조회 — 멤버 목록. */
const channelDetail = [http.get('/api/v1/messaging/channels/1/members', () => HttpResponse.json([]))]

/** 드라이브 루트가 부르는 쿼터. */
const driveQuota = [http.get('/api/v1/drive/quota', () => HttpResponse.json({ usedBytes: 0, quotaBytes: 1024 }))]

describe('채널 상세', () => {
  // 상세 헤더의 ✦ 는 탭바가 없는 화면의 AI 진입점 — 시트를 열고, 닫으면 같은 상세 주소에 남아야 한다(uiux-u2 의 같은 단언도 여기서 지킨다).
  test('✦ 는 AI 시트를 열고(탭바 없음) 닫기로 상세에 돌아온다', async () => {
    const { user, location } = renderMobile('/chat/channels/1', { handlers: channelDetail })
    // 채널 상세는 입력창이 포커스를 쥐고 있어 user.click 의 포커스 이동(blur)이 jsdom 에서 헤더를 다시 그려 클릭을 놓친다 — 클릭만 보낸다.
    fireEvent.click(await screen.findByTestId('mobile-back-ai', {}, { timeout: PAGE_LOAD_TIMEOUT }))
    expect(await screen.findByTestId('ai-sheet')).toBeInTheDocument()
    expect(screen.queryByTestId('mobile-tabbar')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('ai-panel-close'))
    await waitFor(() => expect(screen.queryByTestId('ai-sheet')).not.toBeInTheDocument())
    expect(location()).toBe('/chat/channels/1')
  })

  // 딥링크로 상세에 바로 들어와도 ‹ 는 앱 밖(이전 사이트)이 아니라 모듈 루트로 간다. 루트에선 탭바가 다시 보인다.
  test('딥링크 진입 후 ‹ = 모듈 루트(/chat), 탭바가 다시 보인다', async () => {
    const { location } = renderMobile('/chat/channels/1', { handlers: channelDetail })
    const back = await screen.findByTestId('mobile-back', {}, { timeout: PAGE_LOAD_TIMEOUT })
    expect(screen.queryByTestId('mobile-tabbar')).not.toBeInTheDocument()
    fireEvent.click(back)
    await waitFor(() => expect(location()).toBe('/chat'))
    expect(await screen.findByTestId('mobile-tabbar')).toBeInTheDocument()
    expect(screen.getByTestId('channel-sidebar')).toBeInTheDocument()
  })
})

describe('모듈 루트는 데스크톱 리다이렉트 없이 목록', () => {
  // 데스크톱은 첫 하위 화면으로 넘기지만 모바일은 사이드바가 탭 첫 화면 목록이다 — 넘기면 목록에 닿을 길이 없다.
  test.each([
    ['/tasks', 'issue-sidebar'],
    ['/settings', 'settings-sidebar'],
    ['/drive', 'drive-sidebar'],
  ])('%s 는 주소를 지키고 %s 를 보인다', async (path, sidebar) => {
    const { location } = renderMobile(path, { handlers: driveQuota })
    expect(await screen.findByTestId(sidebar, {}, { timeout: PAGE_LOAD_TIMEOUT })).toBeInTheDocument()
    expect(location()).toBe(path)
    if (path === '/tasks') expect(screen.getByTestId('mobile-tabbar')).toBeInTheDocument()
  })

  // 옛 주소 /profile 은 모바일에서도 /settings/profile 상세(헤더 ‹)로 간다.
  test('/profile 은 /settings/profile 로 이동해 상세 헤더 ‹ 와 본문을 보인다', async () => {
    const { location } = renderMobile('/profile')
    expect(await screen.findByTestId('mobile-back', {}, { timeout: PAGE_LOAD_TIMEOUT })).toBeInTheDocument()
    expect(location()).toBe('/settings/profile')
    expect(await screen.findByText('프로필 정보')).toBeInTheDocument()
  })
})
