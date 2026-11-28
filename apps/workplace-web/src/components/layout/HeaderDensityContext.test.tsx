// 늦게 나타난 포털과 헤더도 연결하고 접기 전환이 끝난 뒤에만 다음 단계를 판정한다.
import { act, render, screen, waitFor } from '@testing-library/react'
import { createPortal } from 'react-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { HEADER_DOCK_ATTR } from './headerDensity'
import { HeaderDensityProvider, useHeaderDensity, useHeaderDensityHeader } from './HeaderDensityContext'
import { useAiActionsWidth } from './useAiActionsWidth'

function Fixture({ mounted, chipMounted = mounted, ai = true, dock = false }: { mounted: boolean; chipMounted?: boolean; ai?: boolean; dock?: boolean }) {
  useAiActionsWidth()
  const { folded, circle, docked } = useHeaderDensity()
  const register = useHeaderDensityHeader()
  return <>
    <output data-docked={docked}>{`${folded}/${circle}`}</output>
    {mounted && <header ref={register} data-ai-has-auxiliary-actions="true">
      <div data-ai-left-group />
      {/* 헤더 넣기 자리(WP-1611) — 있을 때만 마지막 단계로 간다. */}
      {dock && <div {...{ [HEADER_DOCK_ATTR]: '' }} />}
      <div data-ai-actions>{folded ? '더보기' : '설정'}</div>
    </header>}
    {chipMounted && createPortal(<div data-ai-chip>{ai && <button data-ai-density-chip />}</div>, document.body)}
  </>
}

/**
 * ResizeObserver 스텁. observe 대상을 기록하고, auto 면 observe 직후 첫 알림을 act 안에서 부르게 큐에 넣는다(WP-2078).
 * 실제 ResizeObserver 처럼 disconnect 된 관찰자는 깨우지 않는다 — 정리 경로를 함께 검증하려는 것.
 */
function stubRo({ auto = false }: { auto?: boolean } = {}) {
  const instances: { cb: ResizeObserverCallback; targets: Set<Element> }[] = []
  const observed: Element[] = []
  vi.stubGlobal('ResizeObserver', class {
    cb: ResizeObserverCallback
    targets = new Set<Element>()
    constructor(cb: ResizeObserverCallback) { this.cb = cb; instances.push(this) }
    observe(target: Element) {
      this.targets.add(target)
      observed.push(target)
      // 큐에 넣은 사이 disconnect·unobserve 됐으면 실제 브라우저처럼 알리지 않는다.
      if (auto) queueMicrotask(() => {
        if (this.targets.has(target)) act(() => { this.cb([], this as unknown as ResizeObserver) })
      })
    }
    unobserve(target: Element) { this.targets.delete(target) }
    disconnect() { this.targets.clear() }
  })
  /** 관찰 대상이 조건에 맞는 관찰자만 act 안에서 깨운다. */
  const wake = (match: (targets: Set<Element>) => boolean) => act(() => {
    for (const { cb, targets } of instances) if (match(targets)) cb([], {} as ResizeObserver)
  })
  /** 관찰 중인(disconnect 되지 않은) 관찰자만 깨운다. */
  const notify = () => wake((targets) => targets.size > 0)
  /** 그 요소를 관찰 중인 관찰자만 깨운다. */
  const notifyFor = (target: Element) => wake((targets) => targets.has(target))
  return { notify, notifyFor, observed }
}

/** 칩은 멀리(left 2000, 접히지 않음), 모든 요소 폭 100 으로 돌려주는 getBoundingClientRect 모의. */
function mockRects() {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const left = this.hasAttribute('data-ai-chip') ? 2000 : 0
    return { left, right: left + 100, width: 100 } as DOMRect
  })
}

describe('HeaderDensityProvider', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

  it('제공자 이후 나타난 헤더와 포털을 측정해 접은 다음 동그라미로 줄인다', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const left = this.hasAttribute('data-ai-chip') ? 120 : 0
      return { left, right: left + 100, width: 100 } as DOMRect
    })
    const view = render(<HeaderDensityProvider><Fixture mounted={false} /></HeaderDensityProvider>)
    expect(screen.getByRole('status').textContent).toBe('false/false')
    view.rerender(<HeaderDensityProvider><Fixture mounted /></HeaderDensityProvider>)
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('true/false'))
    expect(document.querySelector<HTMLElement>('[data-ai-chip]')?.style.getPropertyValue('--ai-actions-width')).toBe('100px')
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('true/true'))
    view.rerender(<HeaderDensityProvider><Fixture mounted={false} /></HeaderDensityProvider>)
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('false/false'))
  })

  it('늦게 연결한 칩의 크기가 바뀌면 관찰자가 밀도를 다시 계산한다', async () => {
    const ro = stubRo({ auto: true })
    let chipLeft = 500
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const left = this.hasAttribute('data-ai-chip') ? chipLeft : 0
      return { left, right: left + 100, width: 100 } as DOMRect
    })
    const view = render(<HeaderDensityProvider><Fixture mounted={false} /></HeaderDensityProvider>)
    view.rerender(<HeaderDensityProvider><Fixture mounted /></HeaderDensityProvider>)
    await waitFor(() => expect(document.querySelector<HTMLElement>('[data-ai-chip]')?.style.getPropertyValue('--ai-actions-width')).toBe('100px'))
    chipLeft = 120
    ro.notifyFor(document.querySelector('[data-ai-chip]')!)
    expect(screen.getByRole('status').textContent).toBe('true/false')
  })

  it('헤더 액션이 그대로인 상태에서 늦게 추가된 칩에도 액션 폭을 전달한다', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 500, width: 100 } as DOMRect)
    const view = render(<HeaderDensityProvider><Fixture mounted chipMounted={false} /></HeaderDensityProvider>)
    view.rerender(<HeaderDensityProvider><Fixture mounted /></HeaderDensityProvider>)
    await waitFor(() => expect(document.querySelector<HTMLElement>('[data-ai-chip]')?.style.getPropertyValue('--ai-actions-width')).toBe('100px'))
  })

  // 아래 기하 모의값의 196 = 틀 폭 100 + 틀 오른쪽 검색·「?」 자리와 액션 앞 간격 96(WP-1505 에서 56 → 96).
  // 40px 늘어난 만큼 액션 오른쪽 경계(right·actionsRight)도 40 옮겨 칩 위치·복귀 여유는 예전 판정과 같은 값으로 둔다.
  it.each([-200, 100])('접기 안정 대기 중 액션 오른쪽 경계가 %ipx 이동해도 접기 폭만 복귀 여유로 쓴다', async (resize) => {
    let right = 1040
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const folded = screen.queryByRole('status')?.textContent?.startsWith('true') ?? false
      const actionsWidth = folded ? 428 : 678
      const left = this.hasAttribute('data-ai-chip') ? right - actionsWidth - 196 : 0
      return { left, right: this.hasAttribute('data-ai-actions') ? right : left + 100, width: this.hasAttribute('data-ai-actions') ? actionsWidth : 100 } as DOMRect
    })
    render(<HeaderDensityProvider><Fixture mounted /></HeaderDensityProvider>)
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('true/false'))
    right += resize
    act(() => window.dispatchEvent(new Event('resize')))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)) })
    if (resize < 0) {
      right += 20
      act(() => window.dispatchEvent(new Event('resize')))
      expect(screen.getByRole('status').textContent).toBe('true/false')
    } else {
      expect(screen.getByRole('status').textContent).toBe('false/false')
    }
  })

  it('중앙 한계가 액션 접기 이동을 제한하면 현재 배치의 실제 이동분만 사용한다', async () => {
    let right = 1040
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const folded = screen.queryByRole('status')?.textContent?.startsWith('true') ?? false
      const actionsWidth = folded ? 428 : 678
      const left = this.hasAttribute('data-ai-chip') ? Math.min(216, right - actionsWidth - 196) : 0
      return { left, right: this.hasAttribute('data-ai-actions') ? right : left + 100, width: this.hasAttribute('data-ai-actions') ? actionsWidth : 100 } as DOMRect
    })
    render(<HeaderDensityProvider><Fixture mounted /></HeaderDensityProvider>)
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('true/false'))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)) })
    expect(screen.getByRole('status').textContent).toBe('true/false')
    right += 20
    act(() => window.dispatchEvent(new Event('resize')))
    expect(screen.getByRole('status').textContent).toBe('false/false')
  })

  it('제목 그룹 폭이 0이어도 유효한 좌표로 접기와 동그라미를 판정한다', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const left = this.hasAttribute('data-ai-chip') ? -60 : 128
      return { left, right: left + 140, width: this.hasAttribute('data-ai-left-group') ? 0 : 140 } as DOMRect
    })
    render(<HeaderDensityProvider><Fixture mounted /></HeaderDensityProvider>)
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('true/true'))
  })

  it('동그라미에서 알약으로 바뀐 커밋에서 칩 오프셋을 함께 갱신한다', async () => {
    let chipLeft = 120
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const circle = screen.queryByRole('status')?.textContent?.endsWith('/true') ?? false
      const left = this.hasAttribute('data-ai-chip') ? chipLeft : 0
      const width = this.hasAttribute('data-ai-chip') && circle ? 32 : 140
      return { left, right: left + width, width } as DOMRect
    })
    render(<HeaderDensityProvider><Fixture mounted /></HeaderDensityProvider>)
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('true/true'))
    expect(document.querySelector<HTMLElement>('[data-ai-chip]')?.style.getPropertyValue('--ai-chip-offset')).toBe('128px')
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)) })
    chipLeft = 300
    act(() => window.dispatchEvent(new Event('resize')))
    expect(screen.getByRole('status').textContent).toBe('true/false')
    expect(document.querySelector<HTMLElement>('[data-ai-chip]')?.style.getPropertyValue('--ai-chip-offset')).toBe('182px')
  })

  it('검색만 있으면 제목 공간이 계속 좁아도 동그라미 상태에 진입하지 않는다', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return { left: this.hasAttribute('data-ai-chip') ? 120 : 0, right: 220, width: 100 } as DOMRect
    })
    render(<HeaderDensityProvider><Fixture mounted ai={false} /></HeaderDensityProvider>)
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('true/false'))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)) })
    expect(screen.getByRole('status').textContent).toBe('true/false')
  })

  // WP-1611: 숨긴 틀도 폭·위치가 남으므로 같은 측정으로 헤더 넣기에 들어가고, 넓어지면 같은 측정으로 돌아간다.
  it('헤더 자리가 있으면 동그라미 다음 안정 대기 뒤 헤더로 넣고, 160 + 40px 를 넘으면 돌아간다', async () => {
    let chipLeft = 120
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const left = this.hasAttribute('data-ai-chip') ? chipLeft : 0
      return { left, right: left + 32, width: 32 } as DOMRect
    })
    render(<HeaderDensityProvider><Fixture mounted dock /></HeaderDensityProvider>)
    const status = () => screen.getByRole('status')
    await waitFor(() => expect(status().textContent).toBe('true/true'), { timeout: 2000 })
    await waitFor(() => expect(status().dataset.docked).toBe('true'), { timeout: 2000 })
    // 제목 자리 200px(= 216 − 16)는 이력 구간이라 그대로 헤더에 있다.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)) })
    chipLeft = 216
    act(() => window.dispatchEvent(new Event('resize')))
    expect(status().dataset.docked).toBe('true')
    chipLeft = 217
    act(() => window.dispatchEvent(new Event('resize')))
    expect(status().dataset.docked).toBe('false')
    expect(status().textContent).toBe('true/true')
  })

  // WP-1612: 패널이 열려 틀이 left 전환으로 옮겨 가도 크기는 그대로라 ResizeObserver 가 깨우지 않는다.
  // 전환이 끝난(틀 자신의 left transitionend) 뒤 다시 재야 짧은 경로에서도 헤더 넣기까지 간다.
  it('틀의 left 전환이 끝나면 다시 재 헤더 넣기까지 가고, 다른 속성·자식에서 버블된 종료는 무시한다', async () => {
    // 관찰자는 observe 직후 첫 알림만 준다(WP-2078 — 첫 값은 이 알림이 넣는다). 그 뒤로는 크기 변화 없이 위치만 바뀌는 상황.
    stubRo({ auto: true })
    let chipLeft = 500
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const left = this.hasAttribute('data-ai-chip') ? chipLeft : 0
      return { left, right: left + 32, width: 32 } as DOMRect
    })
    render(<HeaderDensityProvider><Fixture mounted dock /></HeaderDensityProvider>)
    const status = () => screen.getByRole('status')
    const chip = document.querySelector<HTMLElement>('[data-ai-chip]')!
    const end = (target: Element, propertyName: string) => act(() => {
      const event = new Event('transitionend', { bubbles: true })
      Object.defineProperty(event, 'propertyName', { value: propertyName })
      target.dispatchEvent(event)
    })
    await waitFor(() => expect(chip.style.getPropertyValue('--ai-actions-width')).toBe('32px'))
    expect(status().textContent).toBe('false/false')
    // 전환 끝에 옮겨 간 자리 — 제목 자리 104px.
    chipLeft = 120
    end(chip, 'width')
    end(chip.querySelector('[data-ai-density-chip]')!, 'left')
    expect(status().textContent).toBe('false/false')
    end(chip, 'left')
    expect(status().textContent).toBe('true/false')
    await waitFor(() => expect(status().dataset.docked).toBe('true'), { timeout: 2000 })
    expect(status().textContent).toBe('true/true')
  })

  it('헤더 자리가 없으면 끝까지 좁아도 헤더 넣기에 들어가지 않는다', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const left = this.hasAttribute('data-ai-chip') ? 120 : 0
      return { left, right: left + 32, width: 32 } as DOMRect
    })
    render(<HeaderDensityProvider><Fixture mounted /></HeaderDensityProvider>)
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('true/true'))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)) })
    expect(screen.getByRole('status').dataset.docked).toBe('false')
  })

  it('접기 이동이 안정된 뒤 실측한 250px를 복귀 여유로 보존한다', async () => {
    let chipLeft = 120
    let actionsRight = 716
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const width = this.hasAttribute('data-ai-actions') ? (screen.queryByRole('status')?.textContent?.startsWith('true') ? 150 : 400) : 100
      const left = this.hasAttribute('data-ai-chip') ? chipLeft : 0
      return { left, right: this.hasAttribute('data-ai-actions') ? actionsRight : left + width, width } as DOMRect
    })
    render(<HeaderDensityProvider><Fixture mounted /></HeaderDensityProvider>)
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('true/false'))
    chipLeft = 370
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)) })
    expect(screen.getByRole('status').textContent).toBe('true/false')
    chipLeft = 427
    actionsRight = 773
    act(() => window.dispatchEvent(new Event('resize')))
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('false/false'))
  })

  // WP-2078: 첫 마운트 커밋 안에서는 레이아웃을 읽지 않고 ResizeObserver 첫 알림이 값을 넣는다.
  describe('첫 적용 타이밍(WP-2078)', () => {
    const chipEl = () => document.querySelector<HTMLElement>('[data-ai-chip]')!

    it('첫 마운트 커밋에서는 칩 변수를 쓰지 않고 RO 첫 알림이 넣는다', () => {
      const ro = stubRo()
      const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 100 } as DOMRect)
      act(() => { render(<HeaderDensityProvider><Fixture mounted={false} chipMounted /></HeaderDensityProvider>) })
      const calls = spy.mock.calls.length
      // 밀도 판정(Provider)은 별도 효과에서 읽을 수 있어, 훅이 만든 칩 변수가 아직 없음으로 확인한다.
      expect(chipEl().style.getPropertyValue('--ai-actions-width')).toBe('')
      expect(chipEl().style.getPropertyValue('--ai-chip-offset')).toBe('')
      ro.notify()
      expect(spy.mock.calls.length).toBeGreaterThan(calls)
      expect(chipEl().style.getPropertyValue('--ai-actions-width')).toBe('0px')
      expect(chipEl().style.getPropertyValue('--ai-chip-offset')).toBe('162px')
    })

    it('RO 첫 적용은 위치 전환을 끄고 다음 프레임에 되돌린다', () => {
      const ro = stubRo()
      let frame: FrameRequestCallback | null = null
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => { frame = cb; return 7 })
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 100 } as DOMRect)
      act(() => { render(<HeaderDensityProvider><Fixture mounted={false} chipMounted /></HeaderDensityProvider>) })
      chipEl().style.transitionProperty = 'left'
      ro.notify()
      expect(chipEl().style.transitionProperty).toBe('none')
      act(() => { frame?.(0) })
      expect(chipEl().style.transitionProperty).toBe('left')
    })

    it('액션이 사라지면 RO 재관찰 알림으로 액션 폭을 0px 로 맞춘다', async () => {
      const ro = stubRo()
      mockRects()
      act(() => { render(<HeaderDensityProvider><Fixture mounted /></HeaderDensityProvider>) })
      ro.notify()
      expect(chipEl().style.getPropertyValue('--ai-actions-width')).toBe('100px')
      document.querySelector('[data-ai-actions]')!.remove()
      ro.observed.length = 0
      await act(async () => { await Promise.resolve() })
      // 액션이 사라지면 칩만 다시 관찰한다.
      expect(ro.observed).toContain(chipEl())
      expect(ro.observed.some(el => el.hasAttribute('data-ai-actions'))).toBe(false)
      ro.notify()
      expect(chipEl().style.getPropertyValue('--ai-actions-width')).toBe('0px')
    })

    it('헤더 등록 커밋(null -> 요소)에서도 칩 변수를 쓰지 않고 RO 첫 알림이 넣는다', () => {
      const ro = stubRo()
      mockRects()
      act(() => { render(<HeaderDensityProvider><Fixture mounted /></HeaderDensityProvider>) })
      expect(chipEl().style.getPropertyValue('--ai-actions-width')).toBe('')
      expect(chipEl().style.getPropertyValue('--ai-chip-offset')).toBe('')
      ro.notify()
      expect(chipEl().style.getPropertyValue('--ai-actions-width')).toBe('100px')
      expect(chipEl().style.getPropertyValue('--ai-chip-offset')).toBe('162px')
    })

    it('칩을 이미 맞춘 뒤 늦게 등록된 헤더는 같은 커밋에서 동기로 칩 변수를 맞춘다', () => {
      const ro = stubRo()
      mockRects()
      let view!: ReturnType<typeof render>
      act(() => { view = render(<HeaderDensityProvider><Fixture mounted={false} chipMounted /></HeaderDensityProvider>) })
      // 헤더 없이 칩이 먼저 첫 적용을 마친다(콜드 로드에서 페이지 청크가 늦게 오는 경우).
      ro.notify()
      expect(chipEl().style.getPropertyValue('--ai-actions-width')).toBe('0px')
      // 헤더 등록 커밋 — RO 알림 없이도 이 커밋에서 값이 맞아야 한다(알림까지 기다리면 전환이 켜진 채 미끄러진다).
      act(() => { view.rerender(<HeaderDensityProvider><Fixture mounted /></HeaderDensityProvider>) })
      expect(chipEl().style.getPropertyValue('--ai-actions-width')).toBe('100px')
    })

    it('언마운트하면 대기 중인 rAF 를 취소한다', () => {
      const ro = stubRo()
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 42)
      const cancel = vi.spyOn(window, 'cancelAnimationFrame')
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 100 } as DOMRect)
      let view!: ReturnType<typeof render>
      act(() => { view = render(<HeaderDensityProvider><Fixture mounted={false} chipMounted /></HeaderDensityProvider>) })
      ro.notify()
      view.unmount()
      expect(cancel).toHaveBeenCalledWith(42)
    })
  })
})
