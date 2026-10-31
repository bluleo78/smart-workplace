// 지금 보는 대상 스토어·단축키 판정(WP-1234).
import { describe, expect, it, vi } from 'vitest'

import { detectMacLike } from './platform'
import { createShareTargetStore, matchShareHotkey, shareShortcutLabels, type ShareTarget } from './shareTarget'

const issue: ShareTarget = { kind: 'issue', url: 'http://x/projects/WP/issues/1', title: 'A', key: 'WP-1' }
const file: ShareTarget = { kind: 'file', url: 'http://x/drive/spaces/1?preview=2', title: 'b.pdf' }

describe('createShareTargetStore', () => {
  it('마지막에 등록한 대상이 이기고, 그 등록자가 빠지면 앞 대상으로 돌아간다', () => {
    const store = createShareTargetStore()
    const list = Symbol('list')
    const viewer = Symbol('viewer')
    store.set(list, issue)
    store.set(viewer, file)
    expect(store.get()).toBe(file)
    store.release(viewer)
    expect(store.get()).toBe(issue)
  })

  it('같은 등록자의 갱신은 자리를 지킨다 — 아래 화면이 다시 그려져도 위 화면을 앞지르지 않는다', () => {
    const store = createShareTargetStore()
    const list = Symbol('list')
    store.set(list, issue)
    store.set(Symbol('viewer'), file)
    store.set(list, { ...issue, title: 'A2' })
    expect(store.get()).toBe(file)
  })

  it('목록에서 고른 줄(selection)은 목록 화면(page)보다 이기고 뷰어(overlay)에는 진다 — 등록 순서와 무관(WP-1236)', () => {
    const store = createShareTargetStore()
    const folder: ShareTarget = { kind: 'folder', url: 'http://x/drive/spaces/1', title: '루트' }
    const row = Symbol('row')
    // 자식(줄 선택)이 부모(목록 화면)보다 먼저 등록돼도 selection 이 이긴다.
    store.set(row, issue, 'selection')
    store.set(Symbol('page'), folder)
    expect(store.get()).toBe(issue)
    const viewer = Symbol('viewer')
    store.set(viewer, file, 'overlay')
    expect(store.get()).toBe(file)
    store.release(viewer)
    // 고른 줄이 풀리면(null) 다시 목록 화면.
    store.set(row, null, 'selection')
    expect(store.get()).toBe(folder)
  })

  it('갱신한 값(함수 포함)을 그대로 돌려준다', () => {
    const store = createShareTargetStore()
    const t = Symbol('page')
    const first = vi.fn()
    const second = vi.fn()
    store.set(t, { ...file, onExternalShare: first })
    store.set(t, { ...file, onExternalShare: second })
    expect(store.get()?.onExternalShare).toBe(second)
  })

  it('null 이면 대상으로 쓰지 않고, 아무도 없으면 null', () => {
    const store = createShareTargetStore()
    const t = Symbol('a')
    store.set(t, issue)
    store.set(t, null)
    expect(store.get()).toBeNull()
  })

  it('null → 값으로 바뀌어도 자리를 지킨다 — 뒤에 등록한 같은 층을 앞지르지 않는다', () => {
    const store = createShareTargetStore()
    const list = Symbol('list')
    const detail = Symbol('detail')
    store.set(list, null) // 로딩 중
    store.set(detail, file)
    store.set(list, issue) // 로딩이 끝나도 맨 뒤로 가지 않는다
    expect(store.get()).toBe(file)
    store.set(detail, null)
    expect(store.get()).toBe(issue)
    store.set(detail, file) // 다시 값이 생기면 제 자리(뒤)로 이긴다
    expect(store.get()).toBe(file)
  })

  it('overlay 는 page 보다 먼저 등록돼도 이긴다 — 자식(뷰어) effect 가 부모(상세 화면)보다 먼저 돈다', () => {
    const store = createShareTargetStore()
    const viewer = Symbol('viewer')
    const page = Symbol('page')
    store.set(viewer, file, 'overlay')
    store.set(page, issue)
    expect(store.get()).toBe(file)
    store.release(viewer)
    expect(store.get()).toBe(issue)
  })

  it('값이 null 인 overlay 는 건너뛰고 page 로 돌아간다', () => {
    const store = createShareTargetStore()
    const viewer = Symbol('viewer')
    store.set(viewer, null, 'overlay')
    store.set(Symbol('page'), issue)
    expect(store.get()).toBe(issue)
  })
})

const key = (over: Partial<KeyboardEvent>) =>
  ({ code: '', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...over }) as KeyboardEvent

describe('matchShareHotkey', () => {
  const MAC = true
  const WIN = false

  it('⇧⌘,(Mac) 와 Ctrl+Shift+,(Windows) 는 링크 복사 — 쉼표는 code 로 본다(Shift 로 key 가 < 가 되는 배열)', () => {
    expect(matchShareHotkey(key({ code: 'Comma', metaKey: true, shiftKey: true }), MAC)).toBe('link')
    expect(matchShareHotkey(key({ code: 'Comma', ctrlKey: true, shiftKey: true }), WIN)).toBe('link')
  })

  it('⌘.(Mac) 와 Ctrl+.(Windows) 는 키 복사', () => {
    expect(matchShareHotkey(key({ code: 'Period', metaKey: true }), MAC)).toBe('key')
    expect(matchShareHotkey(key({ code: 'Period', ctrlKey: true }), WIN)).toBe('key')
  })

  it('플랫폼의 주 수식 키만 받는다 — Windows 의 Win+.(이모지 패널)·Mac 의 Ctrl 조합은 가로채지 않는다', () => {
    expect(matchShareHotkey(key({ code: 'Period', metaKey: true }), WIN)).toBeNull()
    expect(matchShareHotkey(key({ code: 'Comma', metaKey: true, shiftKey: true }), WIN)).toBeNull()
    expect(matchShareHotkey(key({ code: 'Period', ctrlKey: true }), MAC)).toBeNull()
    expect(matchShareHotkey(key({ code: 'Comma', ctrlKey: true, shiftKey: true }), MAC)).toBeNull()
    expect(matchShareHotkey(key({ code: 'Period', ctrlKey: true, metaKey: true }), MAC)).toBeNull()
  })

  it('수식 키가 모자라거나 Alt 가 섞이면 단축키가 아니다', () => {
    expect(matchShareHotkey(key({ code: 'Comma', metaKey: true }), MAC)).toBeNull() // ⌘, 는 설정 열기 관례 — 가로채지 않는다
    expect(matchShareHotkey(key({ code: 'Comma', shiftKey: true }), MAC)).toBeNull()
    expect(matchShareHotkey(key({ code: 'Comma', metaKey: true, shiftKey: true, altKey: true }), MAC)).toBeNull()
    expect(matchShareHotkey(key({ code: 'Period', metaKey: true, shiftKey: true }), MAC)).toBeNull()
    expect(matchShareHotkey(key({ code: 'KeyK', metaKey: true }), MAC)).toBeNull()
  })
})

describe('shareShortcutLabels', () => {
  it('macOS·iOS 는 ⌘ 기호, 그 밖은 Ctrl 글자', () => {
    expect(shareShortcutLabels(detectMacLike('MacIntel'))).toEqual({ link: '⇧⌘,', key: '⌘.' })
    expect(shareShortcutLabels(detectMacLike('iPhone'))).toEqual({ link: '⇧⌘,', key: '⌘.' })
    expect(shareShortcutLabels(detectMacLike('Win32'))).toEqual({ link: 'Ctrl+Shift+,', key: 'Ctrl+.' })
  })
})
