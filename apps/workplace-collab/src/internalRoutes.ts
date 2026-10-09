import { timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

import { REVALIDATE_REASON_DELETED } from '@smart-workplace/wiki-editor-schema'

import { pageIdOf } from './docRegistry'

/** HTTP 처리기 — 응답했으면 true(이후 처리기·기본 응답 생략), 자기 경로가 아니면 false. */
export type RequestHandler = (req: IncomingMessage, res: ServerResponse) => Promise<boolean>

/**
 * 오류 응답의 기계 판독 코드 — API 가 상태 매핑에 쓴다(사람용 문구 error 는 바뀔 수 있다).
 * - empty_body·unparseable_body: 제출 본문 문제 → API 가 호출자에게 400.
 * - invalid_request: API 가 보낸 요청이 계약에 어긋남(우리 쪽 버그) → API 는 500 으로 기록한다.
 */
export type HttpErrorCode = 'empty_body' | 'unparseable_body' | 'invalid_request'

/** 상태 코드(와 기계 판독 코드)를 실어 던지는 오류 — 처리기가 그 코드로 응답한다. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: HttpErrorCode,
  ) {
    super(message)
  }
}

/** apply-markdown 요청(검증 후) — API 계약 + 테스트 모드 전용 docName. */
export interface ApplyRequest {
  tenantId: number
  pageId: number
  /**
   * replace = 문서를 body 와 같게, merge = baseBody·현재본·body 3-way 병합(AI·구버전 웹 본문 PUT, 스펙 §5.1).
   * API 는 merge 만 보낸다 — replace 는 웹 E2E 픽스처(테스트 모드)와 이후 버전 복원(WP-297)이 쓴다.
   */
  mode: 'replace' | 'merge'
  /** merge 일 때 쓴 쪽이 읽은 판의 본문(API 가 기준본 테이블에서 찾아 싣는다). */
  baseBody?: string
  /**
   * merge 기준본 후보 둘째 — 그 version 이 누군가의 본문 저장 응답이었으면 그때 제출된 본문. baseBody(그 판의 실제 본문)와
   * 둘 중 AI본에 가까운 쪽을 기준으로 쓴다(closestBase — 응답 본문에서 이어 썼는지, 자기 본문에서 이어 썼는지).
   */
  altBaseBody?: string
  body: string
  actor: { userId: number; name: string }
  ai: boolean
  /**
   * 적용 저장에 snapshot(직전 판을 리비전으로)을 싣는다 — AI 적용이거나 버전 복원(replace, ai=false, WP-297). 없으면 ai 와 같다(구버전 API 호환).
   * 사유는 `snapshotReasonOf`(server.ts)가 정한다 — AI 적용은 AI, 사람 replace(복원)는 RESTORE 이고 그때만 미저장 사람 입력을 먼저 저장한다.
   * 사람 merge 에 snapshot 이 와도 사유가 없어 스냅샷을 싣지 않는다.
   */
  snapshot: boolean
  /** 테스트 모드에서만 허용 — E2E 의 네임스페이스 문서(`{ns}/wiki-page:{id}`)를 겨눈다. */
  docName?: string
}

/** revalidate 요청 — pageIds 가 있으면 그 페이지들, 없으면 spaceId 의 모든 문서. userId 가 있으면 그 사용자 연결만. */
export interface RevalidateRequest {
  tenantId: number
  spaceId?: number
  pageIds?: number[]
  userId?: number
  /** 'deleted' = 페이지 삭제 재검증 — 접근을 잃은 연결을 4403 대신 4404(삭제)로 닫는다. */
  reason?: typeof REVALIDATE_REASON_DELETED
}

/**
 * apply-markdown 응답 — persisted=false 면 적용(실시간 문서 변경)은 됐지만 그 즉시 저장이 시간 안에 끝나지 않았다(재시도가 저장한다).
 * 그때 version 은 마지막으로 저장된 판(적용분 미포함), body 는 적용 후 문서 본문이다.
 */
export interface ApplyResult {
  version: number
  body: string
  persisted: boolean
}

export interface InternalDeps {
  internalToken: string
  testMode: boolean
  applyMarkdown(req: ApplyRequest): Promise<ApplyResult>
  revalidate(req: RevalidateRequest): Promise<void>
}

// 요청 본문 상한 — 노트 본문 전체가 오므로 넉넉히(API 의 노트 본문 상한보다 크게).
const MAX_BODY_BYTES = 8 * 1024 * 1024
const APPLY_PATH = /^\/internal\/docs\/(\d+)\/apply-markdown$/

/**
 * 동기화 서버 내부 HTTP — API 만 호출한다(인그레스는 /collab 만 외부로 연다).
 * - POST /internal/docs/{pageId}/apply-markdown (replace|merge): API 가 위임한 본문을 실시간 문서에 반영(merge 는 3-way 병합)·즉시 저장
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
      return send(res, 200, await deps.applyMarkdown(parsed))
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
const bad = (msg: string) => new HttpError(400, msg, 'invalid_request')

/** apply-markdown 본문 검증 — mode 는 replace|merge, merge 는 baseBody 필수. */
function parseApply(raw: unknown, pageId: number, testMode: boolean): ApplyRequest {
  const b = (raw ?? {}) as Record<string, unknown>
  if (b.mode !== 'replace' && b.mode !== 'merge') throw bad('unsupported mode')
  if (b.mode === 'merge' && typeof b.baseBody !== 'string') throw bad('invalid baseBody')
  if (b.altBaseBody != null && typeof b.altBaseBody !== 'string') throw bad('invalid altBaseBody')
  if (!isPosInt(pageId)) throw bad('invalid pageId')
  if (!isPosInt(b.tenantId)) throw bad('invalid tenantId')
  if (typeof b.body !== 'string') throw bad('invalid body')
  const actor = b.actor as Record<string, unknown> | undefined
  // 이름은 표시용(✦ 이름표, WP-289)일 뿐이라 비어 있어도 본문 저장을 막지 않는다(collab 400 은 API 에서 500 이 된다).
  if (!actor || !isPosInt(actor.userId) || (actor.name != null && typeof actor.name !== 'string')) throw bad('invalid actor')
  if (typeof b.ai !== 'boolean') throw bad('invalid ai')
  if (b.snapshot != null && typeof b.snapshot !== 'boolean') throw bad('invalid snapshot')
  const out: ApplyRequest = {
    tenantId: b.tenantId,
    pageId,
    mode: b.mode,
    body: b.body,
    actor: { userId: actor.userId, name: (actor.name as string | null | undefined) ?? '' },
    ai: b.ai,
    snapshot: typeof b.snapshot === 'boolean' ? b.snapshot : b.ai,
  }
  if (b.mode === 'merge') {
    out.baseBody = b.baseBody as string
    if (typeof b.altBaseBody === 'string') out.altBaseBody = b.altBaseBody
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
  if (b.reason === REVALIDATE_REASON_DELETED) out.reason = REVALIDATE_REASON_DELETED
  else if (b.reason != null) {
    // 모르는 사유(새 API·옛 동기화 서버가 섞인 배포)는 사유 없음으로 본다 — 400 으로 거절하면 접근을 잃은 연결이 열린 채 남는다(fail-open).
    console.warn(`[collab] unknown revalidate reason ${JSON.stringify(b.reason)} — treating as no reason (4403)`)
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
