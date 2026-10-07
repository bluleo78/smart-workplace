import type { Connection, Document, Hocuspocus, LocalTransactionOrigin } from '@hocuspocus/server'
import { Server } from '@hocuspocus/server'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import * as Y from 'yjs'

import {
  CLOSE_FORBIDDEN,
  CLOSE_TOKEN_EXPIRED,
  COLLAB_ROLE_CHANGED_TYPE,
  isCollabEditRole,
} from '@smart-workplace/wiki-editor-schema'

import { ApiClient, DocGoneError, TokenRejectedError } from './apiClient'
import type { CollabConfig } from './config'
import { DocRegistry, pageIdOf, type DocMeta } from './docRegistry'
import {
  HttpError,
  makeInternalHandler,
  pathOf,
  send,
  type ApplyRequest,
  type RevalidateRequest,
} from './internalRoutes'
import { markdownToYUpdate, replaceWithMarkdown, yDocToMarkdown } from './markdownCodec'

/** 저장소 호출에 필요한 문서 식별 — tenantId 는 모든 내부 호출의 X-Tenant-Id. */
export interface DocCtx {
  tenantId: number
  pageId: number
  /** Hocuspocus 문서 이름(테스트 모드에선 네임스페이스 접두 포함). */
  docName: string
}

/** 불러온 문서 — state 가 없으면 body 로 이관, stale 이면 state 위에 body 를 덮어 맞춘다. */
export interface LoadedDoc {
  state: Uint8Array | null
  body: string
  /** body 의 version — 이 body 로 만든 상태를 상태만 저장할 때 bodyVersion 으로 넘긴다. */
  version: number
  /** collab 밖에서 body 가 갱신돼(롤백 기간·비상 경로) 저장된 상태보다 body 가 최신. */
  stale: boolean
}

/** 문서 상태 저장소 — 운영은 API, E2E 테스트 모드는 메모리(testMode.ts). */
export interface DocStore {
  load(ctx: DocCtx): Promise<LoadedDoc>
  /** 상태 + 파생 body 저장 후 새 version 을 돌려준다(apply-markdown 이 즉시 저장 결과로 응답). */
  store(ctx: DocCtx, state: Uint8Array, body: string, editorIds: number[]): Promise<number>
  /**
   * 상태만 저장 — 편집 없이 저장된 body(bodyVersion 판)로 만든 상태(최초 이관·body 앞섬 반영).
   * body·version·백링크·첨부는 그대로 두고 상태와 bodyVersion 만 기록한다 — 재직렬화 body 는 원문과 다를 수 있어
   * (원문 HTML·체크리스트 등) 열기만 해도 본문이 손실되거나 version 이 오르면 안 된다.
   */
  storeState(ctx: DocCtx, state: Uint8Array, bodyVersion: number): Promise<void>
}

/** 인증된 접속자. expiresAt 은 epoch ms — null 이면 만료 없음(PAT·API 키 등 JWT 아닌 인증). */
export interface Who {
  userId: number
  name: string
  tenantId: number
  spaceId: number
  role: string
  expiresAt: number | null
}

/**
 * 연결 인증 — 운영은 API collab-access, 테스트 모드는 스텁(testMode.ts).
 * null = 확정된 권한 없음(거부·4403). 토큰 자체가 거절되면 TokenRejectedError 를 던진다(만료 처리·4401).
 */
export interface Authenticator {
  authenticate(docName: string, pageId: number, token: string): Promise<Who | null>
}

/**
 * 연결 컨텍스트(onAuthenticate 반환값) — 이후 훅의 context 로 전달된다.
 * token 은 권한 재검증(revalidate)용으로 메모리에만 보관 — 로그 금지.
 * apply-markdown 의 내부 직접 연결(openDirectConnection)은 tenantId·pageId 만 넣어도 로드된다.
 */
export interface ConnectionContext extends Who {
  pageId: number
  token: string
}
export type CollabContext = Partial<ConnectionContext>

// 웹과의 통신 규약(편집 역할·종료 코드·역할 변경 메시지)은 공용 스키마 패키지의 collabProtocol 에 있다.
// 4403 은 만료(4401)와 같은 소켓 종료 방식 — provider 는 자동 재접속하고, 재접속 판정에서 onAuthenticationFailed({reason:'forbidden'}) 를 받는다.
// 서버가 로드 시 body 로 맞춘 변경의 Yjs 출처 표시.
export const RECONCILE_ORIGIN = { system: 'reconcile' } as const
// setTimeout 최대 지연(약 24.8일) — 넘기면 즉시 실행되므로 나눠서 건다.
const MAX_TIMER_MS = 2 ** 31 - 1

/** API 기반 문서 저장소. */
export function apiDocStore(api: ApiClient): DocStore {
  return {
    async load({ tenantId, pageId }) {
      const p = await api.loadDoc(tenantId, pageId)
      // Buffer 는 Uint8Array 라 그대로 Y.applyUpdate 에 넘긴다(복사 없음).
      const state = p.state ? Buffer.from(p.state, 'base64') : null
      return {
        state,
        body: p.body,
        version: p.version,
        // 상태가 만들어진 body 판(bodyVersion)이 현재 version 보다 낮으면 collab 밖 변경이 있었다.
        stale: state != null && (p.bodyVersion ?? 0) < p.version,
      }
    },
    store({ tenantId, pageId }, state, body, editorIds) {
      return api.storeDoc(tenantId, pageId, { state, body, editorIds })
    },
    storeState({ tenantId, pageId }, state, bodyVersion) {
      return api.storeDocState(tenantId, pageId, { state, bodyVersion })
    },
  }
}

/** API collab-access 기반 인증 — 요청한 문서와 다른 페이지 판정 응답은 거부. */
export function apiAuthenticator(api: ApiClient): Authenticator {
  return {
    async authenticate(_docName, pageId, token) {
      const a = await api.access(pageId, token)
      if (!a || a.pageId !== pageId) return null
      return {
        userId: a.userId,
        name: a.name,
        tenantId: a.tenantId,
        spaceId: a.spaceId,
        role: a.role,
        expiresAt: a.tokenExp == null ? null : a.tokenExp * 1000,
      }
    },
  }
}

/** 거부 사유를 provider 의 onAuthenticationFailed({reason}) 로 그대로 전달한다. */
function deny(reason: string): Error {
  return Object.assign(new Error(reason), { reason })
}

/** 테스트 모드 HTTP 처리기(/__test/*) — 서버 자신을 받아 열린 문서를 읽거나 닫는다. */
export type TestRoutes = (req: IncomingMessage, res: ServerResponse, app: CollabServer) => Promise<boolean>

/** createCollabServer 의존성 주입 — 테스트 모드(app.ts)는 메모리 저장소·인증 스텁·/__test 경로를 넣는다. */
export interface CollabDeps {
  store?: DocStore
  auth?: Authenticator
  /** cfg.testMode 일 때만 연결된다(플래그 없이 넘겨도 404). */
  testRoutes?: TestRoutes
}

/** createCollabServer 가 돌려주는 얇은 래퍼 — hocuspocus(테스트 경로가 열린 문서를 읽음)와 내부 HTTP 동작. */
export interface CollabServer {
  hocuspocus: Hocuspocus<CollabContext>
  listen(): Promise<void>
  readonly address: AddressInfo
  /** API 위임 본문을 문서에 replace 로 적용하고 즉시 저장 — 그 저장의 version 과 저장된 body. */
  applyReplace(req: ApplyRequest): Promise<{ version: number; body: string }>
  /** 대상 연결의 권한 재판정 — 접근 없음은 소켓 4403 종료, 역할 변경은 readOnly 전환. */
  revalidate(req: RevalidateRequest): Promise<void>
  /** 문서의 연결을 모두 닫고(저장 후) 메모리에서 내려갈 때까지 기다린다. 로드돼 있지 않으면 바로 끝. */
  closeDocument(name: string, timeoutMs?: number): Promise<void>
  destroy(): Promise<void>
}

/**
 * 노트 동기화 서버 — 인증(API 판정)·최초 이관·body 앞섬 반영·지연 저장·토큰 만료 종료.
 * 내부 HTTP(apply-markdown·revalidate)는 onRequest 에, 테스트 모드 경로는 deps.testRoutes(플래그 켜졌을 때만)로 붙는다.
 *
 * 문서·연결 추적:
 * - 문서별 tenantId·pageId·편집자 → DocRegistry(Document 키 WeakMap). onLoadDocument 에서 등록.
 * - 연결별 사용자 → Hocuspocus 연결 context(ConnectionContext). document.getConnections() 로 순회 가능.
 * - 연결별 만료 타이머 → expiryTimers(연결 종료·서버 종료 시 해제).
 * - 미저장(dirty) = 변경 순번(seq) ≠ 저장된 순번(savedSeq). 저장 실패 시 지수 백오프로 재시도하고,
 *   미저장 문서는 beforeUnloadDocument 에서 언로드를 막는다. 종료는 shutdownTimeoutMs 로 유한.
 */
export function createCollabServer(cfg: CollabConfig, deps: CollabDeps = {}): CollabServer {
  const api = new ApiClient(cfg.apiUrl, cfg.internalToken)
  const store = deps.store ?? apiDocStore(api)
  const auth = deps.auth ?? apiAuthenticator(api)
  const registry = new DocRegistry()
  const expiryTimers = new Set<NodeJS.Timeout>()
  const unloadWaiters = new Map<string, Array<() => void>>()

  /**
   * 저장소에서 문서를 불러와 Hocuspocus 문서에 적용한다(최초 이관·body 앞섬 반영 포함).
   */
  async function loadInto(document: Document, ctx: DocCtx): Promise<void> {
    const loaded = await store.load(ctx)
    let persistNow = false
    if (loaded.state) {
      Y.applyUpdate(document, loaded.state)
    } else {
      // 처음 열리는 노트 — 마크다운 본문을 공용 스키마로 파싱해 Yjs 초기 상태를 만든다(자동 이관).
      Y.applyUpdate(document, markdownToYUpdate(loaded.body))
      persistNow = true
    }
    if (loaded.stale) {
      // 옛 상태 위에 최신 body 를 최소 변경으로 덮는다 — 옛 상태를 가진 클라이언트도 중복 없이 수렴한다.
      replaceWithMarkdown(document, loaded.body, RECONCILE_ORIGIN)
      persistNow = true
    }
    registry.remember(document, ctx.tenantId, ctx.pageId)
    // 이관·reconcile 결과는 로드 직후 1회 즉시 저장한다(R4) — 편집이 아니므로 상태만(body·version·백링크·첨부 그대로). Hocuspocus 4.7 은 onLoadDocument 중의 변경으로
    // 저장을 예약하지 않는다(onUpdate 리스너가 로드 뒤에 붙음). 저장하지 않으면 편집 없이 내려간 문서가
    // 다음 로드에서 새 clientID 로 재이관되고, 캐시된 Y.Doc 을 가진 클라이언트가 붙을 때 블록이 통째로 중복된다.
    // 실패하면 로드를 실패시킨다(저장 안 된 이관 상태로 편집을 시작하지 않음 — 클라이언트 재시도가 다시 상태만 저장한다).
    // 로드 안에서 끝나므로 동기화 전이라 편집이 끼어들 수 없다 — 이후 첫 편집은 dirty 추적으로 일반 파생 저장을 탄다.
    if (persistNow) await store.storeState(ctx, Y.encodeStateAsUpdate(document), loaded.version)
  }

  const retryBaseMs = cfg.storeRetryBaseMs ?? 1000
  const retryMaxMs = cfg.storeRetryMaxMs ?? 30000
  const shutdownTimeoutMs = cfg.shutdownTimeoutMs ?? 20000
  const retryTimers = new Set<NodeJS.Timeout>()
  let shuttingDown = false

  /** 문서를 지금 저장한다(Hocuspocus 저장 경로 — 저장 뮤텍스·성공 후 언로드 판단을 그대로 탄다). */
  function storeNow(doc: Document): Promise<unknown> {
    return server.hocuspocus.storeDocumentHooks(
      doc,
      {
        instance: server.hocuspocus,
        clientsCount: doc.getConnectionsCount(),
        document: doc,
        documentName: doc.name,
        lastContext: {},
        lastTransactionOrigin: undefined,
      },
      true,
    )
  }

  /**
   * 저장 재시도 예약 — 실패 횟수에 따라 2배씩(상한 retryMaxMs) 늘리며 저장될 때까지 계속한다(편집 유실 방지).
   * 이미 예약돼 있거나 종료 중이면 새로 걸지 않는다. 예약한 지연(ms)을 돌려준다.
   */
  function scheduleRetry(doc: Document): number | null {
    const meta = registry.get(doc)
    if (!meta || shuttingDown) return null
    const delay = Math.min(retryBaseMs * 2 ** Math.max(0, meta.failures - 1), retryMaxMs)
    if (meta.retryTimer) return delay
    const timer = setTimeout(() => {
      retryTimers.delete(timer)
      meta.retryTimer = undefined
      if (doc.isDestroyed || !registry.isDirty(doc)) return
      void storeNow(doc)
    }, delay)
    meta.retryTimer = timer
    retryTimers.add(timer)
    return delay
  }

  /**
   * 페이지가 없어졌다(저장·로드가 404·410) — 영구 실패. 미저장 표시를 지우고 재시도를 멈추고,
   * 남은 연결은 권한 회수와 같은 4403 소켓 종료로 닫아 문서가 내려가게 한다. 한 번만 경고 로그.
   * 일시 장애로 취급하면 문서가 메모리에 남아 30초마다 영원히 재시도하고, 종료 때마다 20초를 기다린 뒤 거짓 UNSAVED 를 남긴다.
   */
  function dropGone(doc: Document, e: DocGoneError): void {
    const meta = registry.get(doc)
    if (!meta || meta.gone) return
    meta.gone = true
    meta.editors.clear()
    meta.failures = 0
    clearRetry(doc)
    console.warn(`[collab] page gone ${doc.name} (API ${e.status}) — dropping unsaved changes and closing connections`)
    for (const conn of doc.getConnections()) conn.webSocket.close(CLOSE_FORBIDDEN.code, CLOSE_FORBIDDEN.reason)
  }

  function clearRetry(doc: Document): void {
    const meta = registry.get(doc)
    if (!meta?.retryTimer) return
    clearTimeout(meta.retryTimer)
    retryTimers.delete(meta.retryTimer)
    meta.retryTimer = undefined
  }

  /**
   * 유한 종료 — 미저장 문서는 마지막으로 한 번 저장을 시도하고 shutdownTimeoutMs 안에 끝낸다.
   * Hocuspocus destroy 는 모든 문서가 내려갈 때까지 기다리므로 API 장애 중엔 영원히 끝나지 않는다(K8S SIGKILL 로 유실).
   * 시간이 다 되면 저장 못 한 문서를 크게 로그로 남기고 반환한다.
   */
  async function shutdown(): Promise<void> {
    shuttingDown = true
    for (const t of expiryTimers) clearTimeout(t)
    expiryTimers.clear()
    for (const t of retryTimers) clearTimeout(t)
    retryTimers.clear()
    for (const doc of server.hocuspocus.documents.values()) {
      const meta = registry.get(doc)
      if (meta) meta.retryTimer = undefined
      // 예약된(디바운스) 저장은 Hocuspocus destroy 가 즉시 실행한다 — 그 밖의 미저장 문서만 여기서 저장을 건다.
      if (registry.isDirty(doc) && !server.hocuspocus.debouncer.isDebounced(`onStoreDocument-${doc.name}`)) void storeNow(doc)
    }
    let timer: NodeJS.Timeout | undefined
    const timedOut = await Promise.race([
      server.destroy().then(() => false),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(true), shutdownTimeoutMs)
      }),
    ])
    clearTimeout(timer)
    if (timedOut) {
      const unsaved = [...server.hocuspocus.documents.values()].filter((d) => registry.isDirty(d)).map((d) => d.name)
      console.error(
        `[collab] shutdown timed out after ${shutdownTimeoutMs}ms — UNSAVED documents (edits will be lost): ${unsaved.join(', ') || '(none)'}`,
      )
    }
  }
  let destroying: Promise<void> | undefined

  /**
   * 상태 + 파생 body 저장과 미저장(dirty) 추적 — 지연 저장(onStoreDocument)과 apply-markdown 이 같은 규칙을 쓴다.
   * - 저장 직전 변경 순번(seq)·편집자를 잡는다. 인코딩이 바로 뒤에 동기로 일어나므로 저장되는 상태와 정확히 대응한다.
   * - 성공: savedSeq 를 따라잡고 실패 횟수·재시도를 지운다 → 새 version.
   * - DocGoneError(페이지 없음): dropGone 후 그대로 던진다(영구 실패 — 재시도 없음).
   * - 그 밖 실패: 편집자를 되돌리고 실패 횟수를 올려 재시도를 예약한 뒤 그대로 던진다(편집 유실 방지).
   * withEditors 로 저장할 편집자 목록을 덧붙일 수 있다(apply-markdown 의 actor). 응답 매핑은 호출자가 한다.
   */
  async function persist(
    doc: Document,
    meta: DocMeta,
    docName: string,
    label: string,
    withEditors: (taken: number[]) => number[] = (taken) => taken,
  ): Promise<{ version: number; body: string }> {
    const seq = meta.seq
    const editors = withEditors(registry.takeEditors(doc))
    const body = yDocToMarkdown(doc)
    let version: number
    try {
      version = await store.store({ tenantId: meta.tenantId, pageId: meta.pageId, docName }, Y.encodeStateAsUpdate(doc), body, editors)
    } catch (e) {
      if (e instanceof DocGoneError) {
        dropGone(doc, e)
        throw e
      }
      registry.restoreEditors(doc, editors)
      meta.failures += 1
      const delay = scheduleRetry(doc)
      console.error(
        `[collab] ${label} failed ${docName} (attempt ${meta.failures})${delay == null ? '' : `, retry in ${delay}ms`}:`,
        (e as Error).message,
      )
      throw e
    }
    meta.savedSeq = Math.max(meta.savedSeq, seq)
    meta.failures = 0
    clearRetry(doc)
    return { version, body }
  }

  /**
   * apply-markdown(replace) — 본문을 문서에 최소 변경으로 적용하고 디바운스 없이 즉시 저장해 그 version 으로 응답한다(스펙 §5.1-4).
   * - 문서가 열려 있으면 그 문서에, 아니면 내부 직접 연결로 로드해 적용한다(접속자에게 즉시 방송).
   * - 적용은 출처가 서버(local)인 한 트랜잭션. skipStoreHooks 로 Hocuspocus 의 지연 저장을 예약하지 않고 여기서 한 번만 저장한다.
   *   출처 컨텍스트의 userId 로 registry 가 actor 를 가장 최근 편집자(editorIds 마지막 = updated_by)로 동기 기록한다.
   * - 저장은 Hocuspocus 저장 뮤텍스 안에서 해 진행 중인 지연 저장과 겹치지 않는다. 저장 후엔 문서가 깨끗해져
   *   내부 연결 해제가 부르는 저장은 onStoreDocument 의 미변경 생략으로 건너뛴다(같은 상태 두 번 저장 없음).
   * - 저장 실패 → 503. 변경은 이미 문서에 들어가 있으므로 재시도 예약으로 결국 저장된다(유실 없음).
   */
  async function applyReplace(req: ApplyRequest): Promise<{ version: number; body: string }> {
    const docName = req.docName ?? `wiki-page:${req.pageId}`
    const { tenantId, pageId, actor } = req
    let conn
    try {
      conn = await server.hocuspocus.openDirectConnection(docName, { tenantId, pageId })
    } catch (e) {
      // 로드에서 페이지가 없음(→ forbidden)은 404, 그 밖은 일시 장애 503.
      if ((e as { reason?: string }).reason === 'forbidden') throw new HttpError(404, 'page not found')
      throw new HttpError(503, `load failed: ${(e as Error).message}`)
    }
    try {
      const doc = conn.document!
      const meta = registry.get(doc)
      // 열린 문서가 다른 테넌트·페이지 것이면 손대지 않는다(요청 테넌트로 다른 테넌트 문서를 덮지 않게).
      if (!meta || meta.tenantId !== tenantId || meta.pageId !== pageId) throw new HttpError(404, 'document not found')
      const origin: LocalTransactionOrigin = {
        source: 'local',
        skipStoreHooks: true,
        context: { userId: actor.userId, actor, ai: req.ai, tenantId, pageId, apply: 'replace' },
      }
      replaceWithMarkdown(doc, req.body, origin)
      return await doc.saveMutex.runExclusive(async () => {
        // API 는 editorIds 의 마지막 값을 updated_by 로 쓴다(스펙 §5.1-4). 적용이 방금의 변경이라 actor 가 마지막이다
        // (그사이 들어온 사람 입력이 있으면 그 사람이 더 최근). 본문이 같아 변경이 없었으면 actor 를 덧붙인다.
        try {
          return await persist(doc, meta, docName, 'apply store', (taken) =>
            taken.includes(actor.userId) ? taken : [...taken, actor.userId],
          )
        } catch (e) {
          throw e instanceof DocGoneError ? new HttpError(404, 'page not found') : new HttpError(503, 'store failed')
        }
      })
    } finally {
      await conn.disconnect()
    }
  }

  /**
   * 권한 재판정 — 대상 연결마다 보관한 사용자 토큰으로 다시 판정한다.
   * - 대상: 같은 테넌트 + (pageIds 있으면 그 페이지들, 없으면 spaceId) + (userId 있으면 그 사용자).
   * - 토큰 거절(401, JWT 만료) → 4401(만료와 같은 경로) — 권한 회수로 오판해 웹이 미전송 입력을 버리지 않게.
   * - 확정된 접근 없음(판정 null = collab-access 404·403) → 소켓을 4403 으로 닫는다. Connection.close() 는 provider 에 코드 1000 만 보내고 재접속도 하지 않아
   *   웹이 회수를 구분할 수 없다(4401 과 같은 이유). 소켓의 다른 문서도 함께 끊기지만 provider 가 재접속해 권한 있는 문서는 다시 붙는다.
   * - 역할 변경 → readOnly 전환 + stateless 로 새 역할 통지(VIEWER 강등 시 이후 수정 메시지는 서버가 버린다).
   * - 판정 자체가 실패(API 장애) → 그 연결은 유지하고 503 으로 알린다(일시 장애로 모두를 끊지 않음 — 다음 재접속·만료 때 다시 판정).
   */
  async function revalidate(req: RevalidateRequest): Promise<void> {
    const targets: Array<{ doc: Document; conn: Connection<CollabContext> }> = []
    const pageIds = req.pageIds ? new Set(req.pageIds) : null
    for (const doc of server.hocuspocus.documents.values()) {
      for (const conn of doc.getConnections() as Array<Connection<CollabContext>>) {
        const c = conn.context
        if (c.tenantId !== req.tenantId || c.pageId == null) continue
        if (pageIds ? !pageIds.has(c.pageId) : c.spaceId !== req.spaceId) continue
        if (req.userId != null && c.userId !== req.userId) continue
        targets.push({ doc, conn })
      }
    }
    // 같은 문서·토큰(한 사용자의 여러 탭·재접속)은 판정을 한 번만 부르고 결과를 나눠 쓴다.
    const verdicts = new Map<string, Promise<Who | null>>()
    const authenticateOnce = (docName: string, pageId: number, token: string): Promise<Who | null> => {
      const key = `${docName}\n${token}`
      let p = verdicts.get(key)
      if (!p) {
        p = auth.authenticate(docName, pageId, token)
        verdicts.set(key, p)
      }
      return p
    }
    let failed = 0
    await Promise.all(
      targets.map(async ({ doc, conn }) => {
        const c = conn.context
        let who: Who | null
        try {
          who = await authenticateOnce(doc.name, c.pageId!, c.token ?? '')
        } catch (e) {
          // 보관한 토큰이 거절됨(JWT 만료) — 권한 회수가 아니므로 만료와 같은 4401 로 닫아 웹이 토큰을 갱신해 다시 붙게 한다.
          // 갱신한 토큰으로 재접속하면 연결 판정이 실제 권한을 다시 확인한다(권한이 없으면 그때 'forbidden').
          if (e instanceof TokenRejectedError) {
            conn.webSocket.close(CLOSE_TOKEN_EXPIRED.code, CLOSE_TOKEN_EXPIRED.reason)
            return
          }
          failed += 1
          console.error(`[collab] revalidate failed ${doc.name} user ${c.userId}:`, (e as Error).message)
          return
        }
        if (!who || who.tenantId !== c.tenantId) {
          conn.webSocket.close(CLOSE_FORBIDDEN.code, CLOSE_FORBIDDEN.reason)
          return
        }
        const readOnly = !isCollabEditRole(who.role)
        c.role = who.role
        if (conn.readOnly !== readOnly) {
          conn.readOnly = readOnly
          conn.sendStateless(JSON.stringify({ type: COLLAB_ROLE_CHANGED_TYPE, role: who.role }))
        }
      }),
    )
    if (failed > 0) throw new HttpError(503, `revalidate failed for ${failed} connection(s)`)
  }

  const internal = makeInternalHandler({ internalToken: cfg.internalToken, testMode: cfg.testMode, applyReplace, revalidate })
  // 테스트 경로는 플래그가 켜졌을 때만 — 주입돼도 운영 설정이면 연결하지 않는다(R2).
  const testRoutes = cfg.testMode ? deps.testRoutes : undefined

  const server = new Server<CollabContext>({
    port: cfg.port,
    quiet: true,
    // 신호 처리는 진입점이 한다 — 여기서 켜면 listen 마다 process 핸들러가 쌓인다(테스트는 여러 번 띄움).
    stopOnSignals: false,
    debounce: cfg.debounceMs,
    maxDebounce: cfg.maxDebounceMs,

    // 인그레스는 /collab 만 라우팅한다 — 다른 경로의 WebSocket 업그레이드는 받지 않는다.
    async onUpgrade({ request, socket }) {
      if (/^\/collab(?:[/?]|$)/.test(request.url ?? '')) return
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n')
      socket.destroy()
      // 빈 reject = 이후 처리 중단(Hocuspocus 규약: 에러 없는 reject 는 조용히 멈춘다).
      return Promise.reject()
    },

    // HTTP — 내부 경로(/internal/*)·테스트 경로(/__test/*, 테스트 모드만), 나머지는 404(Hocuspocus 기본 환영 응답 대신).
    // 응답을 쓴 뒤엔 빈 reject 로 Hocuspocus 기본 응답을 막는다. 오류를 그대로 던지면 Hocuspocus 가 http 콜백 밖으로
    // 다시 던져 unhandled rejection 으로 프로세스가 죽으므로 여기서 모두 응답으로 바꾼다.
    async onRequest({ request, response }) {
      try {
        // K8S liveness/readiness 용 — 인증 없음·테스트 모드와 무관. 프로세스가 HTTP 를 받고 있는지만 알린다.
        if (request.method === 'GET' && pathOf(request) === '/health') {
          send(response, 200, { ok: true })
        } else if (!(await internal(request, response)) && !(testRoutes && (await testRoutes(request, response, self)))) {
          send(response, 404, { error: 'not found' })
        }
      } catch (e) {
        const status = e instanceof HttpError ? e.status : 500
        if (status >= 500) console.error(`[collab] ${request.method} ${request.url} failed:`, (e as Error).message)
        if (!response.headersSent) send(response, status, { error: (e as Error).message })
        else response.end()
      }
      return Promise.reject()
    },

    async onAuthenticate({ token, documentName, connectionConfig }): Promise<ConnectionContext> {
      const pageId = pageIdOf(documentName, cfg.testMode)
      if (pageId == null) throw deny('invalid-document')
      let who: Who | null
      try {
        who = await auth.authenticate(documentName, pageId, token)
      } catch (e) {
        // 토큰 거절(만료 JWT)은 권한 없음이 아니다 — 웹이 토큰을 갱신해 다시 붙도록 만료 사유로 거부한다.
        if (e instanceof TokenRejectedError) throw deny('token-expired')
        throw e
      }
      if (!who) throw deny('forbidden')
      if (who.expiresAt != null && who.expiresAt <= Date.now()) throw deny('token-expired')
      // VIEWER 는 서버가 수정 메시지를 버린다(조작된 클라이언트 대비 — UI 의 editable:false 만 믿지 않음).
      connectionConfig.readOnly = !isCollabEditRole(who.role)
      return { ...who, pageId, token }
    },

    // 토큰 만료 시 소켓을 4401 로 닫아 웹이 토큰을 갱신해 다시 붙게 한다(장시간 연결에서 만료 토큰 사용 방지).
    // 연결 단위가 아니라 소켓을 닫는 이유: Connection.close() 는 provider 에 코드 1000 의 문서 CLOSE 만 보내고
    // 소켓·자동 재접속을 그대로 두어 웹이 만료를 구분할 수 없다. 한 소켓의 문서들은 같은 토큰을 쓴다.
    async connected({ connection, context }) {
      const expiresAt = context.expiresAt
      if (expiresAt == null) return
      let timer: NodeJS.Timeout
      const arm = () => {
        const left = expiresAt - Date.now()
        expiryTimers.delete(timer)
        if (left <= 0) {
          connection.webSocket.close(CLOSE_TOKEN_EXPIRED.code, CLOSE_TOKEN_EXPIRED.reason)
          return
        }
        timer = setTimeout(arm, Math.min(left, MAX_TIMER_MS))
        expiryTimers.add(timer)
      }
      arm()
      connection.onClose(() => {
        clearTimeout(timer)
        expiryTimers.delete(timer)
      })
    },

    async onLoadDocument({ document, documentName, context }) {
      const { tenantId, pageId } = context
      if (typeof tenantId !== 'number' || typeof pageId !== 'number') throw deny('unauthenticated-load')
      try {
        await loadInto(document, { tenantId, pageId, docName: documentName })
      } catch (e) {
        // 페이지가 없어졌다(404·410) — 재시도해도 소용없으므로 권한 거부와 같은 사유로 끝낸다.
        if (e instanceof DocGoneError) {
          console.warn(`[collab] page gone ${documentName} at load (API ${e.status})`)
          throw deny('forbidden')
        }
        // 로드 실패는 provider 에 인증 실패(onAuthenticationFailed)로 전달된다 — 권한 거부와 구분되게 사유를 붙인다(웹은 재시도).
        console.error(`[collab] load failed ${documentName}:`, (e as Error).message)
        throw deny('load-failed')
      }
    },

    async onStoreDocument({ document, documentName }) {
      const meta = registry.get(document)
      // 메모 없이 저장하면 테넌트 없이 호출하게 된다 — 조용히 넘기지 않고 실패시켜 문서를 메모리에 남긴다.
      if (!meta) throw new Error(`no tenant for ${documentName}`)
      // 마지막 저장 이후 변경이 없으면 다시 저장하지 않는다 — apply-markdown 이 직접 저장한 뒤의 내부 연결 해제·
      // 앞서 예약된 지연 저장이 같은 상태를 두 번 저장(version 중복 증가)하지 않게.
      if (!registry.isDirty(document)) {
        clearRetry(document)
        return
      }
      try {
        await persist(document, meta, documentName, 'store')
      } catch (e) {
        // 페이지 삭제 — 영구 실패. 던지지 않고 끝내 Hocuspocus 가 (연결이 없으면) 바로 내리게 한다.
        // 그 밖의 실패는 다시 던진다(Hocuspocus 4.7 은 로그만 남기고 재시도하지 않으므로 persist 가 재시도를 예약해 둠).
        if (!(e instanceof DocGoneError)) throw e
      }
    },

    // 미저장 문서는 내리지 않는다 — 4.7 은 저장 실패 뒤 편집 없는 접속이 끊기면(예약된 저장 없음) 바로 언로드해 편집이 사라진다.
    // 이 훅이 던지면 Hocuspocus 는 언로드를 중단한다. 재시도가 성공하면 Hocuspocus 가 다시 언로드를 시도한다.
    async beforeUnloadDocument({ document, documentName }) {
      if (registry.isDirty(document)) {
        scheduleRetry(document)
        throw new Error(`unsaved changes, keeping ${documentName} in memory`)
      }
      clearRetry(document)
    },

    async afterUnloadDocument({ documentName }) {
      const waiters = unloadWaiters.get(documentName)
      unloadWaiters.delete(documentName)
      waiters?.forEach((resolve) => resolve())
    },
  })

  // WebSocket 업그레이드만 업그레이드로 받는다. Node 는 기본으로 'upgrade' 리스너가 있으면 Upgrade 헤더가 붙은 모든 요청을
  // 업그레이드 경로로 보내는데, JDK HttpClient(HTTP/2 기본)는 평문 요청에 `Upgrade: h2c` 를 붙인다 — 그러면 API 의
  // /internal/* 호출이 onUpgrade 의 404 로 떨어진다. 그 밖의 Upgrade(h2c 등)는 프로토콜을 바꾸지 않고 일반 HTTP 요청으로
  // 처리한다(RFC 9110 §7.8: 서버는 Upgrade 를 무시할 수 있다). shouldUpgradeCallback 은 Node 24.9+ 의 공개 옵션(이미지는 node:24)
  // — @types/node 22 엔 아직 없어 타입을 넓혀 쓴다. 이 옵션이 없는 런타임에선 무시되므로 API 쪽 HTTP/1.1 고정이 1차 방어다.
  ;(server.httpServer as { shouldUpgradeCallback?: (req: IncomingMessage) => boolean }).shouldUpgradeCallback =
    isWebSocketUpgrade

  const hocuspocus = server.hocuspocus

  /** 문서가 메모리에서 내려가면 resolve. */
  function waitUnload(name: string, timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`document ${name} did not unload in ${timeoutMs}ms`)), timeoutMs)
      const list = unloadWaiters.get(name) ?? []
      list.push(() => {
        clearTimeout(t)
        resolve()
      })
      unloadWaiters.set(name, list)
    })
  }

  const self: CollabServer = {
    hocuspocus,
    async listen() {
      await server.listen()
    },
    get address() {
      return server.address
    },
    applyReplace,
    revalidate,
    async closeDocument(name, timeoutMs = 10000) {
      const doc: Document | undefined = hocuspocus.documents.get(name)
      if (!doc) return
      const unloaded = waitUnload(name, timeoutMs)
      const storeId = `onStoreDocument-${name}`
      // 연결이 있으면 닫는다 → 마지막 연결 종료 처리가 예약된 저장을 즉시 실행하고 언로드한다.
      if (doc.getConnectionsCount() > 0) hocuspocus.closeConnections(name)
      else if (hocuspocus.debouncer.isDebounced(storeId)) hocuspocus.debouncer.executeNow(storeId)
      else if (registry.isDirty(doc)) void storeNow(doc) // 저장 실패로 남은 문서 — 저장되면 언로드된다
      else void hocuspocus.unloadDocument(doc)
      await unloaded
    },
    destroy() {
      // 여러 번 불려도(신호 중복·테스트 정리) 같은 종료를 공유한다.
      destroying ??= shutdown()
      return destroying
    },
  }
  return self
}

/** Upgrade 헤더가 websocket(대소문자 무시)인 요청만 진짜 WebSocket 업그레이드로 본다 — h2c 등은 일반 HTTP 로 처리. */
function isWebSocketUpgrade(req: IncomingMessage): boolean {
  return (req.headers.upgrade ?? '').trim().toLowerCase() === 'websocket'
}
