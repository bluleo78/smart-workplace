import type { Document } from '@hocuspocus/server'

/** 에디터 안 AI 적용 태그 — 요청자(actorId)·요청(requestId)과 만료 시각(epoch ms). */
export interface AiTag {
  actorId: number
  requestId: string
  expiresAt: number
}

/** 문서 하나의 태그 상태 — 지금 태그와 그 만료 타이머, 즉시 저장 예약, flush 를 기다리는 ai-apply 요청들. */
interface DocAiTag {
  tag?: AiTag
  timer?: NodeJS.Timeout
  /** 다음 연결 변경 때 디바운스 없이 저장한다(AI 결과 삽입이 곧바로 태그를 소비하게) — 태그가 소비·취소·만료되면 풀린다. */
  storeNext: boolean
  /** flush 를 기다리는 중인 ai-apply(`${actorId}\n${requestId}`) — 그사이 온 ai-cancel 이 지운다. 여러 사용자가 겹칠 수 있어 집합. */
  pending: Set<string>
}

/**
 * 에디터 안 AI 적용 태그(WP-323)의 수명을 맡는다 — 웹의 ai-apply 를 처리한 뒤 문서에 달고, 태그가 달린 뒤 처음 상태를 인코딩하는
 * 저장(persist)이 꺼내(take) 'AI' 사유 + actorId 로 저장한다(API 가 직전 저장 판 = AI 직전 판을 ✦ 리비전으로 남긴다).
 * requestId 는 취소(ai-cancel)를 짝짓고, 만료(ttlMs)가 지나면 무효 — 삽입이 끝내 오지 않거나 취소가 유실돼도 다음 사람 저장에
 * 거짓 ✦ 가 붙지 않게.
 *
 * 수명:
 * - 상태는 Document 객체 단위로만 다룬다(이름으로 찾지 않음) — 같은 이름으로 다시 올라온 문서·다른 테넌트 문서에 섞이지 않는다.
 * - 문서가 내려가거나(beforeUnloadDocument) 페이지가 없어지면(dropGone) dispose 로 태그·타이머·대기 표시를 모두 지운다.
 * - 종료(shutdown)는 타이머만 지우고 태그는 남겨 마지막 저장이 싣게 한다 — 만료는 take 가 expiresAt 으로 다시 본다.
 * - 저장이 실패(페이지 삭제 제외)하면 restore 로 되돌린다 — 더 새 태그가 없을 때만, 만료를 지금부터 다시 센다(재시도 저장이 같은 판을
 *   다시 실을 때도 AI 사유가 남게. 처음 만료 시각을 쓰면 장애가 TTL 보다 길 때 ✦ 가 빠진다). 즉시 저장 예약은 걸지 않는다(재시도가 저장).
 *
 * 감수한 한계(설계상 허용, 이슈에 기록):
 * - ack 와 삽입 사이에 사람 편집만 담긴 저장이 먼저 태그를 소비할 수 있다 — ✦ 는 여전히 flush 된 AI 직전 판에 붙는다.
 * - 두 사용자의 ai-apply 가 한 왕복 안에 겹치면 요청자 표기가 바뀔 수 있다.
 * - apply-markdown 의 적용 직전 저장(사유 없음)이 에디터 태그를 소비할 수 있다.
 * - 대기 창 동안 들어온 다른 사람 편집은 AI 사유 저장 안에 함께 실린다.
 */
export class AiTagBoard {
  private readonly docs = new Map<Document, DocAiTag>()

  constructor(private readonly ttlMs: number) {}

  /** ai-apply 의 flush 를 시작한다 — 끝날 때 settle 로 꺼낸다(그사이 온 취소를 잃지 않게). */
  begin(doc: Document, actorId: number, requestId: string): void {
    this.entryOf(doc).pending.add(pendingKey(actorId, requestId))
  }

  /** flush 가 끝난 요청의 대기 표시를 꺼낸다 — 그사이 취소됐거나 문서 상태가 지워졌으면(dispose) false(태그·ack 를 하지 않는다). */
  settle(doc: Document, actorId: number, requestId: string): boolean {
    const entry = this.docs.get(doc)
    if (!entry) return false
    const waiting = entry.pending.delete(pendingKey(actorId, requestId))
    this.prune(doc, entry)
    return waiting
  }

  /** 이 요청의 태그를 단다(이전 태그는 덮는다) — 다음 연결 변경을 디바운스 없이 저장하도록 예약한다(태그가 만료 전에 소비되게). */
  set(doc: Document, actorId: number, requestId: string): void {
    this.put(doc, { actorId, requestId }, true)
  }

  /** ai-cancel — 같은 사용자·같은 요청의 대기 표시·태그만 지운다(다른 사람·옛 요청의 취소가 새 태그를 지우지 않게). */
  cancel(doc: Document, actorId: number, requestId: string): void {
    const entry = this.docs.get(doc)
    if (!entry) return
    entry.pending.delete(pendingKey(actorId, requestId))
    if (entry.tag?.actorId === actorId && entry.tag.requestId === requestId) this.clearTag(entry)
    this.prune(doc, entry)
  }

  /** 태그를 꺼내 지운다(persist 의 인코딩 시점) — 만료된 태그는 없는 것으로 본다. */
  take(doc: Document): AiTag | undefined {
    const entry = this.docs.get(doc)
    const tag = entry?.tag
    if (!entry || !tag) return undefined
    this.clearTag(entry)
    this.prune(doc, entry)
    return tag.expiresAt > Date.now() ? tag : undefined
  }

  /** 실패한 저장이 꺼낸 태그를 되돌린다 — 그사이 새 태그가 달렸으면 그쪽이 더 최근 요청이라 두지 않는다. 만료는 새로 센다. */
  restore(doc: Document, tag: AiTag): void {
    if (this.docs.get(doc)?.tag) return
    this.put(doc, tag, false)
  }

  /** 즉시 저장 예약을 한 번 꺼낸다(onChange) — 예약돼 있었으면 true 를 돌려주고 푼다. */
  shouldStoreNow(doc: Document): boolean {
    const entry = this.docs.get(doc)
    if (!entry?.storeNext) return false
    entry.storeNext = false
    return true
  }

  /** 문서의 태그·타이머·대기 표시를 모두 지운다 — 언로드·페이지 삭제. */
  dispose(doc: Document): void {
    const entry = this.docs.get(doc)
    if (!entry) return
    this.clearTag(entry)
    entry.pending.clear()
    this.docs.delete(doc)
  }

  /** 종료 — 만료 타이머만 지운다(종료 중 타이머가 프로세스를 붙잡지 않게). 태그는 남겨 마지막 저장이 싣는다. */
  shutdown(): void {
    for (const entry of this.docs.values()) {
      clearTimeout(entry.timer)
      entry.timer = undefined
    }
  }

  private entryOf(doc: Document): DocAiTag {
    let entry = this.docs.get(doc)
    if (!entry) {
      entry = { storeNext: false, pending: new Set() }
      this.docs.set(doc, entry)
    }
    return entry
  }

  /** 태그를 달고(만료 = 지금 + ttl) 만료 타이머를 건다. */
  private put(doc: Document, tag: Omit<AiTag, 'expiresAt'>, storeNext: boolean): void {
    const entry = this.entryOf(doc)
    this.clearTag(entry)
    entry.tag = { actorId: tag.actorId, requestId: tag.requestId, expiresAt: Date.now() + this.ttlMs }
    entry.storeNext = storeNext
    const timer = setTimeout(() => {
      // 그사이 태그가 바뀌었으면(새 타이머) 이 타이머는 무시한다.
      if (entry.timer !== timer) return
      this.clearTag(entry)
      this.prune(doc, entry)
    }, this.ttlMs)
    entry.timer = timer
  }

  /** 태그와 그 만료 타이머·즉시 저장 예약을 지운다(소비·취소·만료). */
  private clearTag(entry: DocAiTag): void {
    clearTimeout(entry.timer)
    entry.timer = undefined
    entry.tag = undefined
    entry.storeNext = false
  }

  /** 태그도 대기 표시도 없는 문서는 지운다 — 내려간 문서의 빈 항목이 남지 않게. */
  private prune(doc: Document, entry: DocAiTag): void {
    if (!entry.tag && entry.pending.size === 0 && this.docs.get(doc) === entry) this.docs.delete(doc)
  }
}

function pendingKey(actorId: number, requestId: string): string {
  return `${actorId}\n${requestId}`
}
