// 늦게 나타난 포털과 헤더도 연결하고 접기 전환이 끝난 뒤에만 다음 단계를 판정한다.
import { act, render, screen, waitFor } from '@testing-library/react'
import { createPortal } from 'react-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { HeaderDensityProvider, useHeaderDensity, useHeaderDensityHeader } from './HeaderDensityContext'
import { useAiActionsWidth } from './useAiActionsWidth'

function Fixture({ mounted, chipMounted = mounted, ai = true }: { mounted: boolean; chipMounted?: boolean; ai?: boolean }) {
  useAiActionsWidth()
  const { folded, circle } = useHeaderDensity()
  const register = useHeaderDensityHeader()
  return <>
    <output>{`${folded}/${circle}`}</output>
    {mounted && <header ref={register} data-ai-has-auxiliary-actions="true">
      <div data-ai-left-group />
      <div data-ai-actions>{folded ? '더보기' : '설정'}</div>
    </header>}
    {chipMounted && createPortal(<div data-ai-chip>{ai && <button data-ai-density-chip />}</div>, document.body)}
  </>
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
    const observers: { targets: Set<Element>; notify: () => void }[] = []
    vi.stubGlobal('ResizeObserver', class {
      targets = new Set<Element>()
      notify: () => void
      constructor(notify: () => void) { this.notify = notify; observers.push(this) }
      observe(target: Element) { this.targets.add(target) }
      disconnect() { this.targets.clear() }
    })
    let chipLeft = 500
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const left = this.hasAttribute('data-ai-chip') ? chipLeft : 0
      return { left, right: left + 100, width: 100 } as DOMRect
    })
    const view = render(<HeaderDensityProvider><Fixture mounted={false} /></HeaderDensityProvider>)
    view.rerender(<HeaderDensityProvider><Fixture mounted /></HeaderDensityProvider>)
    await waitFor(() => expect(document.querySelector<HTMLElement>('[data-ai-chip]')?.style.getPropertyValue('--ai-actions-width')).toBe('100px'))
    chipLeft = 120
    act(() => {
      const chip = document.querySelector('[data-ai-chip]')!
      for (const observer of observers) if (observer.targets.has(chip)) observer.notify()
    })
    expect(screen.getByRole('status').textContent).toBe('true/false')
  })

  it('헤더 액션이 그대로인 상태에서 늦게 추가된 칩에도 액션 폭을 전달한다', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 500, width: 100 } as DOMRect)
    const view = render(<HeaderDensityProvider><Fixture mounted chipMounted={false} /></HeaderDensityProvider>)
    view.rerender(<HeaderDensityProvider><Fixture mounted /></HeaderDensityProvider>)
    await waitFor(() => expect(document.querySelector<HTMLElement>('[data-ai-chip]')?.style.getPropertyValue('--ai-actions-width')).toBe('100px'))
  })

  it.each([-200, 100])('접기 안정 대기 중 액션 오른쪽 경계가 %ipx 이동해도 접기 폭만 복귀 여유로 쓴다', async (resize) => {
    let right = 1000
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const folded = screen.queryByRole('status')?.textContent?.startsWith('true') ?? false
      const actionsWidth = folded ? 428 : 678
      const left = this.hasAttribute('data-ai-chip') ? right - actionsWidth - 156 : 0
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
    let right = 1000
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const folded = screen.queryByRole('status')?.textContent?.startsWith('true') ?? false
      const actionsWidth = folded ? 428 : 678
      const left = this.hasAttribute('data-ai-chip') ? Math.min(216, right - actionsWidth - 156) : 0
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
    expect(document.querySelector<HTMLElement>('[data-ai-chip]')?.style.getPropertyValue('--ai-chip-offset')).toBe('88px')
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)) })
    chipLeft = 300
    act(() => window.dispatchEvent(new Event('resize')))
    expect(screen.getByRole('status').textContent).toBe('true/false')
    expect(document.querySelector<HTMLElement>('[data-ai-chip]')?.style.getPropertyValue('--ai-chip-offset')).toBe('142px')
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

  it('접기 이동이 안정된 뒤 실측한 250px를 복귀 여유로 보존한다', async () => {
    let chipLeft = 120
    let actionsRight = 676
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
    actionsRight = 733
    act(() => window.dispatchEvent(new Event('resize')))
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('false/false'))
  })
})
