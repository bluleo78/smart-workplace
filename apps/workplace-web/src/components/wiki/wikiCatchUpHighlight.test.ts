// @vitest-environment jsdom
import { wikiSchemaExtensions } from '@smart-workplace/wiki-editor-schema'
import { Editor } from '@tiptap/core'
import { Schema } from '@tiptap/pm/model'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CATCHUP_HIGHLIGHT_MS } from '@/lib/collab/collabResume'

import {
  changedBlockRanges,
  highlightCatchUp,
  watchHiddenDoc,
  WikiCatchUpHighlight,
  wikiCatchUpHighlightKey,
} from './wikiCatchUpHighlight'

// 최소 스키마 — 문단만(블록 비교 규칙은 노드 종류와 무관하다).
const schema = new Schema({
  nodes: { doc: { content: 'block+' }, paragraph: { group: 'block', content: 'text*' }, text: {} },
})
const doc = (...texts: string[]) =>
  schema.node('doc', null, texts.map((t) => schema.node('paragraph', null, t ? [schema.text(t)] : [])))
const textAt = (d: ReturnType<typeof doc>, r: { from: number; to: number }) => d.textBetween(r.from, r.to)

describe('changedBlockRanges', () => {
  it('returns inserted and edited top-level blocks only', () => {
    const before = doc('하나', '둘', '셋')
    const after = doc('하나', '새 문단', '둘 고침', '셋')
    expect(changedBlockRanges(before, after).map((r) => textAt(after, r))).toEqual(['새 문단', '둘 고침'])
  })

  it('treats duplicated blocks as a multiset so an added copy is still highlighted', () => {
    const before = doc('같은 줄')
    const after = doc('같은 줄', '같은 줄')
    expect(changedBlockRanges(before, after)).toHaveLength(1)
  })

  it('is empty when nothing changed or only blocks were removed', () => {
    expect(changedBlockRanges(doc('a', 'b'), doc('a', 'b'))).toEqual([])
    expect(changedBlockRanges(doc('a', 'b'), doc('a'))).toEqual([])
  })
})

describe('highlightCatchUp', () => {
  const editors: Editor[] = []
  afterEach(() => {
    editors.splice(0).forEach((e) => !e.isDestroyed && e.destroy())
    vi.useRealTimers()
  })
  /** 숨길 때 "하나" 였던 본문이 돌아와 "하나 / 새 문단" 이 된 에디터. */
  function setup() {
    const editor = new Editor({ extensions: [...wikiSchemaExtensions(), WikiCatchUpHighlight], content: '<p>하나</p>' })
    editors.push(editor)
    const before = editor.state.doc
    editor.commands.setContent('<p>하나</p><p>새 문단</p>')
    return { editor, before }
  }
  const highlighted = (e: Editor) => wikiCatchUpHighlightKey.getState(e.state)?.find().length ?? 0

  it('clears the highlight after CATCHUP_HIGHLIGHT_MS', () => {
    vi.useFakeTimers()
    const { editor, before } = setup()
    highlightCatchUp(editor.view, before)
    expect(highlighted(editor)).toBe(1)
    vi.advanceTimersByTime(CATCHUP_HIGHLIGHT_MS)
    expect(highlighted(editor)).toBe(0)
  })

  it('removes the highlight when cleaned up early (effect re-run) instead of leaving it on for good', () => {
    vi.useFakeTimers()
    const { editor, before } = setup()
    const cleanup = highlightCatchUp(editor.view, before)
    expect(highlighted(editor)).toBe(1)
    cleanup()
    expect(highlighted(editor)).toBe(0)
    vi.advanceTimersByTime(CATCHUP_HIGHLIGHT_MS)
    expect(highlighted(editor)).toBe(0)
  })

  it('cleanup after the editor is destroyed does nothing', () => {
    const { editor, before } = setup()
    const cleanup = highlightCatchUp(editor.view, before)
    editor.destroy()
    expect(() => cleanup()).not.toThrow()
  })
})

describe('watchHiddenDoc', () => {
  function setVisibility(state: 'hidden' | 'visible') {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
    document.dispatchEvent(new Event('visibilitychange'))
  }
  afterEach(() => setVisibility('visible'))

  it('keeps the first snapshot across hide→visible→hide before the resume is handled (session carries its baseline)', () => {
    const first = doc('하나')
    let current = first
    const w = watchHiddenDoc(() => current)
    setVisibility('hidden')
    setVisibility('visible')
    current = doc('하나', '내 입력')
    setVisibility('hidden')
    setVisibility('visible')
    expect(w.take()).toBe(first)
    // 한 번 쓰면 비워진다 — 다음 자리 비움에 다시 쓰이지 않는다.
    expect(w.take()).toBeNull()
    w.dispose()
  })

  it('forgets the snapshot and stops listening on dispose', () => {
    const w = watchHiddenDoc(() => doc('a'))
    setVisibility('hidden')
    w.dispose()
    expect(w.take()).toBeNull()
    setVisibility('visible')
    setVisibility('hidden')
    expect(w.take()).toBeNull()
  })
})
