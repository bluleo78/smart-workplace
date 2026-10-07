import { timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

import { pageIdOf } from './docRegistry'

/** HTTP 처리기 — 응답했으면 true(이후 처리기·기본 응답 생략), 자기 경로가 아니면 false. */
export type RequestHandler = (req: IncomingMessage, res: ServerResponse) => Promise<boolean>

/** 상태 코드를 실어 던지는 오류 — 처리기가 그 코드로 응답한다. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

/** apply-markdown 요청(검증 후) — API(Task 4) 계약 + 테스트 모드 전용 docName. */
export interface ApplyRequest {
  tenantId: number
  pageId: number
  body: string
  actor: { userId: number; name: string }
  ai: boolean
  /** 테스트 모드에서만 허용 — E2E 의 네임스페이스 문서(`{ns}/wiki-page:{id}`)를 겨눈다. */
  docName?: string
}

/** revalidate 요청 — pageIds 가 있으면 그 페이지들, 없으면 spaceId 의 모든 문서. userId 가 있으면 그 사용자 연결만. */
export interface RevalidateRequest {
  tenantId: number
  spaceId?: number
  pageIds?: number[]
  userId?: number
}

export interface InternalDeps {
  internalToken: string
  testMode: boolean
  applyReplace(req: ApplyRequest): Promise<{ version: number; body: string }>
  revalidate(req: RevalidateRequest): Promise<void>
}

// 요청 본문 상한 — 노트 본문 전체가 오므로 넉넉히(API 의 노트 본문 상한보다 크게).
const MAX_BODY_BYTES = 8 * 1024 * 1024
const APPLY_PATH = /^\/internal\/docs\/(\d+)\/apply-markdown$/

/**
 * 동기화 서버 내부 HTTP — API 만 호출한다(인그레스는 /collab 만 외부로 연다).
 * - POST /internal/docs/{pageId}/apply-markdown (replace): API 가 위임한 본문을 실시간 문서에 반영·즉시 저장(merge 는 WP-289)
 * - POST /internal/docs/revalidate: 권한 변화(멤버 제거·강등·페이지 삭제) 시 열린 연결 재판정
 * 모든 /internal/* 는 `Authorization: Internal <token>` 필수.
 */
export function makeInternalHandler(deps: InternalDeps): RequestHandler {
  return async (req, res) => {
    const path = pathOf(req)
    if (!path.startsWith('/internal/')) return false
    if (!validInternal(req.headers.authorization, deps.internalToken)) return send(res, 401, { error: 'unauthorized' })

    const apply = APPLY_PATH.exec(path)
    if (req.method === 'POST' && apply) {
      const parsed = parseApply(await readJson(req), Number(apply[1]), deps.testMode)
      return send(res, 200, await deps.applyReplace(parsed))
    }
    if (req.method === 'POST' && path === '/internal/docs/revalidate') {
      await deps.revalidate(parseRevalidate(await readJson(req)))
      return send(res, 204)
    }
    return send(res, 404, { error: 'not found' })
  }
}

/** 경로만(쿼리 제외) — 원시 req.url 비교는 쿼리가 붙으면 어긋난다. */
export function pathOf(req: IncomingMessage): string {
  return new URL(req.url ?? '/', 'http://collab').pathname
}

/** Internal 토큰 비교 — 길이가 같을 때만 상수 시간 비교(빈 토큰 설정이면 항상 거부). */
function validInternal(header: string | undefined, token: string): boolean {
  if (!token || !header?.startsWith('Internal ')) return false
  const a = Buffer.from(header.slice('Internal '.length))
  const b = Buffer.from(token)
  return a.length === b.length && timingSafeEqual(a, b)
}

const isPosInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0
const bad = (msg: string) => new HttpError(400, msg)

/** apply-markdown 본문 검증 — mode 는 replace 만(merge 는 WP-289 전까지 400). */
function parseApply(raw: unknown, pageId: number, testMode: boolean): ApplyRequest {
  const b = (raw ?? {}) as Record<string, unknown>
  if (b.mode !== 'replace') throw bad('unsupported mode')
  if (!isPosInt(pageId)) throw bad('invalid pageId')
  if (!isPosInt(b.tenantId)) throw bad('invalid tenantId')
  if (typeof b.body !== 'string') throw bad('invalid body')
  const actor = b.actor as Record<string, unknown> | undefined
  // 이름은 표시용(✦ 이름표, WP-289)일 뿐이라 비어 있어도 본문 저장을 막지 않는다(collab 400 은 API 에서 500 이 된다).
  if (!actor || !isPosInt(actor.userId) || (actor.name != null && typeof actor.name !== 'string')) throw bad('invalid actor')
  if (typeof b.ai !== 'boolean') throw bad('invalid ai')
  const out: ApplyRequest = {
    tenantId: b.tenantId,
    pageId,
    body: b.body,
    actor: { userId: actor.userId, name: (actor.name as string | null | undefined) ?? '' },
    ai: b.ai,
  }
  if (b.docName !== undefined) {
    // 운영에서는 문서 이름을 항상 pageId 로 만든다 — 다른 이름을 겨누는 요청은 거부.
    if (!testMode || typeof b.docName !== 'string' || pageIdOf(b.docName, true) !== pageId) throw bad('invalid docName')
    out.docName = b.docName
  }
  return out
}

/** revalidate 본문 검증 — spaceId 나 pageIds 중 하나는 있어야 대상이 정해진다. */
function parseRevalidate(raw: unknown): RevalidateRequest {
  const b = (raw ?? {}) as Record<string, unknown>
  if (!isPosInt(b.tenantId)) throw bad('invalid tenantId')
  const out: RevalidateRequest = { tenantId: b.tenantId }
  if (b.spaceId != null) {
    if (!isPosInt(b.spaceId)) throw bad('invalid spaceId')
    out.spaceId = b.spaceId
  }
  if (b.pageIds != null) {
    if (!Array.isArray(b.pageIds) || !b.pageIds.every(isPosInt)) throw bad('invalid pageIds')
    out.pageIds = b.pageIds
  }
  if (b.userId != null) {
    if (!isPosInt(b.userId)) throw bad('invalid userId')
    out.userId = b.userId
  }
  if (out.spaceId == null && out.pageIds == null) throw bad('spaceId or pageIds required')
  return out
}

/** JSON 본문 읽기 — 상한 초과 413, 파싱 실패 400, 빈 본문은 {}. */
export async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const c of req) {
    size += (c as Buffer).length
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'body too large')
    chunks.push(c as Buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    throw bad('invalid json')
  }
}

/** JSON 응답 — 항상 true 를 돌려 처리 체인을 끊는다. */
export function send(res: ServerResponse, status: number, body?: unknown): true {
  if (body === undefined) {
    res.writeHead(status)
    res.end()
  } else {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(body))
  }
  return true
}
