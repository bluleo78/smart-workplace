import { Window } from 'happy-dom'

// DOM 전역으로 노출할 이름 — TipTap Editor(EditorView 생성)·tiptap-markdown(DOMParser)이 쓰는 것만.
// WebSocket 은 넣지 않는다: Node 22+ 전역 WebSocket(테스트 클라이언트)을 happy-dom 것으로 덮으면 안 된다.
const GLOBAL_KEYS = [
  'window',
  'document',
  'navigator',
  'DOMParser',
  'Node',
  'HTMLElement',
  'Element',
  'Text',
  'DocumentFragment',
  'MutationObserver',
  'getComputedStyle',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'ClipboardEvent',
  'DragEvent',
  'KeyboardEvent',
  'MouseEvent',
  'InputEvent',
  'Range',
  'Selection',
  'getSelection',
] as const

let installed = false

/**
 * 서버용 DOM 전역 설치(happy-dom) — 헤드리스 TipTap 변환기가 window/document/DOMParser 를 요구한다.
 * 여러 번 불러도 한 번만 설치한다. Node 가 이미 가진 전역(Event·CustomEvent 등)은 덮지 않는다.
 */
export function installServerDom(): void {
  if (installed) return
  installed = true
  const win = new Window({ url: 'http://localhost/' })
  const g = globalThis as Record<string, unknown>
  const source = win as unknown as Record<string, unknown>
  for (const key of GLOBAL_KEYS) {
    const v = key === 'window' ? win : source[key]
    if (v === undefined) continue
    // getComputedStyle·getSelection 은 window 메서드라 this 를 묶어 둔다.
    const value = typeof v === 'function' && key.startsWith('get') ? (v as (...a: unknown[]) => unknown).bind(win) : v
    try {
      Object.defineProperty(g, key, { value, configurable: true, writable: true })
    } catch {
      // navigator 처럼 읽기 전용 전역은 건너뛴다(Node 22+ 는 navigator 를 이미 가짐).
    }
  }
  g.requestAnimationFrame ??= (cb: () => void) => setTimeout(cb, 0)
}
