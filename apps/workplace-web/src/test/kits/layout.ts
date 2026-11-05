// 레이아웃 흉내 키트(WP-1372) — jsdom 은 레이아웃이 없어 스크롤·화면 진입을 잴 수 없다.
// 「어느 칸을 스크롤했나」「요소가 화면에 들어왔다/나갔다」를 테스트가 직접 보거나 일으킬 수 있게 한다.
// 실제 위치·교차 판정(기하)은 여전히 E2E(@layout) 몫이다. 둘 다 그 테스트가 끝나면 스스로 되돌린다.
import { act } from '@testing-library/react'
import { onTestFinished, vi } from 'vitest'

/**
 * Element.prototype.scrollTo 호출을 모은다 — 어느 요소(this)를 스크롤했는지 본다.
 * setup.ts 의 빈 구현을 감싸므로 동작은 그대로이고, 이 스파이만 되돌린다(파일 맨 위 mockViewport 같은 다른 스파이는 건드리지 않는다).
 */
export function spyScrollTo(): Element[] {
  const scrolled: Element[] = []
  const spy = vi.spyOn(Element.prototype, 'scrollTo').mockImplementation(function (this: Element) {
    scrolled.push(this)
  })
  onTestFinished(() => spy.mockRestore())
  return scrolled
}

type Observer = { callback: IntersectionObserverCallback; targets: Set<Element>; self: IntersectionObserver }

/**
 * 손으로 움직이는 IntersectionObserver — set(predicate) 로 지켜보는 요소마다 화면 안/밖을 정해 콜백을 부른다.
 * setup.ts 의 전역 빈 구현 대신 이 테스트 동안만 쓴다(첫 렌더 전에 부른다).
 */
export function controlIntersection() {
  const observers = new Set<Observer>()
  class FakeIntersectionObserver {
    readonly root = null
    readonly rootMargin = ''
    readonly thresholds = []
    private entry: Observer
    constructor(callback: IntersectionObserverCallback) {
      this.entry = { callback, targets: new Set(), self: this as unknown as IntersectionObserver }
      observers.add(this.entry)
    }
    observe(el: Element) {
      this.entry.targets.add(el)
    }
    unobserve(el: Element) {
      this.entry.targets.delete(el)
    }
    disconnect() {
      observers.delete(this.entry)
    }
    takeRecords() {
      return []
    }
  }
  // 이 전역만 바꾸고 되돌린다(unstubAllGlobals 는 다른 스텁까지 푼다).
  const original = globalThis.IntersectionObserver
  globalThis.IntersectionObserver = FakeIntersectionObserver as unknown as typeof IntersectionObserver
  onTestFinished(() => {
    globalThis.IntersectionObserver = original
  })
  return {
    /** 지켜보는 요소마다 inView(el) 결과로 교차 이벤트를 보낸다. */
    set(inView: (el: Element) => boolean) {
      act(() => {
        for (const o of [...observers]) {
          const entries = [...o.targets].map(
            (target) => ({ target, isIntersecting: inView(target) }) as IntersectionObserverEntry,
          )
          if (entries.length > 0) o.callback(entries, o.self)
        }
      })
    },
  }
}
