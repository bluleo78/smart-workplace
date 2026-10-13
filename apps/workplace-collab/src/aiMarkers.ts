import type { Document } from '@hocuspocus/server'
import { COLLAB_AI_MARKERS_FIELD, type CollabAiMarker } from '@smart-workplace/wiki-editor-schema'
import * as Y from 'yjs'

import { FRAGMENT } from './markdownCodec'
import type { Clock } from './clock'

/**
 * 표식 만료 타이머를 거는 시계 — 기본은 실제 타이머(unref). 동기화 서버 테스트는 손으로 돌리는 시계(testing/manualClock)를 넣어
 * "표식이 내려갈 때"를 실제 시간이 아니라 테스트가 정한 사건으로 만든다(부하로 메시지가 늦게 와도 표식이 먼저 내려가지 않게).
 */
export type MarkerClock = Pick<Clock, 'setTimeout' | 'clearTimeout'>

/** 실제 타이머 — unref 라 남은 표식이 프로세스 종료를 막지 않는다. */
const realTimers: MarkerClock = {
  setTimeout: (fn, ms) => setTimeout(fn, ms).unref(),
  clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout | undefined),
}

/** 문서 하나의 표식 상태 — 지금 보이는 표식과 표식별 만료 타이머, 언로드(destroy) 감지 리스너. */
interface DocMarkers {
  list: CollabAiMarker[]
  timers: Map<string, unknown>
  onDestroy: () => void
}

/**
 * 서버측 ✦ 표식(WP-291, 스펙 §5.1-5) — MCP·채팅 비서의 본문이 적용된 자리에 "✦ {요청한 사람}" 을 접속자에게 잠깐 보인다.
 *
 * 문서마다 서버 자신의 awareness 상태 하나에 표식 목록을 담는다(Hocuspocus Document.awareness — 바뀌면 모든 연결에 방송하고,
 * 늦게 붙는 연결도 접속 시 현재 상태를 받는다). 서버 상태는 처음에 null 이라 setLocalStateField 는 아무것도 하지 않으므로
 * setLocalState 로 통째 갈아 끼운다. 목록이 비면 null 로 지워 클라이언트에서 서버 항목 자체가 사라지게 한다.
 *
 * 수명:
 * - 표식은 Document 객체 단위로만 다룬다(이름으로 찾지 않음) — 같은 이름으로 다시 올라온 문서·다른 테넌트 문서에 섞이지 않는다.
 * - 문서가 내려가면(Y.Doc 'destroy' 이벤트 — Hocuspocus unloadDocument 가 부른다) 그 문서의 타이머·항목을 바로 정리한다.
 * - 타이머는 unref — 남은 표식이 프로세스 종료를 막지 않는다(기본 시계).
 */
export class AiMarkerBoard {
  private seq = 0
  private readonly docs = new Map<Document, DocMarkers>()

  constructor(
    private readonly ttlMs: number,
    private readonly clock: MarkerClock = realTimers,
  ) {}

  /**
   * blockIndex 번째 최상위 블록 시작의 Yjs 상대 위치 — 이후 편집을 따라간다. 적용 직후(동기) 잡아 두고 저장이 끝난 뒤 showAt 으로 올리면,
   * 저장을 기다리는 동안 누가 위에 블록을 넣어도 표식이 AI 가 바꾼 블록을 가리킨다. 빈 문서·내려간 문서면 null.
   */
  anchorAt(doc: Document, blockIndex: number): CollabAiMarker['anchor'] | null {
    if (doc.isDestroyed) return null
    const frag = doc.getXmlFragment(FRAGMENT)
    if (frag.length === 0) return null
    const index = Math.max(0, Math.min(blockIndex, frag.length - 1))
    return Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(frag, index))
  }

  /**
   * anchor 에 actor 표식을 올리고 ttl 뒤 내린다.
   * 같은 사람의 이전 표식은 새 위치로 바꾼다(연속 적용이 쌓이지 않게 — 이전 타이머도 취소). 내려간 문서엔 올리지 않는다.
   */
  showAt(doc: Document, actor: { userId: number; name: string }, anchor: CollabAiMarker['anchor']): void {
    if (doc.isDestroyed) return
    const marker: CollabAiMarker = { id: `srv-${++this.seq}`, userId: actor.userId, name: actor.name, anchor }
    const entry = this.entryOf(doc)
    for (const old of entry.list) if (old.userId === actor.userId) this.cancel(entry, old.id)
    const timer = this.clock.setTimeout(() => {
      entry.timers.delete(marker.id)
      this.publish(doc, entry, entry.list.filter((m) => m.id !== marker.id))
    }, this.ttlMs)
    entry.timers.set(marker.id, timer)
    this.publish(doc, entry, [...entry.list.filter((m) => m.userId !== actor.userId), marker])
  }

  /** 표식이 남은 문서 수(테스트 확인용). */
  get trackedDocs(): number {
    return this.docs.size
  }

  /** 아직 만료되지 않은 타이머(테스트 확인용 — 기본 시계면 NodeJS.Timeout). */
  pendingTimers(): unknown[] {
    return [...this.docs.values()].flatMap((e) => [...e.timers.values()])
  }

  /** 종료 시 남은 타이머·항목 정리(awareness 는 문서 destroy 가 정리한다). */
  destroy(): void {
    for (const doc of [...this.docs.keys()]) this.forget(doc)
  }

  private entryOf(doc: Document): DocMarkers {
    let entry = this.docs.get(doc)
    if (!entry) {
      const onDestroy = () => this.forget(doc)
      entry = { list: [], timers: new Map(), onDestroy }
      doc.on('destroy', onDestroy)
      this.docs.set(doc, entry)
    }
    return entry
  }

  private cancel(entry: DocMarkers, id: string): void {
    this.clock.clearTimeout(entry.timers.get(id))
    entry.timers.delete(id)
  }

  /** 문서의 타이머를 모두 취소하고 항목을 지운다 — 언로드·종료·마지막 표식 만료 때. */
  private forget(doc: Document): void {
    const entry = this.docs.get(doc)
    if (!entry) return
    for (const t of entry.timers.values()) this.clock.clearTimeout(t)
    doc.off('destroy', entry.onDestroy)
    this.docs.delete(doc)
  }

  private publish(doc: Document, entry: DocMarkers, list: CollabAiMarker[]): void {
    entry.list = list
    doc.awareness.setLocalState(list.length > 0 ? { [COLLAB_AI_MARKERS_FIELD]: list } : null)
    if (list.length === 0) this.forget(doc)
  }
}
