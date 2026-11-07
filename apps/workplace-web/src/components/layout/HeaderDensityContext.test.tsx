// 늦게 나타난 포털과 헤더도 연결하고 접기 전환이 끝난 뒤에만 다음 단계를 판정한다.
import { act, render, screen, waitFor } from '@testing-library/react'
import { createPortal } from 'react-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { HeaderDensityProvider, useHeaderDensity, useHeaderDensityHeader } from './HeaderDensityContext'
import { useAiActionsWidth } from './useAiActionsWidth'

function Fixture({ mounted, chipMounted = mounted }: { mounted: boolean; chipMounted?: boolean }) {
  useAiActionsWidth()
  const { folded, circle } = useHeaderDensity()
  const register = useHeaderDensityHeader()
  return <>
    <output>{`${folded}/${circle}`}</output>
    {mounted && <header ref={register} data-ai-has-auxiliary-actions="true">
      <div data-ai-left-group />
      <div data-ai-actions>{folded ? '더보기' : '설정'}</div>
    </header>}
    {chipMounted && createPortal(<div data-ai-chip />, document.body)}
  </>
}

describe('HeaderDensityProvider', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

  it('제공자 이후 나타난 헤더와 포털을 측정해 접은 다음 동그라미로 줄인다', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return { left: this.hasAttribute('data-ai-chip') ? 120 : 0, width: 100 } as DOMRect
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
      return { left: this.hasAttribute('data-ai-chip') ? chipLeft : 0, width: 100 } as DOMRect
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

  it('접기 이동이 안정된 뒤 실측한 250px를 복귀 여유로 보존한다', async () => {
    let chipLeft = 120
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return { left: this.hasAttribute('data-ai-chip') ? chipLeft : 0, width: 100 } as DOMRect
    })
    render(<HeaderDensityProvider><Fixture mounted /></HeaderDensityProvider>)
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('true/false'))
    chipLeft = 370
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)) })
    expect(screen.getByRole('status').textContent).toBe('true/false')
    chipLeft = 427
    act(() => window.dispatchEvent(new Event('resize')))
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('false/false'))
  })
})
