import './dom-install'

import { Document } from '@hocuspocus/server'
import { COLLAB_AI_MARKERS_FIELD, parseAiMarkers } from '@smart-workplace/wiki-editor-schema'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'

import { AiMarkerBoard } from './aiMarkers'
import { FRAGMENT, markdownToYUpdate } from './markdownCodec'

// ✦ 표식판 단위 — 실제 Hocuspocus Document 의 서버 awareness 에 올리고 내리는지, 타이머가 문서·프로세스를 붙잡지 않는지.
describe('AiMarkerBoard', () => {
  const docs: Document[] = []
  const newDoc = (md = '# 제목\n\n첫 문단\n\n둘째 문단') => {
    const doc = new Document(`wiki-page:${docs.length + 1}`)
    Y.applyUpdate(doc, markdownToYUpdate(md))
    docs.push(doc)
    return doc
  }
  /** 서버 상태의 표식 — 상태가 지워졌으면(null) 빈 목록. */
  const markersOf = (doc: Document) => parseAiMarkers(doc.awareness.getLocalState()?.[COLLAB_AI_MARKERS_FIELD])
  /** blockIndex 번째 블록 시작에 표식을 올린다 — 서버의 적용 경로처럼 anchorAt 으로 위치를 잡고(없으면 올리지 않음) showAt. */
  const show = (board: AiMarkerBoard, doc: Document, actor: { userId: number; name: string }, blockIndex: number) => {
    const anchor = board.anchorAt(doc, blockIndex)
    if (anchor) board.showAt(doc, actor, anchor)
  }
  const A = { userId: 5, name: '양동희' }
  const B = { userId: 8, name: '이영희' }

  afterEach(() => {
    vi.useRealTimers()
    for (const d of docs.splice(0)) if (!d.isDestroyed) d.destroy()
  })

  it('publishes a marker at the block start, clamps the index, and clears the state after the ttl', () => {
    vi.useFakeTimers()
    const board = new AiMarkerBoard(3000)
    const doc = newDoc()
    show(board, doc, A, 99)
    const [m] = markersOf(doc)
    expect(m).toMatchObject({ userId: 5, name: '양동희' })
    const abs = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(m.anchor), doc)
    expect(abs?.type).toBe(doc.getXmlFragment(FRAGMENT))
    expect(abs?.index).toBe(2) // 마지막 블록으로 당겨진다
    vi.advanceTimersByTime(2999)
    expect(markersOf(doc)).toHaveLength(1)
    vi.advanceTimersByTime(1)
    // 비면 상태 자체를 null 로 — 클라이언트에서 서버 항목이 사라진다.
    expect(doc.awareness.getLocalState()).toBeNull()
    expect(board.trackedDocs).toBe(0)
    expect(board.pendingTimers()).toEqual([])
  })

  it("replaces the same person's marker (cancelling its timer) and keeps another person's", () => {
    vi.useFakeTimers()
    const board = new AiMarkerBoard(3000)
    const doc = newDoc()
    show(board, doc, A, 0)
    vi.advanceTimersByTime(2000)
    show(board, doc, B, 2)
    show(board, doc, A, 1)
    expect(markersOf(doc).map((m) => m.name)).toEqual(['이영희', '양동희'])
    expect(board.pendingTimers()).toHaveLength(2)
    // 첫 A 표식의 원래 만료 시각 — 옮겨진 A 표식은 그대로 남는다.
    vi.advanceTimersByTime(1500)
    expect(markersOf(doc).map((m) => m.name)).toEqual(['이영희', '양동희'])
    vi.advanceTimersByTime(1500)
    expect(markersOf(doc)).toEqual([])
  })

  it('keeps documents apart', () => {
    vi.useFakeTimers()
    const board = new AiMarkerBoard(3000)
    const d1 = newDoc()
    const d2 = newDoc()
    show(board, d1, A, 0)
    expect(markersOf(d1)).toHaveLength(1)
    expect(markersOf(d2)).toEqual([])
  })

  it('shows nothing on an empty document', () => {
    const board = new AiMarkerBoard(3000)
    const doc = new Document('wiki-page:empty')
    docs.push(doc)
    show(board, doc, A, 0)
    expect(doc.awareness.getLocalState()).toBeNull()
    expect(board.pendingTimers()).toEqual([])
  })

  it('does not keep the process alive', () => {
    const board = new AiMarkerBoard(60_000)
    show(board, newDoc(), A, 0)
    const timers = board.pendingTimers()
    expect(timers).toHaveLength(1)
    expect(timers[0].hasRef()).toBe(false)
    board.destroy()
  })

  it('drops the markers and timers of a document as it unloads (destroy)', () => {
    // 문서(awareness 의 갱신 interval)는 진짜 타이머로 만든다 — 가짜 타이머 수에는 표식 타이머만 잡히게.
    const doc = newDoc()
    const other = newDoc()
    vi.useFakeTimers()
    const board = new AiMarkerBoard(3000)
    show(board, doc, A, 0)
    show(board, other, B, 0)
    doc.destroy()
    expect(board.trackedDocs).toBe(1)
    expect(board.pendingTimers()).toHaveLength(1)
    expect(vi.getTimerCount()).toBe(1)
    vi.advanceTimersByTime(3000)
    expect(markersOf(other)).toEqual([])
    expect(board.trackedDocs).toBe(0)
  })

  it('cancels every timer on destroy', () => {
    const d1 = newDoc()
    const d2 = newDoc()
    vi.useFakeTimers()
    const board = new AiMarkerBoard(3000)
    show(board, d1, A, 0)
    show(board, d2, B, 0)
    expect(vi.getTimerCount()).toBe(2)
    board.destroy()
    expect(board.pendingTimers()).toEqual([])
    expect(board.trackedDocs).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })
})
