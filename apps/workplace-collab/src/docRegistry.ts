import { isTransactionOrigin, type Document } from '@hocuspocus/server'

/** 문서별 서버 메모 — 지연 저장에 쓸 테넌트·페이지와, 마지막 저장 이후 편집한 사용자. */
export interface DocMeta {
  tenantId: number
  pageId: number
  /** 마지막 저장 이후 편집한 사용자 — 최근 변경 순(가장 최근 변경의 작성자가 마지막). API 는 마지막 값을 updated_by 로 쓴다. */
  editors: Set<number>
  /** 로드 이후 문서 변경 순번 — 저장 성공 시 savedSeq 로 따라잡는다. 둘이 다르면 미저장(dirty). */
  seq: number
  savedSeq: number
  /** 연속 저장 실패 횟수(재시도 간격 계산). 성공 시 0. */
  failures: number
  /** 예약된 재시도 타이머. */
  retryTimer?: NodeJS.Timeout
  /** 페이지가 없어졌다(API 404·410) — 더는 저장하지 않고 미저장으로 보지 않는다(언로드 허용). */
  gone?: boolean
}

/**
 * 변경 출처 → 작성자 userId. 연결(사용자 입력)은 연결 컨텍스트, 서버 내부 변경(local)은 출처 컨텍스트의 userId.
 * 그 밖(reconcile·출처 없음)은 작성자 없음.
 */
function authorOf(origin: unknown): number | null {
  if (!isTransactionOrigin(origin)) return null
  const ctx = origin.source === 'connection' ? origin.connection.context : origin.source === 'local' ? origin.context : null
  const id = (ctx as { userId?: unknown } | null)?.userId
  return typeof id === 'number' ? id : null
}

/** 편집자를 맨 뒤로(이미 있으면 옮김) — 집합 순서가 곧 최근 변경 순. */
function touch(editors: Set<number>, id: number): void {
  editors.delete(id)
  editors.add(id)
}

/**
 * 로드된 Hocuspocus 문서 → 메모. Document 객체를 키로 쓰는 WeakMap 이라
 * 언로드 직후 같은 이름으로 다시 로드돼도 옛 문서의 정리가 새 문서의 메모를 지우는 경쟁이 없다.
 * onStoreDocument 의 lastContext 는 마지막 연결 것이라 접속자가 없을 때 의존할 수 없다 — 이 메모가 그 대신이다.
 */
export class DocRegistry {
  private readonly meta = new WeakMap<Document, DocMeta>()

  /** 로드 시 1회 등록. */
  remember(doc: Document, tenantId: number, pageId: number): void {
    const meta: DocMeta = { tenantId, pageId, editors: new Set(), seq: 0, savedSeq: 0, failures: 0 }
    this.meta.set(doc, meta)
    // 모든 출처의 변경을 동기적으로 센다(onChange 훅은 비동기 체인이라 저장 시점과 순서가 보장되지 않음).
    // 작성자도 여기서 기록한다 — 동기라 저장 직전 takeEditors 와의 순서가 정확하고, 최근 변경 순서가 유지된다.
    // 읽기 전용 연결의 변경은 문서에 적용되지 않으므로 여기 오지 않는다.
    doc.on('update', (_update: Uint8Array, origin: unknown) => {
      meta.seq += 1
      const author = authorOf(origin)
      if (author != null) touch(meta.editors, author)
    })
  }

  /** 마지막 저장 이후 변경이 있는가 — 있으면 문서를 메모리에서 내리면 안 된다. */
  isDirty(doc: Document): boolean {
    const m = this.meta.get(doc)
    return m != null && !m.gone && m.seq !== m.savedSeq
  }

  get(doc: Document): DocMeta | undefined {
    return this.meta.get(doc)
  }

  /** 저장 직전에 편집자를 꺼내고 비운다(다음 저장 구간을 새로 센다). 저장 실패 시 restoreEditors 로 되돌린다. */
  takeEditors(doc: Document): number[] {
    const m = this.meta.get(doc)
    if (!m) return []
    const ids = [...m.editors]
    m.editors.clear()
    return ids
  }

  /**
   * 저장 실패 시 꺼냈던 편집자를 되돌린다 — 실패한 저장 뒤에 들어온 변경의 작성자가 더 최근이므로 그들 뒤가 아니라 앞에 둔다.
   * (그대로 add 하면 이미 다시 들어온 사람은 제자리에 남고 되돌린 사람이 뒤로 가 updated_by 가 뒤바뀐다.)
   */
  restoreEditors(doc: Document, ids: number[]): void {
    const m = this.meta.get(doc)
    if (!m) return
    const later = [...m.editors]
    m.editors = new Set([...ids.filter((id) => !m.editors.has(id)), ...later])
  }
}

// 운영 문서 이름 — 같은 페이지가 서로 다른 이름의 두 문서로 열려 서로 덮어쓰는 일이 없도록 정확히 이 형태만 허용.
const PROD_NAME = /^wiki-page:(\d+)$/
// 테스트 모드(E2E) — 병렬 실행 격리용 네임스페이스 접두 `{ns}/wiki-page:{id}` 도 허용(ns 는 Playwright testId 등, 슬래시 없음).
const TEST_NAME = /^(?:[^/]+\/)?wiki-page:(\d+)$/

/** 문서 이름 → pageId. 규약에 맞지 않으면 null(연결 거부). */
export function pageIdOf(docName: string, testMode: boolean): number | null {
  const m = (testMode ? TEST_NAME : PROD_NAME).exec(docName)
  if (!m) return null
  const id = Number(m[1])
  return Number.isSafeInteger(id) && id > 0 ? id : null
}
