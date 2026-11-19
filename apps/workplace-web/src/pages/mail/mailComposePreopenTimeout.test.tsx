// WP-1783 기본값 「새 창」 — 미리 연 빈 창이 작성기 준비를 끝내 못 받을 때의 시한(MAIL_COMPOSE_PREOPEN_TIMEOUT_MS) 판정.
// 도크 없이 공급자만 띄운다(도크가 없으니 작성기는 영영 준비되지 않는다). window.open 은 가짜 창으로 대신한다.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { toast } from 'sonner'
import { afterEach, expect, test, vi } from 'vitest'

import { MAIL_COMPOSE_PREOPEN_TIMEOUT_MS, MailComposeProvider, useMailCompose } from '@/components/mail/MailComposeContext'
import { mailSettingsKey } from '@/hooks/queries/useMailSettings'
import { fakeWindow } from '@/test/kits/mail/compose-default'

// toast 는 함수라 spyOn 으로 가로챌 수 없어 모듈째 가짜로 둔다.
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }) }))

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

test('작성기가_준비되지_않으면_미리_연_창은_10초에_닫힌다', () => {
  vi.useFakeTimers()
  const win = fakeWindow()
  vi.spyOn(window, 'open').mockReturnValue(win as unknown as Window)
  // 설정 조회 캐시에 「새 창」을 미리 둔다 — 5분 동안 신선해 다시 받지 않는다.
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  qc.setQueryData(mailSettingsKey, { composeMode: 'WINDOW' })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MailComposeProvider>{children}</MailComposeProvider>
    </QueryClientProvider>
  )
  const { result } = renderHook(() => useMailCompose(), { wrapper })

  act(() => {
    result.current.openCompose(
      { mode: 'new', accountId: 1, to: [], cc: [], bcc: [], subject: '', initialHtml: '', quote: null, inReplyToMessageId: null, draftId: 7 },
      { placement: 'default' },
    )
  })
  expect(window.open).toHaveBeenCalledTimes(1)
  expect(result.current.isMovingToWindow(7)).toBe(true)

  // 9.9초에는 아직 닫지 않는다.
  act(() => {
    vi.advanceTimersByTime(MAIL_COMPOSE_PREOPEN_TIMEOUT_MS - 100)
  })
  expect(win.close).not.toHaveBeenCalled()
  expect(result.current.isMovingToWindow(7)).toBe(true)

  // 10초가 되면 창을 닫고 알린 뒤 우측 하단으로 되돌린다.
  act(() => {
    vi.advanceTimersByTime(100)
  })
  expect(win.close).toHaveBeenCalledTimes(1)
  expect(toast).toHaveBeenCalledWith('새 창을 준비하지 못해 우측 하단에 열었어요')
  expect(result.current.isMovingToWindow(7)).toBe(false)
})
