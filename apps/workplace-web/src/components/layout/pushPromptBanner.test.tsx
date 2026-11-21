// 인박스 「알림 켜기」 배너(WP-1933) — 권한 거부 시 닫지 않고 차단 안내로 바꾸는지, 닫음 저장 조건을 본다.
// 푸시 지원 상태·구독 함수는 브라우저 API 라 vi.mock 으로 제어하고, 서버 config 만 MSW 로 준다.
import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { PushPromptBanner } from '@/components/layout/PushPromptBanner'
import { enablePush, requestPushPermission } from '@/lib/push/subscription'
import { getPushSupport } from '@/lib/push/support'
import { renderScreen } from '@/test/renderScreen'

vi.mock('@/lib/push/support', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/push/support')>()),
  getPushSupport: vi.fn(),
}))
vi.mock('@/lib/push/subscription', () => ({
  currentSubscription: vi.fn(async () => null),
  requestPushPermission: vi.fn(async () => 'default'),
  enablePush: vi.fn(),
  disablePush: vi.fn(),
}))

const handlers = [http.get('/api/v1/push/config', () => HttpResponse.json({ enabled: true, vapidPublicKey: 'BKEY' }))]

/** 배너를 띄운다. onNavigate 스파이를 함께 돌려준다. */
function renderBanner() {
  const onNavigate = vi.fn()
  const view = renderScreen(<PushPromptBanner onNavigate={onNavigate} />, { handlers })
  return { ...view, onNavigate }
}

describe('PushPromptBanner', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.mocked(getPushSupport).mockReset()
    vi.mocked(enablePush).mockReset()
    vi.mocked(requestPushPermission).mockClear()
  })

  test('권한 거부면 배너가 거부 안내로 바뀌고 닫음을 저장하지 않는다', async () => {
    vi.mocked(getPushSupport).mockReturnValue('default')
    vi.mocked(enablePush).mockImplementation(async () => {
      vi.mocked(getPushSupport).mockReturnValue('denied')
      throw new Error('PERMISSION_DENIED')
    })
    const { user } = renderBanner()
    await user.click(await screen.findByTestId('push-prompt-enable'))
    expect(await screen.findByTestId('push-prompt-denied')).toHaveTextContent(
      '알림 권한이 차단되어 있습니다. 브라우저 주소창의 사이트 설정(또는 OS 설정 > 알림)에서 이 사이트의 알림을 허용해 주세요.',
    )
    expect(screen.getByTestId('push-prompt-settings-link')).toBeInTheDocument()
    expect(screen.queryByTestId('push-prompt-enable')).not.toBeInTheDocument()
    expect(localStorage.getItem('pushPromptDismissed')).not.toBe('1')
  })

  test('새로 그려도 거부 안내가 남는다', async () => {
    vi.mocked(getPushSupport).mockReturnValue('denied')
    renderBanner()
    expect(await screen.findByTestId('push-prompt-denied')).toBeInTheDocument()
  })

  test('안내형에서 X 를 누르면 닫음을 저장하고 사라진다', async () => {
    vi.mocked(getPushSupport).mockReturnValue('denied')
    const { user } = renderBanner()
    await user.click(await screen.findByTestId('push-prompt-dismiss'))
    expect(localStorage.getItem('pushPromptDismissed')).toBe('1')
    expect(screen.queryByTestId('push-prompt-banner')).not.toBeInTheDocument()
  })

  test('구독 실패면 배너가 남는다', async () => {
    vi.mocked(getPushSupport).mockReturnValue('default')
    vi.mocked(enablePush).mockRejectedValue(new Error('boom'))
    const { user } = renderBanner()
    await user.click(await screen.findByTestId('push-prompt-enable'))
    await waitFor(() => expect(enablePush).toHaveBeenCalled())
    expect(await screen.findByTestId('push-prompt-enable')).toBeInTheDocument()
    expect(localStorage.getItem('pushPromptDismissed')).toBeNull()
  })

  test('구독 성공이면 닫음을 저장한다', async () => {
    vi.mocked(getPushSupport).mockReturnValue('default')
    vi.mocked(enablePush).mockResolvedValue(undefined)
    const { user } = renderBanner()
    await user.click(await screen.findByTestId('push-prompt-enable'))
    await waitFor(() => expect(localStorage.getItem('pushPromptDismissed')).toBe('1'))
  })

  test('알림 설정 링크는 onNavigate 뒤 설정 화면으로 간다', async () => {
    vi.mocked(getPushSupport).mockReturnValue('denied')
    const { user, onNavigate, location } = renderBanner()
    await user.click(await screen.findByTestId('push-prompt-settings-link'))
    expect(onNavigate).toHaveBeenCalledTimes(1)
    expect(location()).toBe('/settings/notifications')
  })

  test.each(['unsupported', 'ios-needs-install', 'granted'] as const)('지원 상태 %s 면 배너가 없다', async (support) => {
    vi.mocked(getPushSupport).mockReturnValue(support)
    renderBanner()
    // 지원 상태는 config 조회가 끝난 뒤에야 읽힌다 — 읽힌 것을 확인한 뒤 배너가 없어야 한다(조회 전에 통과하지 않게)
    await waitFor(() => expect(getPushSupport).toHaveBeenCalled())
    expect(screen.queryByTestId('push-prompt-banner')).not.toBeInTheDocument()
  })
})
