// 메일 임시저장(WP-577) E2E 모킹 — 백엔드 /api/v1/mail/drafts 계약대로 상태를 들고 응답하는 작은 서버.
// POST 201 {id,version,updatedAt} · PUT 200 {version,updatedAt,attachmentCount} — 은 version 이 다르면 409(errors.code=DRAFT_CONFLICT), 없으면 404(errors.code=DRAFT_NOT_FOUND) · DELETE 204 ·
// 목록은 갱신 최신순, 미리보기는 bodyText 를 공백 정리한 앞 120자. 저장에 실린 업로드가 내 다른 임시저장에 묶여 있으면 옮겨 묶는다(그쪽에서 빠짐).
// 발송(POST /accounts/1/send)에 draftId 가 오면 그 임시저장을 지운다.
// auth.fixture 가 거는 기본 스텁(stubDraftsDefault — 빈 목록·0개)보다 나중에 등록되므로 이 모킹이 우선한다(LIFO).
import type { Page } from '@playwright/test'

import type { MailDraftDetail, MailDraftSaveRequest, MailDraftSummary } from '../../src/types/mailDraft'
import { mockApi } from './api-mock'
import { trackRequests } from './requests'

/**
 * 기본 스텁(auth.fixture 가 모든 인증 페이지에 건다) — 사이드바 「임시보관함」 개수는 모든 메일 화면에서, 자동 저장(POST·PUT)은 작성창에 쓰기만 해도 나간다.
 * 미스텁이면 dev 프록시로 새어 저장 실패 상태·토스트가 임시저장과 무관한 작성 스펙을 흔든다. 임시저장을 검증하는 스펙은 mockDraftServer 를 나중에 건다(LIFO 우선).
 * PUT 은 요청 version + 1 을 돌려준다(다음 PUT 이 그 값을 싣는다).
 */
export async function stubDraftsDefault(page: Page) {
  await mockApi(page, 'GET', '/api/v1/mail/drafts/count', { count: 0 })
  await mockApi(page, 'GET', '/api/v1/mail/drafts', [])
  let e2eDraftSeq = 9000
  await page.route(
    (url) => /^\/api\/v1\/mail\/drafts(\/\d+)?$/.test(url.pathname),
    (route) => {
      const method = route.request().method()
      const now = new Date().toISOString()
      if (method === 'POST') {
        return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: ++e2eDraftSeq, version: 1, updatedAt: now }) })
      }
      if (method === 'PUT') {
        const req = route.request().postDataJSON() as MailDraftSaveRequest
        const version = Number(req.version ?? 0) + 1
        const attachmentCount = req.attachmentIds.length + req.forwardAttachmentIds.length
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version, updatedAt: now, attachmentCount }) })
      }
      if (method === 'DELETE') return route.fulfill({ status: 204, body: '' })
      return route.fallback()
    },
  )
}

/** 목록 미리보기 — 서버와 같은 규칙(공백 정리 → 앞 120자). */
const preview = (text: string) => Array.from(text.replace(/\s+/g, ' ').trim()).slice(0, 120).join('')

interface Stored {
  detail: MailDraftDetail
  preview: string
}

/**
 * 임시저장 서버 모킹을 건다. initial 은 처음부터 있는 임시저장(목록 미리보기는 previews 로 줄 수 있다).
 * 돌려주는 값: 지금 상태(drafts), 요청 기록(posts·puts·deletes·details·counts), 다른 탭이 먼저 고친 상황 만들기(bumpVersion).
 */
export async function mockDraftServer(page: Page, initial: MailDraftDetail[] = [], previews: Record<number, string> = {}) {
  const drafts = new Map<number, Stored>()
  for (const d of initial) drafts.set(d.id, { detail: d, preview: previews[d.id] ?? '' })
  let seq = 100
  let tick = 0
  // 저장 시각은 단조 증가 — 목록 정렬(최신순)이 결정적이게.
  const stamp = () => new Date(Date.UTC(2026, 9, 21, 2, 0, tick++)).toISOString()

  const posts = trackRequests(page, 'POST', '/api/v1/mail/drafts')
  const puts = trackRequests(page, 'PUT', /^\/api\/v1\/mail\/drafts\/\d+$/)
  const deletes = trackRequests(page, 'DELETE', /^\/api\/v1\/mail\/drafts\/\d+$/)
  const details = trackRequests(page, 'GET', /^\/api\/v1\/mail\/drafts\/\d+$/)
  const lists = trackRequests(page, 'GET', '/api/v1/mail/drafts')
  const counts = trackRequests(page, 'GET', '/api/v1/mail/drafts/count')

  const summaries = (): MailDraftSummary[] =>
    [...drafts.values()]
      .sort((a, b) => b.detail.updatedAt.localeCompare(a.detail.updatedAt))
      .map(({ detail: d, preview }) => ({
        id: d.id,
        accountId: d.accountId,
        mode: d.mode,
        to: d.to,
        subject: d.subject,
        preview,
        attachmentCount: d.attachments.length,
        updatedAt: d.updatedAt,
      }))

  /** 저장 요청 → 상세. 첨부 이름은 모킹이라 id 로 만든다(기존 것·옮겨 온 것은 이름을 유지). 다른 임시저장의 같은 업로드는 옮겨 온다. */
  const apply = (id: number, version: number, req: MailDraftSaveRequest, prev?: MailDraftDetail): MailDraftDetail => {
    const known = new Map((prev?.attachments ?? []).map((a) => [`${a.source}-${a.id}`, a]))
    for (const [otherId, other] of drafts) {
      if (otherId === id) continue
      const moved = other.detail.attachments.filter((a) => a.source === 'upload' && req.attachmentIds.includes(a.id))
      if (moved.length === 0) continue
      moved.forEach((a) => known.set(`upload-${a.id}`, a))
      drafts.set(otherId, { ...other, detail: { ...other.detail, attachments: other.detail.attachments.filter((a) => !moved.includes(a)) } })
    }
    const att = (source: 'upload' | 'forward', ids: number[]) =>
      ids.map((aid) => known.get(`${source}-${aid}`) ?? { id: aid, name: `${source}-${aid}.pdf`, size: 10, mimeType: 'application/pdf', source })
    return {
      id,
      accountId: req.accountId,
      mode: req.mode,
      to: req.to,
      cc: req.cc,
      bcc: req.bcc,
      subject: req.subject,
      bodyHtml: req.bodyHtml,
      sourceMessageId: req.sourceMessageId,
      quoteRemoved: req.quoteRemoved,
      attachments: [...att('forward', req.forwardAttachmentIds), ...att('upload', req.attachmentIds)],
      version,
      updatedAt: stamp(),
    }
  }

  await page.route(
    (u) => u.pathname === '/api/v1/mail/drafts/count',
    (route) => route.fulfill({ json: { count: drafts.size } }),
  )
  await page.route(
    (u) => u.pathname === '/api/v1/mail/drafts',
    (route) => {
      const method = route.request().method()
      if (method === 'GET') return route.fulfill({ json: summaries() })
      if (method !== 'POST') return route.fallback()
      const req = route.request().postDataJSON() as MailDraftSaveRequest
      const id = ++seq
      drafts.set(id, { detail: apply(id, 1, req), preview: preview(req.bodyText) })
      return route.fulfill({ status: 201, json: { id, version: 1, updatedAt: drafts.get(id)!.detail.updatedAt } })
    },
  )
  await page.route(
    (u) => /^\/api\/v1\/mail\/drafts\/\d+$/.test(u.pathname),
    (route) => {
      const id = Number(new URL(route.request().url()).pathname.split('/').pop())
      const cur = drafts.get(id)
      const method = route.request().method()
      if (!cur) {
        return route.fulfill({ status: 404, json: { status: 404, message: '임시저장을 찾을 수 없어요', errors: { code: 'DRAFT_NOT_FOUND' } } })
      }
      if (method === 'GET') return route.fulfill({ json: cur.detail })
      if (method === 'DELETE') {
        drafts.delete(id)
        return route.fulfill({ status: 204, body: '' })
      }
      if (method === 'PUT') {
        const req = route.request().postDataJSON() as MailDraftSaveRequest
        if (req.version !== cur.detail.version) {
          return route.fulfill({
            status: 409,
            json: { status: 409, message: '다른 창에서 이 임시저장을 먼저 고쳤어요', errors: { code: 'DRAFT_CONFLICT' } },
          })
        }
        const next = apply(id, cur.detail.version + 1, req, cur.detail)
        drafts.set(id, { detail: next, preview: preview(req.bodyText) })
        return route.fulfill({ json: { version: next.version, updatedAt: next.updatedAt, attachmentCount: next.attachments.length } })
      }
      return route.fallback()
    },
  )

  return {
    drafts,
    posts,
    puts,
    deletes,
    details,
    lists,
    counts,
    /** 다른 탭·기기가 먼저 저장한 상황 — 서버 버전을 올리고 내용을 바꾼다. */
    bumpVersion(id: number, change: Partial<MailDraftDetail> = {}) {
      const cur = drafts.get(id)!
      drafts.set(id, { ...cur, detail: { ...cur.detail, ...change, version: cur.detail.version + 1, updatedAt: stamp() } })
    },
  }
}

/** 발송 성공 모킹 — draftId 가 오면 그 임시저장을 지운다(백엔드와 같은 규칙). */
export async function mockSendWithDrafts(page: Page, server: Awaited<ReturnType<typeof mockDraftServer>>) {
  const sends = trackRequests(page, 'POST', '/api/v1/mail/accounts/1/send')
  await page.route(
    (u) => u.pathname === '/api/v1/mail/accounts/1/send',
    (route) => {
      const body = route.request().postDataJSON() as { draftId?: number }
      if (body.draftId != null) server.drafts.delete(body.draftId)
      return route.fulfill({ json: { localMessageId: 10, messageId: 'x@test.local' } })
    },
  )
  return sends
}
