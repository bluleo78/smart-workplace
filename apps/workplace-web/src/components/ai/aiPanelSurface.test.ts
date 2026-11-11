// @vitest-environment jsdom
// 페이지 영역 inert(WP-54)와 오른쪽 도킹 칸(WP-1505) — 도킹 칸(data-ai-dock)은 AI 패널이 아직 없어도 통째로 inert 하지 않고
// 안의 AI 가 아닌 형제(도움말 패널)만 inert 한다. 옆 AI 패널은 열 때 불러와 뒤늦게 그려지므로(LazyAISidePanel),
// 칸을 통째로 inert 하면 다이얼로그가 열린 뒤 그 안에 그려진 AI 패널 입력까지 막힌다.
import { afterEach, describe, expect, it } from 'vitest'

import { inertPageArea } from './aiPanelSurface'

afterEach(() => {
  document.body.innerHTML = ''
})

describe('inertPageArea', () => {
  it('도킹 칸은 AI 패널이 아직 없어도 칸이 아니라 안의 도움말만 inert 하고, 나중에 그려진 AI 패널은 막지 않는다', () => {
    document.body.innerHTML = `
      <div data-ai-page-root>
        <main id="main"></main>
        <div id="dock" data-ai-dock><aside id="help"></aside></div>
      </div>`
    const release = inertPageArea()
    const dock = document.getElementById('dock') as HTMLElement
    expect((document.getElementById('main') as HTMLElement).inert).toBe(true)
    // jsdom 은 inert 를 속성으로 반영하지 않아 함수가 쓴 값만 본다 — 칸에는 쓰지 않았어야 한다.
    expect(dock.inert).not.toBe(true)
    expect((document.getElementById('help') as HTMLElement).inert).toBe(true)
    const ai = document.createElement('aside')
    ai.setAttribute('data-ai-panel', '')
    dock.appendChild(ai)
    expect(ai.inert).not.toBe(true)
    release()
    expect((document.getElementById('help') as HTMLElement).inert).toBe(false)
  })
})
