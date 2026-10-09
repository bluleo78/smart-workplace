import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { SnapshotReason } from '../server'

/** 가짜 API 의 노트 한 건 — state 는 base64(실 API 응답과 같은 형식). */
export interface FakePage {
  tenantId: number
  spaceId: number
  body: string
  version: number
  state?: string
  bodyVersion?: number
}

/** 토큰 하나가 나타내는 사용자 — tokenExp 는 epoch 초(JWT 가 아니면 null). */
export interface FakeToken {
  userId: number
  name: string
  role: string
  tenantId: number
  tokenExp?: number | null
  /** false 면 스페이스 멤버가 아님 — 토큰은 유효하지만 collab-access 가 404(실 API 의 권한 없음 응답). */
  member?: boolean
}

/**
 * 내부 저장 호출 기록 — 테넌트 헤더·편집자까지 그대로 남겨 테스트가 단언한다.
 * stateOnly = body 없이 상태만 저장한 호출(편집 없는 최초 이관·body 앞섬 반영) — body 는 없고 bodyVersion 이 있다.
 */
export interface StoreCall {
  pageId: number
  tenantId: number
  stateOnly: boolean
  body?: string
  bodyVersion?: number
  editorIds: number[]
  state: string
  /** 이 저장 직전 판을 리비전으로 남기라는 요청(AI·복원 적용 저장). 파생 저장만. */
  snapshot?: boolean
  /** 스냅샷 사유(AI·RESTORE) — 실렸을 때만 기록(없음 = undefined). */
  snapshotReason?: SnapshotReason
  /** AI 적용을 요청한 사람(✦ 귀속) — 실렸을 때만 기록. */
  aiActorId?: number
}

export interface FakeApi {
  url: string
  /** 노트를 넣거나 바꾼다(spaceId 기본 2). */
  page(id: number, p: Omit<FakePage, 'spaceId'> & { spaceId?: number }): void
  get(id: number): FakePage
  /** 노트 삭제 흉내 — 이후 접근 판정·조회·저장이 모두 404. */
  remove(id: number): void
  /** 토큰 등록, null 이면 삭제(권한 회수 시나리오). */
  token(name: string, info: FakeToken | null): void
  stores: StoreCall[]
  /** true 면 GET /doc 이 503(API 장애 흉내). */
  failLoads: boolean
  /** true 면 PUT /doc 이 503(API 장애 흉내). */
  failStores: boolean
  /** PUT /doc 을 받은 횟수(응답 전, 성공·실패 모두) — 저장이 진행 중인지 관찰. */
  storeAttempts: number
  /** PUT /doc 응답 지연(ms) — 저장 도중에 들어오는 편집을 재현. */
  storeDelayMs: number
  /**
   * releaseStores 를 부를 때까지 PUT /doc 응답을 붙잡는다 — "저장이 API 에 가 있는 동안"을 시간(storeDelayMs) 대신 사건으로 고정한다.
   * 부하에서도 붙잡은 구간이 테스트 단계보다 먼저 끝나지 않는다(WP-311).
   */
  holdStores(): void
  /** 붙잡은 PUT /doc 을 모두 풀어 준다(안 붙잡았으면 아무 일 없음) — 단언 실패로 끝난 테스트의 정리도 막히지 않게 close 도 부른다. */
  releaseStores(): void
  /** 실패시킨 PUT /doc 호출 수. */
  storeFailures: number
  /** 없는 페이지(삭제)로 와서 404 로 답한 PUT /doc 호출 수. */
  storeNotFound: number
  loads: Array<{ pageId: number; tenantId: number }>
  accessCalls: Array<{ pageId: number; token: string }>
  close(): Promise<void>
}

/**
 * Task 3 의 API 엔드포인트를 흉내 내는 가짜 서버(메모리) — 계약은 task-3-report 기준.
 * - GET /api/v1/wiki/pages/{id}/collab-access (Bearer) → 미등록 토큰 401, 만료 토큰 401, 없는/다른 테넌트 페이지 404.
 *   응답에 tokenExp 키는 항상 있다(null 가능).
 * - GET/PUT /internal/wiki/pages/{id}/doc (Internal 토큰 + X-Tenant-Id) → 토큰 불일치 401, 테넌트 헤더 없음 400,
 *   페이지 테넌트와 헤더가 다르면 404(RLS fail-closed 흉내 — 0행 갱신이 조용히 성공하지 않게).
 *   GET 은 state 없는 페이지에서 state·bodyVersion 키를 생략한다(NON_NULL). PUT 은 version+1, bodyVersion=새 version.
 *   body 없는 PUT(상태만 저장)은 body·version 을 그대로 두고 state 와 bodyVersion(=min(요청값, 현재 version))만 바꾼다.
 */
export async function startFakeApi(internalToken = 'test-token'): Promise<FakeApi> {
  const pages = new Map<number, FakePage>()
  const tokens = new Map<string, FakeToken>()
  const stores: StoreCall[] = []
  const loads: FakeApi['loads'] = []
  const accessCalls: FakeApi['accessCalls'] = []

  const send = (res: ServerResponse, status: number, body?: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(body === undefined ? undefined : JSON.stringify(body))
  }
  const readBody = async (req: IncomingMessage): Promise<string> => {
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c as Buffer)
    return Buffer.concat(chunks).toString('utf8')
  }

  const server = createServer(async (req, res) => {
    const url = req.url ?? ''
    const access = /^\/api\/v1\/wiki\/pages\/(\d+)\/collab-access$/.exec(url)
    if (access && req.method === 'GET') {
      const pageId = Number(access[1])
      const token = (req.headers.authorization ?? '').replace(/^Bearer /, '')
      accessCalls.push({ pageId, token })
      const who = tokens.get(token)
      // 실 API 는 만료된 JWT 를 인증 필터에서 401 로 막는다 — 같은 동작을 흉내 내 재접속 루프를 막는다.
      if (!who || (who.tokenExp != null && who.tokenExp * 1000 <= Date.now())) return send(res, 401)
      const page = pages.get(pageId)
      if (!page || page.tenantId !== who.tenantId || who.member === false) return send(res, 404)
      return send(res, 200, {
        pageId,
        spaceId: page.spaceId,
        tenantId: page.tenantId,
        userId: who.userId,
        name: who.name,
        role: who.role,
        tokenExp: who.tokenExp ?? null,
      })
    }

    const doc = /^\/internal\/wiki\/pages\/(\d+)\/doc$/.exec(url)
    if (doc) {
      if (req.headers.authorization !== `Internal ${internalToken}`) return send(res, 401)
      const tenantHeader = req.headers['x-tenant-id']
      if (typeof tenantHeader !== 'string' || !/^\d+$/.test(tenantHeader)) return send(res, 400)
      const tenantId = Number(tenantHeader)
      const pageId = Number(doc[1])
      const page = pages.get(pageId)
      if (!page || page.tenantId !== tenantId) {
        if (req.method === 'PUT') self.storeNotFound += 1
        return send(res, 404)
      }
      if (req.method === 'GET') {
        if (self.failLoads) return send(res, 503)
        loads.push({ pageId, tenantId })
        const out: Record<string, unknown> = { body: page.body, version: page.version }
        if (page.state != null) {
          out.state = page.state
          out.bodyVersion = page.bodyVersion
        }
        return send(res, 200, out)
      }
      if (req.method === 'PUT') {
        self.storeAttempts += 1
        if (self.storeDelayMs > 0) await new Promise((r) => setTimeout(r, self.storeDelayMs))
        if (storeGate) await storeGate
        if (self.failStores) {
          self.storeFailures += 1
          return send(res, 503)
        }
        // 호출자가 시간 상한으로 끊은 요청(중단된 소켓)은 저장하지 않고 버린다 — 실제 API 도 응답을 못 보낸다.
        if (req.destroyed || res.destroyed) return
        const raw = await readBody(req).catch(() => null)
        if (raw == null) return
        const payload = JSON.parse(raw) as {
          state: string
          body?: string
          editorIds?: number[]
          bodyVersion?: number
          snapshot?: boolean
          snapshotReason?: SnapshotReason
          aiActorId?: number
        }
        if (payload.body == null) {
          if (payload.bodyVersion == null) return send(res, 400)
          const bodyVersion = Math.min(payload.bodyVersion, page.version)
          pages.set(pageId, { ...page, state: payload.state, bodyVersion })
          stores.push({ pageId, tenantId, stateOnly: true, bodyVersion, editorIds: [], state: payload.state })
          return send(res, 200, { version: page.version })
        }
        const version = page.version + 1
        pages.set(pageId, { ...page, body: payload.body, version, state: payload.state, bodyVersion: version })
        stores.push({
          pageId,
          tenantId,
          stateOnly: false,
          body: payload.body,
          editorIds: payload.editorIds ?? [],
          state: payload.state,
          snapshot: payload.snapshot === true,
          // 키가 아예 없을 때와 구분되게 실린 것만 남긴다(테스트가 "안 실림"을 단언).
          ...(payload.snapshotReason === undefined ? {} : { snapshotReason: payload.snapshotReason }),
          ...(payload.aiActorId === undefined ? {} : { aiActorId: payload.aiActorId }),
        })
        return send(res, 200, { version })
      }
    }
    send(res, 404)
  })

  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const { port } = server.address() as AddressInfo

  // holdStores 가 건 관문(과 그 여는 함수) — 풀릴 때까지 PUT /doc 응답을 미룬다.
  let storeGate: Promise<void> | null = null
  let openGate: (() => void) | null = null
  const self: FakeApi = {
    url: `http://127.0.0.1:${port}`,
    page(id, p) {
      pages.set(id, { spaceId: 2, ...p })
    },
    get(id) {
      const p = pages.get(id)
      if (!p) throw new Error(`no fake page ${id}`)
      return p
    },
    remove(id) {
      pages.delete(id)
    },
    token(name, info) {
      if (info) tokens.set(name, info)
      else tokens.delete(name)
    },
    stores,
    failLoads: false,
    failStores: false,
    storeFailures: 0,
    storeNotFound: 0,
    storeAttempts: 0,
    storeDelayMs: 0,
    holdStores() {
      self.releaseStores()
      storeGate = new Promise<void>((r) => (openGate = r))
    },
    releaseStores() {
      openGate?.()
      storeGate = null
      openGate = null
    },
    loads,
    accessCalls,
    close: () =>
      new Promise<void>((r) => {
        self.releaseStores()
        server.closeAllConnections()
        server.close(() => r())
      }),
  }
  return self
}
