// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'

import { isBrowserExtensionUi } from './browserExtensionUi'

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
