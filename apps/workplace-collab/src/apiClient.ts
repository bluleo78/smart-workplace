import type { SnapshotReason } from './server'

/**
 * collab-access 응답(Task 3 계약) — tokenExp 는 epoch 초. 키는 항상 있고 JWT 가 아닌 인증(PAT·API 키)이면 null.
 */
export interface AccessInfo {
  pageId: number
  spaceId: number
  tenantId: number
  userId: number
  name: string
  role: string
  tokenExp: number | null
}

/** 문서 상태 조회 응답 — 상태 미저장 페이지는 state·bodyVersion 키가 아예 없다(API NON_NULL). */
export interface DocPayload {
  state?: string | null
  body: string
  version: number
  bodyVersion?: number | null
}

/**
 * 페이지가 없어졌다(API 404·410) — 일시 장애가 아니라 영구 실패. 재시도하지 않고 문서를 버린다.
 * DocStore 구현은 이 오류로 "없음"을 알린다(테스트 모드 메모리 저장소는 던지지 않음).
 */
export class DocGoneError extends Error {
  constructor(
    readonly pageId: number,
    readonly status: number,
  ) {
    super(`page ${pageId} gone (${status})`)
  }
}

/**
 * 사용자 토큰이 거절됐다(collab-access 401) — 만료·폐기된 JWT. 권한 없음(404)과 다르다:
 * 웹은 토큰을 갱신해 다시 붙어야 하므로 연결은 4401·'token-expired' 로 끝낸다(4403 은 웹이 종단으로 보고 미전송 입력을 버림).
 */
export class TokenRejectedError extends Error {
  constructor() {
    super('user token rejected (401)')
  }
}

/** 404·410 → DocGoneError, 그 밖의 실패 → 일반 오류(일시 장애로 보고 재시도). */
function failDoc(op: string, pageId: number, status: number): Error {
  return status === 404 || status === 410 ? new DocGoneError(pageId, status) : new Error(`${op} failed ${status}`)
}

/**
 * API 호출 — 사용자 판정은 사용자 토큰(Bearer), 문서 저장소는 내부 토큰 + X-Tenant-Id.
 * 테넌트 헤더를 싣는 이유: 접속자가 모두 나간 뒤의 지연 저장에도 사용자 토큰 없이 RLS 를 통과해야 한다.
 */
export class ApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly internalToken: string,
  ) {}

  /** 페이지 접근 판정 — 확정된 권한 없음(403·404: 비멤버·없는 페이지)은 null, 토큰 거절(401)은 TokenRejectedError, 그 밖은 예외. */
  async access(pageId: number, userToken: string): Promise<AccessInfo | null> {
    const res = await fetch(`${this.baseUrl}/api/v1/wiki/pages/${pageId}/collab-access`, {
      headers: { Authorization: `Bearer ${userToken}` },
    })
    if (res.status === 401) throw new TokenRejectedError()
    if (res.status === 403 || res.status === 404) return null
    if (!res.ok) throw new Error(`collab-access failed ${res.status}`)
    return (await res.json()) as AccessInfo
  }

  /** 문서 상태·본문 조회. */
  async loadDoc(tenantId: number, pageId: number): Promise<DocPayload> {
    const res = await fetch(`${this.baseUrl}/internal/wiki/pages/${pageId}/doc`, {
      headers: this.internalHeaders(tenantId),
    })
    if (!res.ok) throw failDoc('loadDoc', pageId, res.status)
    return (await res.json()) as DocPayload
  }

  /**
   * 문서 상태 + 파생 body 저장(버전 검사 없음) → 새 version.
   * snapshot=true 면 API 가 저장 직전 판을 리비전으로 남긴다(AI 적용·버전 복원 직전 — 스펙 §6.1). 그 밖엔 필드를 싣지 않는다.
   * snapshotReason('AI'|'RESTORE')·aiActorId(AI 요청자, ✦ 귀속)는 실렸을 때만 보낸다(WP-297).
   */
  async storeDoc(
    tenantId: number,
    pageId: number,
    doc: {
      state: Uint8Array
      body: string
      editorIds: number[]
      snapshot?: boolean
      snapshotReason?: SnapshotReason
      aiActorId?: number
    },
    opts: { timeoutMs?: number } = {},
  ): Promise<number> {
    const signal = opts.timeoutMs == null ? undefined : AbortSignal.timeout(opts.timeoutMs)
    const res = await this.putDoc('storeDoc', tenantId, pageId, doc, signal)
    return ((await res.json()) as { version: number }).version
  }

  /** 상태만 저장 — body·version 은 그대로, 상태와 bodyVersion(상태를 만든 body 판)만 기록한다(편집 없는 이관·body 앞섬 반영). */
  async storeDocState(tenantId: number, pageId: number, doc: { state: Uint8Array; bodyVersion: number }): Promise<void> {
    await this.putDoc('storeDocState', tenantId, pageId, doc)
  }

  /** 문서 저장 PUT 공통 — 상태는 base64 로 싣고, 나머지 필드는 그대로 JSON 에 넣는다. 실패는 failDoc 으로 매핑. signal 은 시간 상한(중단 시 예외). */
  private async putDoc(
    op: string,
    tenantId: number,
    pageId: number,
    doc: { state: Uint8Array } & Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Response> {
    const res = await fetch(`${this.baseUrl}/internal/wiki/pages/${pageId}/doc`, {
      method: 'PUT',
      signal,
      headers: { ...this.internalHeaders(tenantId), 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...doc, state: Buffer.from(doc.state).toString('base64') }),
    })
    if (!res.ok) throw failDoc(op, pageId, res.status)
    return res
  }

  private internalHeaders(tenantId: number): Record<string, string> {
    return { Authorization: `Internal ${this.internalToken}`, 'X-Tenant-Id': String(tenantId) }
  }
}
