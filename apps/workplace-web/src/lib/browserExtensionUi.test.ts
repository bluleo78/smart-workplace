// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'

import { isBrowserExtensionUi, isToastUi, preventDismissOnExtensionUi } from './browserExtensionUi'

describe('isBrowserExtensionUi', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('body 직속 커스텀 엘리먼트(1Password 메뉴)와 그 하위는 확장 UI 로 본다', () => {
    const host = document.createElement('com-1password-menu')
    const inner = document.createElement('div')
    host.appendChild(inner)
    document.body.appendChild(host)
    expect(isBrowserExtensionUi(host)).toBe(true)
    expect(isBrowserExtensionUi(inner)).toBe(true)
  })

  it('앱 루트·포털(일반 태그) 하위 요소는 확장 UI 가 아니다', () => {
    const root = document.createElement('div')
    const button = document.createElement('button')
    root.appendChild(button)
    document.body.appendChild(root)
    expect(isBrowserExtensionUi(button)).toBe(false)
  })

  it('앱 내부에 있는 커스텀 엘리먼트는 확장 UI 가 아니다', () => {
    const root = document.createElement('div')
    const custom = document.createElement('my-widget')
    root.appendChild(custom)
    document.body.appendChild(root)
    expect(isBrowserExtensionUi(custom)).toBe(false)
  })

  it('Element 가 아닌 대상·body 자체는 false', () => {
    expect(isBrowserExtensionUi(null)).toBe(false)
    expect(isBrowserExtensionUi(document.body)).toBe(false)
  })
})

// 모달(전체 화면 뷰어 등) 위 토스트 단추를 누르면 Radix 가 바깥 클릭으로 보고 닫던 것을 막는다(WP-1235).
describe('isToastUi · preventDismissOnExtensionUi', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  /** 토스터 안의 단추를 만든다 — Sonner 는 목록에 data-sonner-toaster 를 단다. */
  function toastButton(): HTMLButtonElement {
    const toaster = document.createElement('ol')
    toaster.setAttribute('data-sonner-toaster', '')
    const toast = document.createElement('li')
    toast.setAttribute('data-sonner-toast', '')
    const button = document.createElement('button')
    toast.appendChild(button)
    toaster.appendChild(toast)
    document.body.appendChild(toaster)
    return button
  }

  /** onInteractOutside 가 받는 이벤트 모양으로 감싼다. */
  function outsideEvent(target: EventTarget) {
    const originalEvent = new Event('pointerdown')
    Object.defineProperty(originalEvent, 'target', { value: target })
    return new CustomEvent('dismissableLayer.pointerDownOutside', {
      cancelable: true,
      detail: { originalEvent },
    })
  }

  it('토스터 안의 요소는 토스트 UI 로 본다', () => {
    expect(isToastUi(toastButton())).toBe(true)
  })

  it('토스터 밖·Element 가 아닌 대상은 토스트 UI 가 아니다', () => {
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    expect(isToastUi(outside)).toBe(false)
    expect(isToastUi(null)).toBe(false)
  })

  it('토스트 단추 누름은 바깥 클릭으로 닫지 않고, 그 밖의 바깥 클릭은 그대로 닫는다', () => {
    const onToast = outsideEvent(toastButton())
    preventDismissOnExtensionUi(onToast)
    expect(onToast.defaultPrevented).toBe(true)

    const plain = document.createElement('div')
    document.body.appendChild(plain)
    const onPlain = outsideEvent(plain)
    preventDismissOnExtensionUi(onPlain)
    expect(onPlain.defaultPrevented).toBe(false)
  })
})
