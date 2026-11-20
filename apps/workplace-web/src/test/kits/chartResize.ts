import { vi } from 'vitest'

/**
 * jsdom 은 레이아웃이 없어 Recharts ResponsiveContainer 가 크기 0 으로 아무것도 안 그린다.
 * observe 되는 즉시 400x200 으로 알려주는 ResizeObserver 로 바꿔 차트 내부(범례·한도선·막대)를 검증한다.
 * (ChartContainer 는 항상 ResponsiveContainer 를 써서 우회할 수 없다.)
 */
export function stubChartResize(width = 400, height = 200) {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      private cb: ResizeObserverCallback
      constructor(cb: ResizeObserverCallback) {
        this.cb = cb
      }
      observe(target: Element) {
        this.cb([{ target, contentRect: { width, height } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver)
      }
      unobserve() {}
      disconnect() {}
    },
  )
}
