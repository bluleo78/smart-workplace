// @vitest-environment jsdom
import { File as FileIcon, FileText, type LucideIcon, Sparkles, SquareKanban } from 'lucide-react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { lucideSvg } from './lucideSvg'

// 편집기 위젯용 lucide 아이콘(WP-1185) — 모양을 복사해 들고 있지 않고 lucide-react 컴포넌트에서 읽으므로,
// React 로 그린 같은 아이콘과 안쪽 모양(태그·속성)이 같아야 한다. lucide-react 의 구조가 바뀌면 여기서 깨진다.

/** svg 안쪽 모양 — 태그와 속성(이름순)만 비교한다. */
function shapes(svg: Element) {
  return [...svg.children].map((el) => [el.tagName, ...[...el.attributes].map((a) => `${a.name}=${a.value}`).sort()].join(' '))
}

describe('lucideSvg', () => {
  it.each<[string, LucideIcon]>([
    ['SquareKanban', SquareKanban],
    ['FileText', FileText],
    ['File', FileIcon],
    ['Sparkles', Sparkles],
  ])('%s 는 React 로 그린 아이콘과 같은 모양이다', (_name, icon) => {
    const host = document.createElement('div')
    host.innerHTML = renderToStaticMarkup(createElement(icon))
    const fromReact = host.querySelector('svg')!
    const svg = lucideSvg(icon, 'h-3 w-3')

    expect(shapes(svg)).toEqual(shapes(fromReact))
    expect(svg.children.length).toBeGreaterThan(0)
    expect(svg.getAttribute('class')).toBe('h-3 w-3')
    expect(svg.getAttribute('aria-hidden')).toBe('true')
  })
})
