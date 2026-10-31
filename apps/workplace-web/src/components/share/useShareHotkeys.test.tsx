// 링크 단축키 훅(WP-1234) — 창의 keydown 을 받아 지금 보는 대상의 링크·키를 복사하고 토스트를 띄운다.
import { act, renderHook, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import type { ShareTarget } from '@/lib/shareTarget'

import { useRegisterShareTarget } from './useRegisterShareTarget'
import { useShareHotkeys } from './useShareHotkeys'

const issue: ShareTarget = { kind: 'issue', url: 'http://localhost:3000/projects/WP/issues/7', title: '버그', key: 'WP-7' }
const page: ShareTarget = { kind: 'page', url: 'http://localhost:3000/wiki/open/3', title: '노트' }

/** 플랫폼을 바꿔 본다 — 단축키는 Mac 이면 ⌘, 그 밖은 Ctrl 만 받는다(isMacLike 가 navigator.platform 을 읽는다). */
function onPlatform(platform: string) {
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue(platform)
}

/** 단축키 리스너 + (있으면) 대상 등록을 함께 띄운다 — 앱에선 AppLayout 과 상세 화면이 따로 건다. */
function setup(target: ShareTarget | null) {
  return renderHook(
    ({ t }: { t: ShareTarget | null }) => {
      useShareHotkeys()
      useRegisterShareTarget(t)
    },
    { initialProps: { t: target } },
  )
}

function press(init: KeyboardEventInit) {
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  act(() => {
    window.dispatchEvent(e)
  })
  return e
}

describe('useShareHotkeys', () => {
  // user-event 가 jsdom 에 없는 클립보드(navigator.clipboard)를 메모리 구현으로 깐다 — 복사 결과를 읽어 본다.
  beforeEach(() => {
    userEvent.setup()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('⇧⌘, 는 지금 보는 대상의 링크를 복사하고 토스트를 띄운다(입력 기본 동작은 막는다)', async () => {
    const success = vi.spyOn(toast, 'success')
    onPlatform('MacIntel')
    setup(issue)
    const e = press({ code: 'Comma', key: '<', metaKey: true, shiftKey: true })
    expect(e.defaultPrevented).toBe(true)
    await waitFor(async () => expect(await navigator.clipboard.readText()).toBe(issue.url))
    // 토스트에는 같은 링크를 앱 안으로 보내는 「채팅으로 보내기」 단추가 붙는다(WP-1235).
    expect(success).toHaveBeenCalledWith('링크를 복사했어요', { action: expect.objectContaining({ label: '채팅으로 보내기' }) })
  })

  test('Ctrl+. 는 (Windows 에서) 이슈 키를 복사한다', async () => {
    onPlatform('Win32')
    setup(issue)
    press({ code: 'Period', key: '.', ctrlKey: true })
    await waitFor(async () => expect(await navigator.clipboard.readText()).toBe('WP-7'))
  })

  test('Windows 에서 Win+.(metaKey) 는 가로채지 않는다', async () => {
    await navigator.clipboard.writeText('전')
    onPlatform('Win32')
    setup(issue)
    const e = press({ code: 'Period', key: '.', metaKey: true })
    expect(e.defaultPrevented).toBe(false)
    expect(await navigator.clipboard.readText()).toBe('전')
  })

  test('키가 없는 대상에서 ⌘. 는 아무것도 하지 않는다', async () => {
    await navigator.clipboard.writeText('전')
    onPlatform('MacIntel')
    setup(page)
    const e = press({ code: 'Period', key: '.', metaKey: true })
    expect(e.defaultPrevented).toBe(false)
    expect(await navigator.clipboard.readText()).toBe('전')
  })

  test('등록된 대상이 없으면 아무것도 하지 않는다', async () => {
    await navigator.clipboard.writeText('전')
    onPlatform('MacIntel')
    setup(null)
    const e = press({ code: 'Comma', key: '<', metaKey: true, shiftKey: true })
    expect(e.defaultPrevented).toBe(false)
    expect(await navigator.clipboard.readText()).toBe('전')
  })

  test('화면이 먼저 쓴 키(defaultPrevented)는 양보한다', async () => {
    await navigator.clipboard.writeText('전')
    onPlatform('MacIntel')
    setup(issue)
    const e = new KeyboardEvent('keydown', { code: 'Comma', metaKey: true, shiftKey: true, cancelable: true })
    e.preventDefault()
    act(() => {
      window.dispatchEvent(e)
    })
    expect(await navigator.clipboard.readText()).toBe('전')
  })

  test('대상이 언마운트되면 등록이 풀린다', async () => {
    await navigator.clipboard.writeText('전')
    onPlatform('MacIntel')
    const view = setup(issue)
    view.rerender({ t: null })
    press({ code: 'Comma', metaKey: true, shiftKey: true })
    expect(await navigator.clipboard.readText()).toBe('전')
  })

  test('뷰어(overlay)가 상세 화면(page)보다 먼저 등록돼도 뷰어 링크를 복사한다 — 자식 effect 가 먼저 돈다', async () => {
    onPlatform('MacIntel')
    const file: ShareTarget = { kind: 'file', url: 'http://localhost:3000/projects/WP/issues/7?file=3', title: 'a.pdf' }
    // 한 컴포넌트 안에서 뷰어 등록을 먼저 건다 — 앱에선 자식(뷰어) effect 가 부모(이슈 화면)보다 먼저 돈다.
    const view = renderHook(
      ({ open }: { open: boolean }) => {
        useShareHotkeys()
        useRegisterShareTarget(open ? file : null, 'overlay')
        useRegisterShareTarget(issue)
      },
      { initialProps: { open: true } },
    )
    press({ code: 'Comma', metaKey: true, shiftKey: true })
    await waitFor(async () => expect(await navigator.clipboard.readText()).toBe(file.url))
    // 뷰어를 닫으면(값 null) 다시 이슈가 대상이다.
    view.rerender({ open: false })
    press({ code: 'Comma', metaKey: true, shiftKey: true })
    await waitFor(async () => expect(await navigator.clipboard.readText()).toBe(issue.url))
    view.unmount()
  })
})
