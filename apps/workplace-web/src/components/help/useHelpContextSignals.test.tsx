// 도움말 문맥 신호 수집(useHelpContextSignals) — 포커스·클릭, 열린 대화상자, 스크롤 정착(200ms), 칸 떨어짐, 안쪽 스크롤·빈 측정이 신호를 지우지 않음, 언마운트 정리를 jsdom 에서 지킨다(WP-1506).
// 화면 기하(교차·위치)는 jsdom 이 재지 못하므로 IntersectionObserver 는 가짜로 주입하고 getBoundingClientRect·clientHeight 는 목으로 준다.
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useHelpContextSignals } from './useHelpContextSignals'

/** 가짜 IntersectionObserver — 관찰 대상을 모아 두고 테스트가 교차 보고를 직접 일으킨다. */
class FakeIO {
  static instances: FakeIO[] = []
  observed = new Set<Element>()
  readonly callback: IntersectionObserverCallback
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback
    FakeIO.instances.push(this)
  }
  observe(el: Element) {
    this.observed.add(el)
  }
  unobserve(el: Element) {
    this.observed.delete(el)
  }
  disconnect() {
    this.observed.clear()
  }
  takeRecords() {
    return []
  }
  /** el 이 화면 밖으로 나갔다고 보고한다. */
  leave(el: Element) {
    this.callback([{ target: el, isIntersecting: false } as IntersectionObserverEntry], this as unknown as IntersectionObserver)
  }
}

const wrapper = ({ children }: { children: ReactNode }) => <MemoryRouter initialEntries={['/settings/tokens']}>{children}</MemoryRouter>

/** html 을 body 에 붙이고 그 루트를 돌려준다. */
function mount(html: string): HTMLElement {
  const root = document.createElement('div')
  root.innerHTML = html
  document.body.appendChild(root)
  return root
}

/** 요소의 화면 위치를 목으로 준다(top·bottom 만 판정에 쓴다). */
function setRect(el: Element, top: number, bottom: number) {
  el.getBoundingClientRect = () => ({ top, bottom, left: 0, right: 0, width: 0, height: bottom - top, x: 0, y: top, toJSON: () => ({}) })
}

/** 훅을 띄운다 — onScreenInteraction 호출 수를 본다. */
function setup() {
  const onScreenInteraction = vi.fn()
  const hook = renderHook(() => useHelpContextSignals({ onScreenInteraction }), { wrapper })
  return { onScreenInteraction, ...hook }
}

beforeEach(() => {
  FakeIO.instances = []
  vi.stubGlobal('IntersectionObserver', FakeIO)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('포커스·클릭', () => {
  it('data-help 칸 안 단추에 포커스하면 그 칸이 신호, 단추 이름이 활성 컨트롤', () => {
    const root = mount('<div data-help="tokens.list"><button>폐기</button></div>')
    const { result, onScreenInteraction } = setup()
    act(() => root.querySelector('button')!.focus())
    expect(result.current.signals.focus).toBe('tokens.list')
    expect(result.current.activeControlName).toBe('폐기')
    expect(onScreenInteraction).toHaveBeenCalledTimes(1)
  })

  it('도움말 패널 안 포커스는 신호도, 직접 고름 풀기도 하지 않는다', () => {
    const root = mount('<div data-help="tokens.list"><div data-help-panel><button>뒤로</button></div></div>')
    const { result, onScreenInteraction } = setup()
    act(() => root.querySelector('button')!.focus())
    expect(result.current.signals.focus).toBeNull()
    expect(result.current.activeControlName).toBeNull()
    expect(onScreenInteraction).not.toHaveBeenCalled()
  })

  it('오른쪽 도킹의 손잡이(도움말·AI 높이·폭 조절)를 누르거나 포커스해도 신호·직접 고름은 그대로다', () => {
    // 위아래로 합친 칸의 손잡이는 도움말 aside·AI 패널 밖, 도킹(data-ai-dock) 안 형제로 그려진다 — 패널 크기를 바꾸는 일이지 화면 칸을 만진 것이 아니다.
    const root = mount(
      '<div data-help="tokens.list"><button>폐기</button></div>' +
        '<div data-ai-dock><div role="separator" tabindex="0" id="split"></div><div id="resize"></div></div>',
    )
    const { result, onScreenInteraction } = setup()
    act(() => root.querySelector('button')!.focus())
    act(() => {
      root.querySelector('#resize')!.dispatchEvent(new Event('pointerdown', { bubbles: true }))
      ;(root.querySelector('#split') as HTMLElement).focus()
    })
    expect(result.current.signals.focus).toBe('tokens.list')
    expect(onScreenInteraction).toHaveBeenCalledTimes(1)
  })

  it('data-help 없는 곳을 누르면 포커스 신호를 비우고 직접 고름을 푼다', () => {
    const root = mount('<div data-help="tokens.list"><button>폐기</button></div><p id="plain">글</p>')
    const { result, onScreenInteraction } = setup()
    act(() => root.querySelector('button')!.focus())
    act(() => {
      root.querySelector('#plain')!.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    })
    expect(result.current.signals.focus).toBeNull()
    expect(result.current.activeControlName).toBeNull()
    expect(onScreenInteraction).toHaveBeenCalledTimes(2)
  })

  it('열 때 이미 화면 단추에 포커스가 있으면 그 칸을 잇는다(직접 고름 풀기는 부르지 않음)', () => {
    const root = mount('<div data-help="tokens.connect"><button>복사</button></div>')
    root.querySelector('button')!.focus()
    const { result, onScreenInteraction } = setup()
    expect(result.current.signals.focus).toBe('tokens.connect')
    expect(onScreenInteraction).not.toHaveBeenCalled()
  })

  it('포커스한 칸이 DOM 에서 지워지면 신호가 풀린다', async () => {
    const root = mount('<div data-help="tokens.list"><button>폐기</button></div>')
    const { result } = setup()
    act(() => root.querySelector('button')!.focus())
    expect(result.current.signals.focus).toBe('tokens.list')
    await act(async () => {
      root.querySelector('[data-help]')!.remove()
    })
    expect(result.current.signals.focus).toBeNull()
    expect(result.current.activeControlName).toBeNull()
  })

  it('대화상자 흐린 막·그림 확대(패널 포털) 안을 눌러도 직접 고름을 풀지 않고 포커스 신호도 그대로다', () => {
    const root = mount(`
      <div data-help="tokens.list"><button>폐기</button></div>
      <div data-slot="dialog-overlay" id="overlay"></div>
      <div data-help-panel role="dialog" data-state="open"><button id="zoom-close">닫기</button></div>`)
    const { result, onScreenInteraction } = setup()
    act(() => root.querySelector('button')!.focus())
    expect(onScreenInteraction).toHaveBeenCalledTimes(1)
    act(() => {
      root.querySelector('#overlay')!.dispatchEvent(new Event('pointerdown', { bubbles: true }))
      root.querySelector('#zoom-close')!.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    })
    act(() => (root.querySelector('#zoom-close') as HTMLElement).focus())
    expect(onScreenInteraction).toHaveBeenCalledTimes(1)
    expect(result.current.signals.focus).toBe('tokens.list')
  })

  it('포커스한 칸이 화면 밖으로 나가면 신호가 풀린다', () => {
    const root = mount('<div data-help="tokens.list"><button>폐기</button></div>')
    const { result } = setup()
    act(() => root.querySelector('button')!.focus())
    const cell = root.querySelector('[data-help]')!
    const io = FakeIO.instances.find((i) => i.observed.has(cell))!
    act(() => io.leave(cell))
    expect(result.current.signals.focus).toBeNull()
  })
})

describe('대화상자', () => {
  it('열린 대화상자의 data-help 가 신호, 닫히는 중(closed)이 되면 풀린다', async () => {
    const { result } = setup()
    const root = await act(async () => mount('<div role="dialog" data-state="open" data-help="tokens.issue"></div>'))
    expect(result.current.signals.dialog).toBe('tokens.issue')
    await act(async () => {
      root.querySelector('[role="dialog"]')!.setAttribute('data-state', 'closed')
    })
    expect(result.current.signals.dialog).toBeNull()
  })

  it('도움말 패널을 품은 대화상자(휴대폰 시트)·패널 안 대화상자는 무시한다', async () => {
    const { result } = setup()
    await act(async () => {
      mount('<div role="dialog" data-state="open" data-help="sheet"><div data-help-panel></div></div>')
      mount('<div data-help-panel><div role="dialog" data-state="open" data-help="zoom"></div></div>')
    })
    expect(result.current.signals.dialog).toBeNull()
  })
})

describe('스크롤', () => {
  it('스크롤이 멈춘 뒤 200ms 에 칸을 다시 잰다', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] })
    const root = mount(`
      <div data-ai-page-root><main><div data-testid="page-body">
        <div data-help="tokens">
          <div data-help="tokens.list"></div>
          <div data-help="tokens.connect"></div>
        </div>
      </div></main></div>`)
    const body = root.querySelector('[data-testid="page-body"]')!
    Object.defineProperty(body, 'clientHeight', { value: 600, configurable: true })
    setRect(body, 0, 600)
    const [outer, list, connect] = [...root.querySelectorAll('[data-help]')]
    setRect(outer, -500, 900)
    setRect(list, -100, 200)
    setRect(connect, 220, 900)

    const { result } = setup()
    // 처음에는 기다리지 않고 다음 프레임에 잰다
    act(() => vi.advanceTimersByTime(20))
    expect(result.current.signals.scroll).toBe('tokens.list')

    // 스크롤로 「도구에 연결하기」 칸이 기준선(180px)을 넘어 올라온다
    setRect(list, -400, -100)
    setRect(connect, -80, 700)
    act(() => {
      body.dispatchEvent(new Event('scroll'))
    })
    act(() => vi.advanceTimersByTime(199))
    expect(result.current.signals.scroll).toBe('tokens.list')
    act(() => vi.advanceTimersByTime(1))
    expect(result.current.signals.scroll).toBe('tokens.connect')
  })

  it('첫 측정 때 본문에 칸이 아직 없으면(늦게 그려지는 화면) 칸이 처음 나타날 때 다시 잰다', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] })
    const root = mount('<div data-ai-page-root><main><div data-testid="page-body"></div></main></div>')
    const body = root.querySelector('[data-testid="page-body"]')!
    Object.defineProperty(body, 'clientHeight', { value: 600, configurable: true })
    setRect(body, 0, 600)
    const { result } = setup()
    act(() => vi.advanceTimersByTime(20))
    expect(result.current.signals.scroll).toBeNull()

    // 화면이 뒤늦게 그려져 칸이 생긴다 — 스크롤하지 않아도 다음 프레임에 그 칸을 신호로 든다.
    await act(async () => {
      const cell = document.createElement('div')
      cell.setAttribute('data-help', 'tokens.list')
      setRect(cell, 0, 600)
      body.appendChild(cell)
    })
    act(() => vi.advanceTimersByTime(20))
    expect(result.current.signals.scroll).toBe('tokens.list')
  })

  it('스크롤 전에 늦게 온 데이터로 칸 위치가 밀리면 다시 재고, 사용자가 스크롤한 뒤에는 화면 변화로 다시 재지 않는다', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] })
    const root = mount(`
      <div data-ai-page-root><main><div data-testid="page-body">
        <div data-help="tokens.list"><ul id="rows"></ul></div>
        <div data-help="tokens.connect"></div>
      </div></main></div>`)
    const body = root.querySelector('[data-testid="page-body"]')!
    Object.defineProperty(body, 'clientHeight', { value: 600, configurable: true })
    setRect(body, 0, 600)
    const list = root.querySelector('[data-help="tokens.list"]')!
    const connect = root.querySelector('[data-help="tokens.connect"]')!
    // 목록이 비어 있을 때 — 「도구에 연결하기」가 기준선(180px) 위에 있다(라이브 검증에서 본 상황).
    setRect(list, 0, 100)
    setRect(connect, 120, 600)
    const { result } = setup()
    act(() => vi.advanceTimersByTime(20))
    expect(result.current.signals.scroll).toBe('tokens.connect')

    // 목록 행이 그려져 「도구에 연결하기」가 아래로 밀린다 — 스크롤하지 않아도 다시 잰다.
    setRect(list, 0, 500)
    setRect(connect, 520, 1000)
    await act(async () => {
      root.querySelector('#rows')!.appendChild(document.createElement('li'))
    })
    act(() => vi.advanceTimersByTime(20))
    expect(result.current.signals.scroll).toBe('tokens.list')

    // 사용자가 스크롤해 「도구에 연결하기」를 읽는다.
    setRect(list, -400, 100)
    setRect(connect, 120, 600)
    act(() => {
      body.dispatchEvent(new Event('scroll'))
    })
    act(() => vi.advanceTimersByTime(200))
    expect(result.current.signals.scroll).toBe('tokens.connect')

    // 그 뒤 화면이 바뀌어도(행 추가) 읽던 자리를 흔들지 않는다 — 다음 스크롤까지 그대로.
    setRect(list, -400, 400)
    setRect(connect, 420, 900)
    await act(async () => {
      root.querySelector('#rows')!.appendChild(document.createElement('li'))
    })
    act(() => vi.advanceTimersByTime(20))
    expect(result.current.signals.scroll).toBe('tokens.connect')
  })

  it('칸을 품지 않은 안쪽 스크롤(가로 스크롤 표 등)은 스크롤 신호를 지우지 않는다', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] })
    const root = mount(`
      <div data-ai-page-root><main><div data-testid="page-body">
        <div data-help="tokens.list"><div id="wide-table"></div></div>
      </div></main></div>`)
    const body = root.querySelector('[data-testid="page-body"]')!
    Object.defineProperty(body, 'clientHeight', { value: 600, configurable: true })
    setRect(body, 0, 600)
    setRect(root.querySelector('[data-help]')!, 0, 600)
    const { result } = setup()
    act(() => vi.advanceTimersByTime(20))
    expect(result.current.signals.scroll).toBe('tokens.list')
    act(() => {
      root.querySelector('#wide-table')!.dispatchEvent(new Event('scroll'))
    })
    act(() => vi.advanceTimersByTime(300))
    expect(result.current.signals.scroll).toBe('tokens.list')
  })

  it('본문을 스크롤했는데 잴 칸이 없으면 이전 스크롤 신호를 그대로 둔다', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] })
    const root = mount(`
      <div data-ai-page-root><main><div data-testid="page-body">
        <div data-help="tokens.list"></div>
      </div></main></div>`)
    const body = root.querySelector('[data-testid="page-body"]')!
    Object.defineProperty(body, 'clientHeight', { value: 600, configurable: true })
    setRect(body, 0, 600)
    setRect(root.querySelector('[data-help]')!, 0, 600)
    const { result } = setup()
    act(() => vi.advanceTimersByTime(20))
    expect(result.current.signals.scroll).toBe('tokens.list')
    // 칸이 잠시 사라진(다시 그리는 중) 채 스크롤이 멈춘다.
    root.querySelector('[data-help]')!.remove()
    act(() => {
      body.dispatchEvent(new Event('scroll'))
    })
    act(() => vi.advanceTimersByTime(300))
    expect(result.current.signals.scroll).toBe('tokens.list')
  })
})

describe('정리', () => {
  it('언마운트하면 리스너·관찰자·스크롤 타이머를 모두 거둔다', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] })
    const root = mount(`<div data-ai-page-root><main><div data-testid="page-body"><div data-help="tokens.list"><button>폐기</button></div></div></main></div>`)
    const removed = vi.spyOn(document, 'removeEventListener')
    const moDisconnect = vi.spyOn(MutationObserver.prototype, 'disconnect')
    const { result, unmount, onScreenInteraction } = setup()
    act(() => vi.advanceTimersByTime(20))
    // 스크롤 정착 타이머를 걸어 둔 채 언마운트한다.
    act(() => {
      root.querySelector('[data-testid="page-body"]')!.dispatchEvent(new Event('scroll'))
    })
    const io = FakeIO.instances[0]
    act(() => root.querySelector('button')!.focus())
    expect(io.observed.size).toBe(1)
    unmount()
    expect(removed.mock.calls.map(([type]) => type).sort()).toEqual(expect.arrayContaining(['focusin', 'pointerdown', 'scroll']))
    expect(moDisconnect).toHaveBeenCalled()
    expect(io.observed.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
    // 언마운트 뒤 화면 포커스는 더 이상 직접 고름 풀기를 부르지 않는다.
    const calls = onScreenInteraction.mock.calls.length
    root.querySelector('button')!.blur()
    root.querySelector('button')!.focus()
    expect(onScreenInteraction).toHaveBeenCalledTimes(calls)
    expect(result.current.signals.focus).toBe('tokens.list')
    removed.mockRestore()
    moDisconnect.mockRestore()
  })
})

describe('대화상자 다시 훑기', () => {
  it('대화상자와 무관한 DOM 변화로는 대화상자를 다시 훑지 않는다', async () => {
    const qsa = vi.spyOn(document, 'querySelectorAll')
    setup()
    const before = qsa.mock.calls.filter(([sel]) => String(sel).includes('role="dialog"')).length
    await act(async () => {
      mount('<p>스트리밍 글</p>')
    })
    expect(qsa.mock.calls.filter(([sel]) => String(sel).includes('role="dialog"')).length).toBe(before)
    await act(async () => {
      mount('<div role="dialog" data-state="open" data-help="tokens.issue"></div>')
    })
    expect(qsa.mock.calls.filter(([sel]) => String(sel).includes('role="dialog"')).length).toBe(before + 1)
    qsa.mockRestore()
  })
})
