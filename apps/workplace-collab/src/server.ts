import type { Connection, Document, Hocuspocus, LocalTransactionOrigin } from '@hocuspocus/server'
import { Server } from '@hocuspocus/server'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import * as Y from 'yjs'

import {
  CLOSE_DELETED,
  CLOSE_FORBIDDEN,
  CLOSE_TOKEN_EXPIRED,
  COLLAB_AI_APPLY_ACK_TYPE,
  COLLAB_AI_CANCEL_TYPE,
  COLLAB_AI_MARKER_MS,
  COLLAB_ROLE_CHANGED_TYPE,
  COLLAB_SCHEMA_MISMATCH,
  COLLAB_SCHEMA_PARAM,
  type CollabAiMarker,
  isCollabEditRole,
  parseCollabAiMessage,
  REVALIDATE_REASON_DELETED,
  WIKI_SCHEMA_VERSION,
} from '@smart-workplace/wiki-editor-schema'

import { AiMarkerBoard } from './aiMarkers'
import { AiTagBoard } from './aiTagBoard'
import { ApiClient, DocGoneError, TokenRejectedError } from './apiClient'
import type { CollabConfig } from './config'
import { DocRegistry, pageIdOf, type DocMeta } from './docRegistry'
import {
  HttpError,
  makeInternalHandler,
  pathOf,
  send,
  type ApplyRequest,
  type ApplyResult,
  type RevalidateRequest,
} from './internalRoutes'
import { applyKeepLivePlan, hasVisibleContent, markdownToYUpdate, replaceWithMarkdown, yDocToMarkdown } from './markdownCodec'
import { EMPTY_BODY_REJECTION } from './mergeConstants'
import {
  createMergeRunner,
  MergeFailedError,
  MergeTimeoutError,
  type LiveMergeResult,
  type MergeRunner,
} from './mergeRunner'

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

/** API 저장 PUT 의 snapshotReason — AI 적용 직전 / 버전 복원 직전(WP-297). 시간 규칙 스냅샷은 API 가 스스로 판단한다. */
export type SnapshotReason = 'AI' | 'RESTORE'

/**
 * 파생 저장 옵션 — snapshotReason: 있으면 저장 직전 판을 그 사유(AI 적용 / 버전 복원, WP-297)의 리비전으로 남긴다(스펙 §6.1 —
 * API 저장 요청엔 snapshot:true 와 함께 싣는다). aiActorId: AI 적용을 요청한 사람(✦ 귀속) — AI 적용일 때만.
 * timeoutMs: 저장 호출 시간 상한(넘으면 실패로 끝나 재시도가 예약된다) — apply-markdown 의 적용 저장이 API read 타임아웃 안에 답하게.
 */
export interface StoreOptions {
  snapshotReason?: SnapshotReason
  aiActorId?: number
  timeoutMs?: number
}

/** 문서 상태 저장소 — 운영은 API, E2E 테스트 모드는 메모리(testMode.ts). */
export interface DocStore {
  load(ctx: DocCtx): Promise<LoadedDoc>
  /** 상태 + 파생 body 저장 후 새 version 을 돌려준다(apply-markdown 이 즉시 저장 결과로 응답). */
  store(ctx: DocCtx, state: Uint8Array, body: string, editorIds: number[], opts?: StoreOptions): Promise<number>
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
 * null = 확정된 권한 없음(거부·4403, 삭제 재검증이면 4404). 토큰 자체가 거절되면 TokenRejectedError 를 던진다(만료 처리·4401).
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
// 4403(권한 회수)·4404(삭제)는 만료(4401)와 같은 소켓 종료 방식 — provider 는 자동 재접속하고, 재접속 판정에서 onAuthenticationFailed({reason:'forbidden'}) 를 받는다.
// 서버가 로드 시 body 로 맞춘 변경의 Yjs 출처 표시.
export const RECONCILE_ORIGIN = { system: 'reconcile' } as const
/**
 * apply-markdown 한 요청의 전체 기한(ms) — 문서 로드·저장 잠금 대기·적용 직전 저장 왕복·워커 계산(정규화·병합)까지, 적용(실시간 문서 변경)
 * 직전까지를 모두 덮는다. API 의 동기화 서버 read 타임아웃 30s(CollabClientConfig)보다 넉넉히 짧게 — 적용 뒤의 즉시 저장 한 번이
 * 남은 시간 안에 끝나도록. 기한이 적용 전에 지나면 503 이고 아무것도 적용하지 않는다(API 가 503 을 받았는데 변경은 적용된 일이 없게).
 */
export const APPLY_DEADLINE_MS = 20_000
/**
 * 적용 뒤 즉시 저장의 최소 대기(ms) — 저장 시간 상한은 요청 기한의 남은 시간이되 이보다 짧게 끊지 않는다(적용 직후 기한이 거의 다 됐어도
 * 정상 저장 한 번은 기다린다). 기한 20s + 3s 도 API read 30s 안이다. 넘기면 적용은 된 채 persisted:false 로 답하고 재시도가 저장한다.
 */
export const APPLY_STORE_MIN_MS = 3_000
/**
 * 에디터 안 AI 적용 태그의 수명(ms, WP-323) — 웹은 ack 를 받고 곧바로 삽입하므로 넉넉하다. 이 안에 삽입(저장)이 없으면 태그는 버려진다
 * (취소가 유실돼도 다음 사람 저장에 거짓 ✦ 가 붙지 않게).
 */
export const AI_TAG_TTL_MS = 5_000
// setTimeout 최대 지연(약 24.8일) — 넘기면 즉시 실행되므로 나눠서 건다.
const MAX_TIMER_MS = 2 ** 31 - 1
/**
 * 스키마 판 불일치 로그 간격(ms) — 인증 전 거부라 누구나(미인증 클라이언트) 유발할 수 있어, 한 간격에 한 줄만 남기고
 * 나머지는 다음 줄에 건수로 합친다(로그 범람 방지). 배포 직후 옛 탭이 몰려도 간격당 한 줄.
 */
export const SCHEMA_MISMATCH_LOG_MS = 10_000
/** 로그에 싣는 클라이언트 값 상한(글자) — 위조된 긴 값·개행으로 로그 줄을 꾸미지 못하게 JSON 으로 감싸고 자른다. */
const LOG_VALUE_MAX = 32

/** 클라이언트가 보낸 값을 로그용으로 — JSON 문자열(개행·따옴표 이스케이프)로 바꾸고 LOG_VALUE_MAX 에서 자른다. */
function clipForLog(value: unknown): string {
  const json = JSON.stringify(value) ?? 'undefined'
  return json.length > LOG_VALUE_MAX ? `${json.slice(0, LOG_VALUE_MAX)}…` : json
}

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
    store({ tenantId, pageId }, state, body, editorIds, opts) {
      return api.storeDoc(
        tenantId,
        pageId,
        {
          state,
          body,
          editorIds,
          // 스냅샷·사유·AI 귀속은 실렸을 때만 보낸다(없으면 키 생략 — 사유 없는 snapshot 은 API 가 AI 로 본다, R7).
          ...(opts?.snapshotReason ? { snapshot: true, snapshotReason: opts.snapshotReason } : {}),
          ...(opts?.aiActorId != null ? { aiActorId: opts.aiActorId } : {}),
        },
        { timeoutMs: opts?.timeoutMs },
      )
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
  /** 병합 실행기(워커 스레드) — 테스트가 시간 제한·인위 지연을 바꿔 넣는다. 기본은 MERGE_TIMEOUT_MS 의 실행기. */
  merger?: MergeRunner
  /** AI 적용 위치 ✦ 표식판 — 테스트가 넣어 남은 타이머·문서를 들여다본다. 기본은 cfg.aiMarkerMs 의 표식판. */
  markers?: AiMarkerBoard
  /**
   * 문서별로 받아들일 스키마 판(WP-313) — 기본은 이 서버가 빌드된 WIKI_SCHEMA_VERSION. cfg.testMode 일 때만 쓴다.
   * 테스트 모드가 문서별로 바꿔 '동기화 서버만 새 스키마로 배포됨'을 E2E 에서 실제 거부 경로로 재현한다.
   */
  schemaVersion?: (docName: string) => number
}

/** createCollabServer 가 돌려주는 얇은 래퍼 — hocuspocus(테스트 경로가 열린 문서를 읽음)와 내부 HTTP 동작. */
export interface CollabServer {
  hocuspocus: Hocuspocus<CollabContext>
  listen(): Promise<void>
  readonly address: AddressInfo
  /** API 위임 본문을 문서에 적용(replace 또는 3-way merge)하고 즉시 저장 — 그 저장의 version 과 저장된 body. */
  applyMarkdown(req: ApplyRequest): Promise<ApplyResult>
  /** 대상 연결의 권한 재판정 — 접근 없음은 소켓 4403 종료(삭제 사유면 4404), 역할 변경은 readOnly 전환. */
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
  // 워커 스레드는 첫 병합 때 뜬다(replace 만 쓰거나 병합이 없으면 띄우지 않음).
  const merger = deps.merger ?? createMergeRunner()
  // AI 적용 위치 ✦ 표식(서버 awareness) — 스펙 §5.1-5. 문서가 내려가면 그 문서의 표식·타이머도 함께 정리된다.
  const markers = deps.markers ?? new AiMarkerBoard(cfg.aiMarkerMs ?? COLLAB_AI_MARKER_MS)

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
    // 상태만 저장(이관·reconcile)은 version 을 바꾸지 않는다 — 로드한 판이 곧 지금 version.
    registry.remember(document, ctx.tenantId, ctx.pageId, loaded.version)
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
  // 에디터 안 AI 적용 태그(WP-323) — 수명·한계는 aiTagBoard.ts 머리말.
  const aiTags = new AiTagBoard(cfg.aiTagTtlMs ?? AI_TAG_TTL_MS)

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
   * 남은 연결은 삭제(4404) 소켓 종료로 닫아 문서가 내려가게 한다 — 내부 저장·로드는 사용자 권한과 무관하므로 404 는 페이지가 없어졌다는 뜻이다. 한 번만 경고 로그.
   * 일시 장애로 취급하면 문서가 메모리에 남아 30초마다 영원히 재시도하고, 종료 때마다 20초를 기다린 뒤 거짓 UNSAVED 를 남긴다.
   */
  function dropGone(doc: Document, e: DocGoneError): void {
    const meta = registry.get(doc)
    if (!meta || meta.gone) return
    meta.gone = true
    meta.editors.clear()
    aiTags.dispose(doc)
    meta.failures = 0
    clearRetry(doc)
    console.warn(`[collab] page gone ${doc.name} (API ${e.status}) — dropping unsaved changes and closing connections`)
    for (const conn of doc.getConnections()) conn.webSocket.close(CLOSE_DELETED.code, CLOSE_DELETED.reason)
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
    markers.destroy()
    for (const t of expiryTimers) clearTimeout(t)
    expiryTimers.clear()
    for (const t of retryTimers) clearTimeout(t)
    retryTimers.clear()
    // AI 태그는 만료 타이머만 지우고 남겨 아래 마지막 저장이 싣게 한다.
    aiTags.shutdown()
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
    // 진행 중 병합이 끝날 기회를 준 뒤(문서 언로드 대기 동안) 워커 스레드를 내린다.
    await merger.destroy()
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
   * - AI 태그(WP-323): 사유가 정해지지 않은 저장은 인코딩과 같은 동기 구간(호출자가 잡은 저장 뮤텍스 안)에서 태그를 꺼내 'AI' 사유 +
   *   요청자로 저장한다 — "태그가 달린 뒤 처음 상태를 인코딩하는 저장"이 소비한다(큐에 넣는 시점이 아니라). 지연 저장·ai-apply 의 flush·
   *   apply-markdown 의 적용 직전 저장(flushBeforeApply, 사유 없음) 모두 같다 — 그 판의 직전 저장 판이 곧 AI 직전 판이다.
   *   이미 사유가 정해진 저장(apply-markdown 의 적용 저장 — AI·RESTORE)은 그 사유가 우선이고 태그를 소비하지 않는다: 서버 적용은
   *   자기 직전 판을 스스로 남기므로, 태그는 그 뒤 들어올 에디터 AI 삽입의 저장이 소비하게 남겨 둔다.
   *   실패(페이지 삭제 제외)하면 되돌린다(AiTagBoard.restore) — 재시도 저장이 다시 싣는다. 감수한 한계는 aiTagBoard.ts 머리말.
   */
  async function persist(
    doc: Document,
    meta: DocMeta,
    docName: string,
    label: string,
    withEditors: (taken: number[]) => number[] = (taken) => taken,
    opts: StoreOptions = {},
  ): Promise<{ version: number; body: string }> {
    const seq = meta.seq
    const editors = withEditors(registry.takeEditors(doc))
    const body = yDocToMarkdown(doc)
    // 태그 소비 — 아래 인코딩과 같은 동기 구간(await 전)이라 꺼낸 태그와 저장되는 상태가 정확히 대응한다.
    const tag = opts.snapshotReason == null ? aiTags.take(doc) : undefined
    const storeOpts: StoreOptions = tag ? { ...opts, snapshotReason: 'AI', aiActorId: tag.actorId } : opts
    let version: number
    try {
      version = await store.store(
        { tenantId: meta.tenantId, pageId: meta.pageId, docName },
        Y.encodeStateAsUpdate(doc),
        body,
        editors,
        storeOpts,
      )
    } catch (e) {
      if (e instanceof DocGoneError) {
        dropGone(doc, e)
        throw e
      }
      // 소비한 태그를 되돌린다(더 새 태그가 없을 때만, 만료는 새로) — 백오프 뒤 재시도가 같은 판을 다시 실을 때도 AI 사유가 남게.
      if (tag) aiTags.restore(doc, tag)
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
    // 늦게 끝난 옛 저장이 더 새 body 를 덮지 않게 순번이 앞서거나 같을 때만 기록한다.
    if (!meta.persistedBody || seq >= meta.persistedBody.seq) meta.persistedBody = { seq, body }
    meta.version = version
    meta.failures = 0
    clearRetry(doc)
    return { version, body }
  }

  /** AI 적용 직전 미저장분 저장 시도 상한 — 쉬지 않고 입력이 들어와도 적용이 끝없이 밀리지 않게. */
  const PRE_APPLY_FLUSH_TRIES = 3
  /** 병합 도중 문서가 또 바뀌어 다시 병합하는 횟수 상한 — 요청 기한 안에서만 돈다. */
  const MAX_MERGE_ROUNDS = 5

  const applyDeadlineMs = cfg.applyDeadlineMs ?? APPLY_DEADLINE_MS

  /**
   * apply-markdown — 본문을 문서에 최소 변경으로 적용하고 디바운스 없이 즉시 저장해 그 version 으로 응답한다(스펙 §5.1).
   * - merge: 잠금 안에서 AI본·기준본을 정규화하고(현재본과 같은 표기로) 현재본과 3-way 병합한다. 정규화·병합 계산은 모두 워커
   *   스레드에서 돈다(merger) — 큰 노트에선 각각 수백 ms~수 초라, 그동안 이벤트 루프는 다른 접속자의 실시간 동기화를 계속 처리한다.
   * - 기한(APPLY_DEADLINE_MS): 요청 하나의 로드·잠금 대기·적용 직전 저장·워커 계산이 모두 그 안에 끝나야 한다. 적용 전에 지나면 그 자리에서
   *   503 으로 답하고, 늦게 잠금을 얻은 작업은 아무것도 적용하지 않고 끝난다. 적용(실시간 문서 변경)을 시작했으면 기한과 무관하게 저장까지 마친다.
   *   워커 계산 한 번은 추가로 merger.timeoutMs 를 넘지 못한다.
   * - 빈 AI본(공백뿐 포함)·파싱 실패는 병합하지 않는다 — "AI 가 거의 모두 지움"이 되므로 400(code: empty_body·unparseable_body).
   *   기준본·현재본도 비었을 때만 허용.
   * - AI 적용(ai=true)·버전 복원(replace + snapshot, WP-297)은 ① 미저장 사람 입력을 먼저 저장해 둔다 — API 가 ①의 판(= 적용 직전 판)을
   *   리비전으로 남겨, 정책상 AI 쪽으로 덮인 사람 수정도, 복원으로 덮인 최근 입력도 되돌릴 수 있다.
   * - 스냅샷 사유는 요청에서 명시적으로 정한다(snapshotReasonOf): snapshot + ai → 'AI'(+ 요청자 aiActorId),
   *   snapshot + 사람 + replace → 'RESTORE'. 그 밖(사람 merge + snapshot)은 사유가 없어 스냅샷을 아예 싣지 않는다 — 사유 없는
   *   snapshot 은 API 가 AI 로 기록하므로(R7) 잘못된 ✦ 행이 생긴다. API 는 사람 merge 에 snapshot 을 싣지 않으니(R8) 구버전 웹 사람
   *   적용과 같게 ①도 하지 않는다(그 판은 API 의 시간 규칙이 맡는다).
   * - 잠금은 Hocuspocus 저장 뮤텍스 — ①~③(워커 왕복 포함)이 진행 중 지연 저장·같은 문서의 다른 apply 와 직렬이다.
   *   그래서 두 병합이 같은 낡은 현재본으로 계산되는 일이 없다.
   * - 적용은 출처가 서버(local)인 한 트랜잭션. skipStoreHooks 로 지연 저장을 예약하지 않고 여기서 한 번만 저장한다.
   * - ✦ 표식은 적용 저장이 성공한 뒤에만 보인다(저장 실패 503 인데 표식만 보이는 일이 없게).
   * - 병합 시간 초과·기한 초과 → 503, 아무것도 적용하지 않는다(부분 결과 없음). 사전 저장 실패면 적용 전이라 문서는 바뀌지 않는다(503).
   * - 적용 뒤 즉시 저장은 남은 기한(최소 APPLY_STORE_MIN_MS)으로 끊는다. 시간 초과·실패면 503 이 아니라 200 persisted:false —
   *   변경은 실시간 문서에 들어갔고 재시도가 저장한다(API 가 503 을 보고 같은 변경을 다시 보내지 않게). ✦ 표식은 올리지 않는다.
   */
  async function applyMarkdown(req: ApplyRequest): Promise<ApplyResult> {
    const deadline = Date.now() + applyDeadlineMs
    // committed: 실시간 문서를 바꾸기 시작했다(이후엔 끝까지 간다). abandoned: 기한이 먼저 와 이미 503 으로 답했다(적용 금지).
    // 둘 다 같은 이벤트 루프에서만 바뀌므로 "기한 확인 → committed" 사이에 타이머가 끼어들 수 없다.
    const state = { committed: false, abandoned: false }
    let timer: NodeJS.Timeout | undefined
    const expired = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        if (state.committed) return
        state.abandoned = true
        reject(new HttpError(503, `apply deadline exceeded (${applyDeadlineMs}ms)`))
      }, applyDeadlineMs)
    })
    const work = applyWithin(req, deadline, state)
    // 기한으로 먼저 답한 뒤 늦게 끝나는 작업의 실패가 처리되지 않은 거부로 남지 않게.
    work.catch(() => {})
    try {
      return await Promise.race([work, expired])
    } finally {
      clearTimeout(timer)
    }
  }

  /** applyMarkdown 의 본체 — state 로 기한(abandoned)과 적용 시작(committed)을 호출자와 주고받는다. */
  async function applyWithin(
    req: ApplyRequest,
    deadline: number,
    state: { committed: boolean; abandoned: boolean },
  ): Promise<ApplyResult> {
    const docName = req.docName ?? `wiki-page:${req.pageId}`
    const { tenantId, pageId, actor } = req
    /** 적용 전 단계마다 — 기한이 지났으면 아무것도 적용하지 않고 끝낸다. */
    const checkDeadline = () => {
      if (state.abandoned || Date.now() >= deadline) throw new HttpError(503, 'apply deadline exceeded')
    }
    let conn
    try {
      conn = await server.hocuspocus.openDirectConnection(docName, { tenantId, pageId })
    } catch (e) {
      // 로드에서 페이지가 없음(→ forbidden)은 404, 그 밖은 일시 장애 503.
      if ((e as { reason?: string }).reason === 'forbidden') throw new HttpError(404, 'page not found')
      throw new HttpError(503, `load failed: ${(e as Error).message}`)
    }
    // 적용 저장이 끝나지 못했다 — 연결 해제가 기다리는 재시도 저장을 응답이 기다리지 않게 한다.
    let unpersisted = false
    try {
      const doc = conn.document!
      const meta = registry.get(doc)
      // 열린 문서가 다른 테넌트·페이지 것이면 손대지 않는다(요청 테넌트로 다른 테넌트 문서를 덮지 않게).
      if (!meta || meta.tenantId !== tenantId || meta.pageId !== pageId) throw new HttpError(404, 'document not found')
      const origin: LocalTransactionOrigin = {
        source: 'local',
        skipStoreHooks: true,
        context: { userId: actor.userId, actor, ai: req.ai, tenantId, pageId, apply: req.mode },
      }
      // ① 스냅샷을 남길 적용(AI·버전 복원)의 직전 판을 저장해 둔다(리비전 대상) — 미저장 사람 입력이 있으면(상한까지) 저장.
      //    사유 없는 사람 적용(구버전 웹·사람 merge)은 하지 않는다 — 그 판은 API 의 시간 규칙이 맡는다.
      const snapshotReason = snapshotReasonOf(req)
      const preStore = req.ai || snapshotReason != null
      const flushBeforeApply = async () => {
        for (let i = 0; preStore && i < PRE_APPLY_FLUSH_TRIES && registry.isDirty(doc); i++) {
          checkDeadline()
          await persist(doc, meta, docName, 'pre-apply store')
        }
      }
      return await doc.saveMutex.runExclusive(async () => {
        try {
          // 잠금을 기다리는 동안 기한이 지났다 — 이미 503 으로 답했으니 손대지 않고 잠금을 넘긴다.
          checkDeadline()
          /** ② 적용 시작(동기) — 기한을 마지막으로 확인하고, 여기서부터는 기한과 무관하게 저장까지 마친다. */
          // ✦ 표식 위치 — 적용과 같은 동기 구간에서 바뀐 블록 인덱스를 상대 위치로 굳힌다(저장 왕복 동안 위쪽 편집으로 어긋나지 않게).
          let anchor: CollabAiMarker['anchor'] | null = null
          const commit = (apply: () => number | null): number | null => {
            checkDeadline()
            state.committed = true
            const c = apply()
            if (req.ai && c != null) anchor = markers.anchorAt(doc, c)
            return c
          }
          let changed: number | null
          if (req.mode === 'merge') {
            // 워커 계산 기한 — 요청 기한과 워커 한 번의 상한 중 이른 쪽.
            const workerDeadline = Math.min(deadline, Date.now() + merger.timeoutMs)
            // ⓪ 정규화 + 빈 본문·파싱 실패 거부(아무것도 저장·적용하기 전에).
            const bases = [req.baseBody ?? '', ...(req.altBaseBody == null ? [] : [req.altBaseBody])]
            const p = await merger.prepare({ body: req.body, bases }, workerDeadline - Date.now())
            if ('rejected' in p) throw new HttpError(400, p.rejected, p.code)
            // 빈 AI본이 워커를 통과했으면 기준본도 모두 비었다 — 현재본에 보이는 내용이 있으면 같은 이유·코드로 거부한다(WP-330).
            // 현재본을 워커로 보내지 않는 이유: 이 판정에 현재본이 필요한 건 AI본·기준본이 모두 빈 드문 경우뿐인데, 보내려면 매 요청
            // 메인 스레드에서 문서 전체를 직렬화해야 했다. 여기서도 직렬화 대신 Y 문서 구조로 본다(hasVisibleContent). 사전 저장(①)보다 먼저다.
            if (p.ai.trim() === '' && hasVisibleContent(doc)) throw new HttpError(400, EMPTY_BODY_REJECTION, 'empty_body')
            // ①+② 병합 회차마다 먼저 적용 직전 판을 저장하고 실시간 상태를 워커로 보낸다 → 그 상태가 그대로일 때만 계획을 적용한다.
            changed = await mergeAgainstLive(doc, meta, p.bases, p.ai, workerDeadline, flushBeforeApply, (r) =>
              commit(() => applyKeepLivePlan(doc, r.plan, origin)),
            )
          } else {
            await flushBeforeApply()
            changed = commit(() => replaceWithMarkdown(doc, req.body, origin))
          }
          // 바뀐 것 없는 AI 적용·복원(이미 그 본문) — 새 판·스냅샷을 만들지 않고 지금 판으로 답한다(미저장분은 위에서 이미 저장했다).
          if (changed == null && preStore && !registry.isDirty(doc) && meta.version != null) {
            // 마지막 저장 뒤로 문서가 안 바뀌었으면(순번 그대로) 그때 직렬화한 body 가 곧 지금 문서다 — 다시 직렬화하지 않는다.
            const cached = meta.persistedBody
            return { version: meta.version, body: cached?.seq === meta.seq ? cached.body : yDocToMarkdown(doc), persisted: true }
          }
          // ③ 즉시 저장. API 는 editorIds 의 마지막 값을 updated_by 로 쓴다 — 변경이 없었어도 actor 를 덧붙인다.
          //    적용은 이미 됐다 — 저장이 남은 기한(최소 APPLY_STORE_MIN_MS) 안에 끝나지 않거나 실패해도 503 이 아니라 persisted:false 로
          //    답한다(503 이면 호출자가 적용된 변경을 다시 보낸다). persist 가 재시도를 예약해 결국 저장한다. 페이지 삭제(404)만 예외.
          let saved: { version: number; body: string }
          try {
            saved = await persist(
              doc,
              meta,
              docName,
              'apply store',
              (taken) => (taken.includes(actor.userId) ? taken : [...taken, actor.userId]),
              {
                // 사유가 정해진 적용만 스냅샷을 싣는다(사유 없는 snapshot 은 API 가 AI 로 오인한다, R7).
                snapshotReason,
                aiActorId: snapshotReason === 'AI' ? actor.userId : undefined,
                timeoutMs: Math.max(APPLY_STORE_MIN_MS, deadline - Date.now()),
              },
            )
          } catch (e) {
            if (e instanceof DocGoneError) throw e
            console.warn(`[collab] apply store did not finish for ${docName} — applied, answering persisted:false (retry scheduled)`)
            unpersisted = true
            return { version: meta.version ?? 0, body: yDocToMarkdown(doc), persisted: false }
          }
          // AI 적용이 실제로 바꾼 자리에 "✦ 요청한 사람" 표식 — 저장이 성공한 뒤에만(구버전 웹 = 사람 저장은 표식 없음, 스펙 Q3·§5.1-5).
          // 위치는 commit 에서 잡아 둔 상대 위치 — 저장을 기다리는 동안 들어온 편집을 따라간다.
          if (anchor) markers.showAt(doc, actor, anchor)
          return { ...saved, persisted: true }
        } catch (e) {
          if (e instanceof HttpError) throw e
          if (e instanceof MergeTimeoutError) throw new HttpError(503, `merge timed out: ${e.message}`)
          if (e instanceof MergeFailedError) throw new HttpError(500, `merge failed: ${e.message}`)
          throw e instanceof DocGoneError ? new HttpError(404, 'page not found') : new HttpError(503, 'store failed')
        }
      })
    } finally {
      const closing = conn.disconnect()
      if (unpersisted) closing.catch(() => {})
      else await closing
    }
  }

  /**
   * 실시간 상태를 워커로 보내 병합·keepLive 계획을 받고, 그사이 문서가 바뀌지 않았을 때만 그 자리에서(동기로) commit 해 적용한다.
   * 회차마다 먼저 flush(적용 직전 판 저장)를 한 뒤 seq·상태를 뜬다 — 그래서 받아들인 회차의 현재본은 모두 저장돼 있고
   * (저장 시도 상한 안에서), 정책상 AI 쪽으로 덮인 사람 입력도 snapshot 저장 바로 앞 판에서 되돌릴 수 있다(스펙 §5.1-3-2·§6.1).
   * 워커를 기다리는 동안 이벤트 루프가 풀려 사람 입력이 문서에 들어올 수 있다 — 낡은 상태로 만든 결과·계획(실시간 블록 인덱스)을 적용하면
   * 그 입력이 지워지거나 엉뚱한 블록을 가리킨다. 변경 순번(seq)이 달라졌으면 바뀐 상태로 처음부터 다시 병합한다(같은 기준본·AI본).
   * seq 확인과 commit 사이에 await 가 없어 확인한 문서가 곧 적용하는 문서다.
   * 기한(deadline) 안에 끝나지 않거나 MAX_MERGE_ROUNDS 를 넘기면 MergeTimeoutError — 호출자는 아무것도 적용하지 않는다.
   * 정책상 AI 쪽으로 정한 블록 수는 로그로 남긴다(운영에서 사람 수정이 덮인 빈도를 본다 — 본문은 남기지 않는다).
   */
  async function mergeAgainstLive(
    doc: Document,
    meta: DocMeta,
    bases: string[],
    target: string,
    deadline: number,
    flush: () => Promise<void>,
    commit: (r: LiveMergeResult) => number | null,
  ): Promise<number | null> {
    for (let round = 0; round < MAX_MERGE_ROUNDS; round++) {
      await flush()
      const left = deadline - Date.now()
      if (left <= 0) break
      const seq = meta.seq
      const r = await merger.merge({ bases, live: Y.encodeStateAsUpdate(doc), ai: target }, left)
      if (meta.seq === seq) {
        if (r.conflicts > 0) console.info(`[collab] merge ${doc.name}: ${r.conflicts} block(s) resolved to the AI side`)
        return commit(r)
      }
    }
    throw new MergeTimeoutError(`document kept changing during merge (${doc.name})`)
  }

  /**
   * 권한 재판정 — 대상 연결마다 보관한 사용자 토큰으로 다시 판정한다.
   * - 대상: 같은 테넌트 + (pageIds 있으면 그 페이지들, 없으면 spaceId) + (userId 있으면 그 사용자).
   * - 토큰 거절(401, JWT 만료) → 4401(만료와 같은 경로) — 권한 회수로 오판해 웹이 미전송 입력을 버리지 않게.
   * - 확정된 접근 없음(판정 null = collab-access 404·403) → 소켓을 4403 으로 닫는다(요청 사유가 deleted 면 4404 — 웹이 삭제 안내를 보인다). Connection.close() 는 provider 에 코드 1000 만 보내고 재접속도 하지 않아
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
          // 삭제 재검증이면 "삭제되었습니다"로 알리고(4404), 그 밖(멤버 제거 등)은 권한 회수(4403).
          const close = req.reason === REVALIDATE_REASON_DELETED ? CLOSE_DELETED : CLOSE_FORBIDDEN
          conn.webSocket.close(close.code, close.reason)
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

  /**
   * 에디터 안 AI 적용(WP-323) stateless 처리 — ai-apply·ai-cancel 외의 메시지는 무시한다.
   * ai-apply: 편집 권한 연결만(VIEWER·강등된 연결은 flush·태그·ack 모두 없음 — Hocuspocus 는 읽기 전용 연결의 stateless 도 통과시킨다).
   *   ① 미저장 사람 편집이 있으면 사유 없이 먼저 저장(storeNow — 저장 뮤텍스·디바운스 정리·dirty 재확인을 그대로 탄다. 앞선 태그가 있으면
   *   이 저장이 소비한다). ② 이 요청의 태그를 달고 다음 변경을 즉시 저장하도록 예약. ③ 요청 연결에만 ack.
   *   ack 는 ① 이 끝난 뒤 — 저장이 실패해도 ack 한다(storeNow 는 오류를 삼킨다. 태그는 유지되어 재시도 저장이 싣는다).
   * ai-cancel: 같은 사용자·같은 요청의 태그만 지운다(다른 사람·옛 요청의 취소가 새 태그를 지우지 않게). flush 를 기다리는 중인 요청이면
   *   대기 표시를 지워, flush 가 끝난 뒤 태그·ack 를 하지 않게 한다(웹은 이미 시간 초과로 포기한 요청).
   */
  async function handleAiMessage(connection: Connection<CollabContext>, doc: Document, payload: string): Promise<void> {
    const msg = parseCollabAiMessage(payload)
    // ack 는 서버가 보내는 것 — 클라이언트가 보낸 ack 는 무시한다.
    if (!msg || msg.type === COLLAB_AI_APPLY_ACK_TYPE) return
    const userId = connection.context.userId
    const canEdit = () => !connection.readOnly && isCollabEditRole(connection.context.role ?? '')
    if (typeof userId !== 'number' || !canEdit()) return
    const meta = registry.get(doc)
    if (!meta || meta.gone) return
    if (msg.type === COLLAB_AI_CANCEL_TYPE) {
      aiTags.cancel(doc, userId, msg.requestId)
      return
    }
    aiTags.begin(doc, userId, msg.requestId)
    // storeNow 는 저장 오류를 삼키므로(storeDocumentHooks) 여기서 던지지 않는다 — 대기 표시는 아래에서 항상 꺼낸다.
    if (registry.isDirty(doc)) await storeNow(doc)
    // 대기 표시를 꺼내며 취소 여부를 본다 — false 면 flush 도중 취소된 요청이다.
    if (!aiTags.settle(doc, userId, msg.requestId)) return
    // 저장을 기다리는 동안 권한 회수·페이지 삭제가 있었으면 태그·ack 없이 끝낸다(웹은 시간 초과 뒤 ✦ 없이 삽입하거나 포기한다).
    if (!canEdit() || meta.gone || doc.isDestroyed) return
    aiTags.set(doc, userId, msg.requestId)
    connection.sendStateless(JSON.stringify({ type: COLLAB_AI_APPLY_ACK_TYPE, requestId: msg.requestId }))
  }

  const internal = makeInternalHandler({ internalToken: cfg.internalToken, testMode: cfg.testMode, applyMarkdown, revalidate })
  // 테스트 경로는 플래그가 켜졌을 때만 — 주입돼도 운영 설정이면 연결하지 않는다(R2).
  const testRoutes = cfg.testMode ? deps.testRoutes : undefined
  // 문서별 스키마 판 바꾸기도 테스트 모드에서만 — 운영은 항상 빌드된 판.
  const schemaVersionOf = (cfg.testMode && deps.schemaVersion) || (() => WIKI_SCHEMA_VERSION)
  // 스키마 판 불일치 로그 간격 제한 상태 — 마지막으로 남긴 시각과 그 뒤 건너뛴 건수.
  const mismatchLog = { at: -Infinity, skipped: 0 }
  /** 판 불일치 거부를 로그로 남긴다 — 간격(SCHEMA_MISMATCH_LOG_MS)당 한 줄, 클라이언트 값은 잘라서 JSON 으로. */
  const logSchemaMismatch = (documentName: string, sent: string | null, expected: number): void => {
    const now = Date.now()
    if (now - mismatchLog.at < SCHEMA_MISMATCH_LOG_MS) {
      mismatchLog.skipped += 1
      return
    }
    const skipped = mismatchLog.skipped ? ` (+${mismatchLog.skipped} more since last log)` : ''
    mismatchLog.at = now
    mismatchLog.skipped = 0
    console.warn(
      `[collab] schema mismatch ${clipForLog(documentName)}: client ${clipForLog(sent)}, server ${expected} — rejected${skipped}`,
    )
  }

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
        // code = 기계 판독 사유(본문 거부·계약 위반) — API 가 상태 매핑에 쓴다(internalRoutes 의 HttpErrorCode).
        const code = e instanceof HttpError ? e.code : undefined
        if (!response.headersSent) send(response, status, { error: (e as Error).message, ...(code ? { code } : {}) })
        else response.end()
      }
      return Promise.reject()
    },

    async onAuthenticate({ token, documentName, connectionConfig, requestParameters }): Promise<ConnectionContext> {
      // 스키마 판 확인이 맨 먼저(WP-313) — 판이 다른 클라이언트는 모르는 서식의 글자를 지우고 그 삭제를 퍼뜨리므로,
      // 인증 API 호출·문서 로드·동기화 전에 거부한다. 없는 판(배포 전 웹)·옛 판·새 판 모두 거부.
      const expected = schemaVersionOf(documentName)
      const sent = requestParameters.get(COLLAB_SCHEMA_PARAM)
      if (sent !== String(expected)) {
        logSchemaMismatch(documentName, sent, expected)
        throw deny(COLLAB_SCHEMA_MISMATCH)
      }
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

    // 에디터 안 AI 적용 알림(WP-323) — Hocuspocus 는 이 콜백을 기다리지 않고, 던진 오류는 처리되지 않은 거부가 되므로 여기서 모두 삼킨다.
    async onStateless({ connection, document, payload }) {
      try {
        await handleAiMessage(connection as Connection<CollabContext>, document, payload)
      } catch (e) {
        console.error(`[collab] stateless handling failed ${document.name}:`, (e as Error).message)
      }
    },

    // ai-apply 뒤 첫 연결 변경(= AI 결과 삽입)은 디바운스 없이 저장한다 — 태그가 만료(AI_TAG_TTL_MS)되기 전에 그 저장이 소비하게.
    // 서버 내부 변경(apply-markdown 등 connection 없음)은 스스로 저장하므로 건너뛴다.
    // setImmediate: Hocuspocus 가 이 변경으로 디바운스 저장을 건 뒤에 즉시 저장을 불러, 걸린 디바운스를 지우고 한 번만 저장한다.
    async onChange({ document, connection }) {
      if (!connection || !aiTags.shouldStoreNow(document)) return
      setImmediate(() => {
        if (!document.isDestroyed && registry.isDirty(document)) void storeNow(document)
      })
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
      // 내려가는 문서의 AI 태그는 버린다(만료 타이머 정리) — 다시 로드되면 새 Document 라 태그가 없다.
      aiTags.dispose(document)
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
    applyMarkdown,
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

/**
 * 적용 요청의 스냅샷 사유(WP-297) — 요청 필드로 명시적으로 정한다(추론하지 않는다).
 * snapshot + AI → 'AI', snapshot + 사람 + replace → 'RESTORE'(버전 복원). 그 밖(snapshot 없음, 사람 merge + snapshot)은 사유 없음 →
 * 스냅샷도 싣지 않는다: 사유 없는 snapshot 은 API 가 AI 로 기록해(R7) 사람 병합이 ✦ 행으로 남기 때문이다.
 */
export function snapshotReasonOf(req: Pick<ApplyRequest, 'mode' | 'ai' | 'snapshot'>): SnapshotReason | undefined {
  if (!req.snapshot) return undefined
  if (req.ai) return 'AI'
  return req.mode === 'replace' ? 'RESTORE' : undefined
}

/** Upgrade 헤더가 websocket(대소문자 무시)인 요청만 진짜 WebSocket 업그레이드로 본다 — h2c 등은 일반 HTTP 로 처리. */
function isWebSocketUpgrade(req: IncomingMessage): boolean {
  return (req.headers.upgrade ?? '').trim().toLowerCase() === 'websocket'
}
