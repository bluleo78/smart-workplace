// 「HTML 문서」 페이지 화면(WP-1307) — 화면 테스트. 노트 페이지 자리(WikiPageView)를 띄워 kind=HTML 이면 블록 편집기 대신 이 화면이 그려지는지,
// 격리 iframe 의 sandbox(보안), 보기/편집/소스 권한, 소스 저장 payload·409 안내, 원본 내려받기 형식, 버전 미리보기·되돌리기를 본다.
// 편집 잠금(WP-1308): 남이 편집 중 띠·막힌 단추, 편집 → 저장/취소, 이어 고치기 묻기, 잠금 풀기(소유자), 남이 가져가면 편집 끝.
// 편집기 쪽 조회(멘션·요약·동기화)는 핸들러를 주지 않는다 — 편집기가 뜨면 처리되지 않은 요청으로 테스트가 실패한다.
import { act, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse, type RequestHandler } from 'msw'
import { expect, test, vi } from 'vitest'

import { renderScreen } from '@/test/renderScreen'
import type { WikiHtmlDraftInfo, WikiHtmlLockStatus, WikiPageDetail, WikiRevisionDetail, WikiRevisionList, WikiRole } from '@/types/wiki'

import { wikiHtmlLock, wikiHtmlPageDetail, wikiPageSummary, wikiSpace } from '../../../../e2e/factories/wiki.factory'
import { wikiKeys } from '../../../hooks/queries/wikiKeys'
import { handleWikiEvent } from '../../../hooks/useWikiStream'
import { hasUnsavedInput } from '../../../lib/unsavedInput'
import { WikiPageView } from '../WikiPageView'
import { HTML_EDIT_HEARTBEAT_MS, HTML_EDIT_IDLE_MS } from './useHtmlEditSession'

const PAGE_ID = 9
/** 「편집」 때 서버가 주는 편집 세션 표지 — 신호·취소·저장이 돌려준다. */
const TOKEN = 'tok-1'
/** 내 잠금(테스트 사용자 id 1) — 「편집」 응답과 신호 응답의 시작 시각이 같아야 이 세션으로 본다. */
const MY_LOCK = wikiHtmlLock({ locked: true, mine: true, holderId: 1, holderName: '나' })

/** 잠금 요청 기록 — 편집 시작(POST)·끝내기(DELETE 쿼리) 순서를 본다. */
type LockCall = { method: string; query?: string }

/**
 * HTML 문서 페이지를 연다 — detail 은 함수로 받아 저장·복원 뒤 다시 받을 때 바뀐 값을 돌려줄 수 있다.
 * lock: 잠금 상태(GET) — 기본은 잠금 없음. draft: 「편집」 때 돌려줄 내 임시 저장본. lockCalls 에 잠금 요청이 쌓인다.
 */
function open({
  role = 'OWNER',
  detail = () => wikiHtmlPageDetail({ id: PAGE_ID, version: 3 }),
  lock = () => wikiHtmlLock(),
  draft = null,
  handlers = [],
}: {
  role?: WikiRole
  detail?: () => WikiPageDetail
  lock?: () => WikiHtmlLockStatus
  draft?: WikiHtmlDraftInfo | null
  handlers?: RequestHandler[]
} = {}) {
  const lockCalls: LockCall[] = []
  const view = renderScreen(<WikiPageView pageId={PAGE_ID} spaceId={1} />, {
    path: `/wiki/spaces/1/pages/${PAGE_ID}`,
    handlers: [
      ...handlers,
      http.get('/api/v1/wiki/spaces', () => HttpResponse.json([wikiSpace({ id: 1, name: '팀 노트', role })])),
      http.get('/api/v1/wiki/spaces/1/pages', () =>
        HttpResponse.json([wikiPageSummary({ id: PAGE_ID, title: '분기 대시보드', kind: 'HTML' })]),
      ),
      http.get(`/api/v1/wiki/pages/${PAGE_ID}`, () => HttpResponse.json(detail())),
      http.get(`/api/v1/wiki/pages/${PAGE_ID}/html-lock`, () => HttpResponse.json(lock())),
      http.post(`/api/v1/wiki/pages/${PAGE_ID}/html-lock`, () => {
        lockCalls.push({ method: 'POST' })
        return HttpResponse.json({ token: TOKEN, lock: MY_LOCK, draft })
      }),
      http.put(`/api/v1/wiki/pages/${PAGE_ID}/html-lock`, () => HttpResponse.json(MY_LOCK)),
      http.delete(`/api/v1/wiki/pages/${PAGE_ID}/html-lock`, ({ request }) => {
        lockCalls.push({ method: 'DELETE', query: new URL(request.url).search })
        return new HttpResponse(null, { status: 204 })
      }),
    ],
  })
  return { ...view, lockCalls }
}

test('kind=HTML 이면 편집기 대신 원본을 격리 iframe 으로 그린다 — sandbox 는 allow-scripts 이고 allow-same-origin 이 없다', async () => {
  open()
  const frame = await screen.findByTestId('wiki-html-frame')
  const sandbox = frame.getAttribute('sandbox') ?? ''
  expect(sandbox.split(/\s+/)).toContain('allow-scripts')
  expect(sandbox).not.toContain('allow-same-origin')
  expect(frame.getAttribute('srcdoc')).toContain('<h1>매출 차트</h1>')
  // 블록 편집기(TipTap)는 뜨지 않는다.
  expect(document.querySelector('.wiki-editor')).toBeNull()
  await waitFor(() => expect(screen.getByTestId('wiki-breadcrumb')).toHaveTextContent('팀 노트분기 대시보드'))
})

test('보기 전용(VIEWER)에게는 편집·다시 올리기가 없고 소스(읽기 전용)·원본 내려받기·버전 기록만 있다', async () => {
  const { user } = open({ role: 'VIEWER' })
  await screen.findByTestId('wiki-html-frame')
  expect(screen.queryByTestId('wiki-html-mode-edit')).not.toBeInTheDocument()
  await user.click(screen.getByTestId('wiki-html-mode-source'))
  const source = screen.getByTestId<HTMLTextAreaElement>('wiki-html-source-readonly')
  expect(source.readOnly).toBe(true)
  expect(source.value).toContain('<h1>매출 차트</h1>')
  expect(screen.queryByTestId('wiki-html-reupload')).not.toBeInTheDocument()
  expect(screen.queryByTestId('wiki-share-button')).not.toBeInTheDocument()
  expect(screen.getByTestId('wiki-html-download')).toBeInTheDocument()
  expect(screen.getByTestId('wiki-html-history')).toBeInTheDocument()
  // 제목도 고칠 수 없다(입력란이 아니다).
  expect(screen.getByTestId('wiki-html-title').tagName).toBe('P')
})

test('편집 → 고쳐 저장하면 잠금을 얻고, 고치기 시작한 version 으로 {html, version} 을 PUT 하고 보기로 돌아와 새 원본을 그린다', async () => {
  const saves: unknown[] = []
  let current = wikiHtmlPageDetail({ id: PAGE_ID, version: 3 })
  const { user, lockCalls } = open({
    detail: () => current,
    handlers: [
      http.put(`/api/v1/wiki/pages/${PAGE_ID}/html`, async ({ request }) => {
        const body = (await request.json()) as { html: string; version: number; lockToken?: string }
        saves.push(body)
        current = { ...current, html: body.html, version: 4 }
        return HttpResponse.json(current)
      }),
    ],
  })
  await user.click(await screen.findByTestId('wiki-html-mode-edit'))
  expect(lockCalls).toEqual([{ method: 'POST' }])
  // 편집하는 동안 보기·소스는 잠기고 저장·취소가 보인다.
  expect(screen.getByTestId('wiki-html-mode-view')).toBeDisabled()
  expect(screen.queryByTestId('wiki-html-reupload')).not.toBeInTheDocument()
  const source = screen.getByTestId<HTMLTextAreaElement>('wiki-html-source')
  expect(source.value).toContain('<h1>매출 차트</h1>')
  await user.clear(source)
  await user.click(source)
  await user.paste('<p>새 원본</p>')
  // 미리보기는 늦춰 따라간다.
  await waitFor(() => expect(screen.getByTestId('wiki-html-preview').getAttribute('srcdoc')).toContain('<p>새 원본</p>'))
  await user.click(screen.getByTestId('wiki-html-source-save'))
  // 편집 「저장」은 이 세션의 표지를 싣는다 — 서버가 저장과 함께 잠금을 푼다.
  await waitFor(() => expect(saves).toEqual([{ html: '<p>새 원본</p>', version: 3, lockToken: TOKEN }]))
  const frame = await screen.findByTestId('wiki-html-frame')
  expect(frame.getAttribute('srcdoc')).toContain('<p>새 원본</p>')
  expect(screen.queryByTestId('wiki-html-source')).not.toBeInTheDocument()
  // 저장이 잠금을 푼다(서버) — 화면은 따로 풀기 요청을 보내지 않는다.
  expect(lockCalls).toEqual([{ method: 'POST' }])
})

test('저장이 409 면 알리고 소스를 남긴 채, 다시 받은 version 으로 기준을 옮겨 다음 저장이 409 에 갇히지 않는다', async () => {
  const saves: { version: number }[] = []
  // 처음 연 판은 3, 남이 저장한 뒤 다시 받으면 4.
  let version = 3
  const { user } = open({
    detail: () => wikiHtmlPageDetail({ id: PAGE_ID, version }),
    handlers: [
      http.put(`/api/v1/wiki/pages/${PAGE_ID}/html`, async ({ request }) => {
        const body = (await request.json()) as { html: string; version: number }
        saves.push({ version: body.version })
        if (body.version !== 4) return HttpResponse.json({ status: 409, message: 'version 충돌' }, { status: 409 })
        return HttpResponse.json(wikiHtmlPageDetail({ id: PAGE_ID, version: 5, html: body.html }))
      }),
    ],
  })
  await user.click(await screen.findByTestId('wiki-html-mode-edit'))
  await screen.findByTestId('wiki-html-source')
  await user.click(screen.getByTestId('wiki-html-source'))
  await user.paste('<p>내 수정</p>')
  version = 4 // 고치는 사이 다른 사람이 저장했다.
  await user.click(screen.getByTestId('wiki-html-source-save'))
  expect(await screen.findByText(/다른 사람이 먼저 저장했습니다/)).toBeInTheDocument()
  expect(screen.getByTestId<HTMLTextAreaElement>('wiki-html-source').value).toContain('<p>내 수정</p>')
  // 다시 받은 판(4)으로 기준이 옮겨져 한 번 더 저장하면 지금 소스로 바뀐다.
  await waitFor(() => expect(screen.getByTestId('wiki-html-source-save')).toBeEnabled())
  await user.click(screen.getByTestId('wiki-html-source-save'))
  await waitFor(() => expect(saves).toEqual([{ version: 3 }, { version: 4 }]))
  expect(await screen.findByTestId('wiki-html-frame')).toBeInTheDocument()
})

test('저장이 413 이면 서버 문구를 그대로 알린다', async () => {
  const { user } = open({
    handlers: [
      http.put(`/api/v1/wiki/pages/${PAGE_ID}/html`, () =>
        HttpResponse.json({ status: 413, message: 'HTML 문서는 5MB 까지 올릴 수 있습니다' }, { status: 413 }),
      ),
    ],
  })
  await user.click(await screen.findByTestId('wiki-html-mode-edit'))
  await user.click(await screen.findByTestId('wiki-html-source-save'))
  expect(await screen.findByText('HTML 문서는 5MB 까지 올릴 수 있습니다')).toBeInTheDocument()
})

test('원본 내려받기는 application/octet-stream Blob 을 「제목.html」로 저장시킨다(앱 창은 이동하지 않는다)', async () => {
  const created: Blob[] = []
  const spy = vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => {
    created.push(b as Blob)
    return 'blob:fake'
  })
  const clicks: string[] = []
  const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicks.push(this.download)
  })
  try {
    const { user, location } = open()
    await user.click(await screen.findByTestId('wiki-html-download'))
    expect(created).toHaveLength(1)
    expect(created[0].type).toBe('application/octet-stream')
    expect(await created[0].text()).toContain('<h1>매출 차트</h1>')
    expect(clicks).toEqual(['분기 대시보드.html'])
    expect(location()).toBe(`/wiki/spaces/1/pages/${PAGE_ID}`)
  } finally {
    spy.mockRestore()
    clickSpy.mockRestore()
  }
})

test('버전 기록 → 판을 고르면 그 원본을 격리 iframe 으로 미리 보고, 「이 버전으로 되돌리기」가 복원을 부르고 페이지를 바꾼다', async () => {
  let current = wikiHtmlPageDetail({ id: PAGE_ID, version: 3 })
  const restored: number[] = []
  const list: WikiRevisionList = {
    current: { version: 3, editedAt: '2026-01-02T00:00:00Z', editors: [] },
    items: [
      { version: 2, title: '분기 대시보드', editedAt: '2026-01-01T09:00:00Z', createdAt: '2026-01-01T09:00:00Z', reason: 'SESSION', editors: [{ id: 1, name: '김철수' }], aiActor: null },
    ],
  }
  const rev: WikiRevisionDetail = { ...list.items[0], body: '예전 글', html: '<p>예전 원본</p>' }
  const { user } = open({
    detail: () => current,
    handlers: [
      http.get(`/api/v1/wiki/pages/${PAGE_ID}/revisions`, () => HttpResponse.json(list)),
      http.get(`/api/v1/wiki/pages/${PAGE_ID}/revisions/2`, () => HttpResponse.json(rev)),
      http.post(`/api/v1/wiki/pages/${PAGE_ID}/revisions/2/restore`, () => {
        restored.push(2)
        current = { ...current, html: '<p>예전 원본</p>', version: 4 }
        return HttpResponse.json(current)
      }),
    ],
  })
  await user.click(await screen.findByTestId('wiki-html-history'))
  const dialog = await screen.findByTestId('wiki-html-revision-dialog')
  // 현재 버전에선 되돌리기가 없다.
  expect(within(dialog).queryByTestId('wiki-html-revision-restore')).not.toBeInTheDocument()
  await user.click(await within(dialog).findByTestId('wiki-html-revision-2'))
  const preview = await within(dialog).findByTestId('wiki-html-revision-frame')
  await waitFor(() => expect(preview.getAttribute('srcdoc')).toContain('<p>예전 원본</p>'))
  expect(preview.getAttribute('sandbox')).not.toContain('allow-same-origin')
  await user.click(within(dialog).getByTestId('wiki-html-revision-restore'))
  await waitFor(() => expect(restored).toEqual([2]))
  await waitFor(() => expect(screen.queryByTestId('wiki-html-revision-dialog')).not.toBeInTheDocument())
  expect(screen.getByTestId('wiki-html-frame').getAttribute('srcdoc')).toContain('<p>예전 원본</p>')
})

test('보기 전용(VIEWER)은 버전 미리보기만 하고 되돌리기는 없다', async () => {
  const list: WikiRevisionList = {
    current: { version: 3, editedAt: '2026-01-02T00:00:00Z', editors: [] },
    items: [{ version: 2, title: 'x', editedAt: '2026-01-01T09:00:00Z', createdAt: '2026-01-01T09:00:00Z', reason: null, editors: [], aiActor: null }],
  }
  const { user } = open({
    role: 'VIEWER',
    handlers: [
      http.get(`/api/v1/wiki/pages/${PAGE_ID}/revisions`, () => HttpResponse.json(list)),
      http.get(`/api/v1/wiki/pages/${PAGE_ID}/revisions/2`, () => HttpResponse.json({ ...list.items[0], body: '', html: '<p>옛</p>' })),
    ],
  })
  await user.click(await screen.findByTestId('wiki-html-history'))
  await user.click(await screen.findByTestId('wiki-html-revision-2'))
  await screen.findByTestId('wiki-html-revision-frame')
  expect(screen.queryByTestId('wiki-html-revision-restore')).not.toBeInTheDocument()
})

// ── 편집 잠금(WP-1308) ─────────────────────────────────────────────────

test('남이 편집 중이면 위 띠에 그 사람을 알리고 편집·다시 올리기를 막는다(편집자에겐 잠금 풀기가 없다)', async () => {
  open({ role: 'EDITOR', lock: () => wikiHtmlLock({ locked: true, holderName: '김민지' }) })
  const banner = await screen.findByTestId('wiki-html-lock-banner')
  expect(banner).toHaveTextContent('김민지 님이 편집 중입니다 — 저장될 때까지 보기만 할 수 있어요')
  expect(screen.getByTestId('wiki-html-mode-edit')).toBeDisabled()
  expect(screen.getByTestId('wiki-html-reupload')).toBeDisabled()
  expect(screen.queryByTestId('wiki-html-force-unlock')).not.toBeInTheDocument()
  // 보기·소스·원본 내려받기는 그대로 된다.
  expect(screen.getByTestId('wiki-html-mode-source')).toBeEnabled()
  expect(screen.getByTestId('wiki-html-download')).toBeEnabled()
})

test('스페이스 소유자는 「잠금 풀기」 → 확인으로 남의 잠금을 강제로 풀고(force=true), 풀리면 띠가 사라지고 편집할 수 있다', async () => {
  let locked = true
  const { user, lockCalls } = open({
    lock: () => (locked ? wikiHtmlLock({ locked: true, holderName: '김민지', canForceRelease: true }) : wikiHtmlLock()),
  })
  await user.click(await screen.findByTestId('wiki-html-force-unlock'))
  expect(await screen.findByTestId('wiki-html-force-unlock-dialog')).toHaveTextContent('김민지 님의 편집이 끝나고')
  locked = false
  await user.click(screen.getByTestId('wiki-html-force-unlock-confirm'))
  await waitFor(() => expect(lockCalls).toEqual([{ method: 'DELETE', query: '?force=true&keepDraft=false' }]))
  await waitFor(() => expect(screen.queryByTestId('wiki-html-lock-banner')).not.toBeInTheDocument())
  expect(screen.getByTestId('wiki-html-mode-edit')).toBeEnabled()
})

test('편집 → 취소하면 잠금을 풀고 고친 내용을 버린다(임시 저장본도 지운다) — 보기로 돌아와 원본 그대로를 그린다', async () => {
  const { user, lockCalls } = open()
  await user.click(await screen.findByTestId('wiki-html-mode-edit'))
  const source = await screen.findByTestId<HTMLTextAreaElement>('wiki-html-source')
  await user.click(source)
  await user.paste('<p>버릴 수정</p>')
  await user.click(screen.getByTestId('wiki-html-source-cancel'))
  await waitFor(() => expect(lockCalls).toEqual([{ method: 'POST' }, { method: 'DELETE', query: `?force=false&keepDraft=false&token=${TOKEN}` }]))
  const frame = await screen.findByTestId('wiki-html-frame')
  expect(frame.getAttribute('srcdoc')).not.toContain('버릴 수정')
})

test('남이 먼저 잠가 「편집」이 409(HTML_LOCKED)면 서버 문구를 알리고 편집하지 않는다', async () => {
  const { user } = open({
    handlers: [
      http.post(`/api/v1/wiki/pages/${PAGE_ID}/html-lock`, () =>
        HttpResponse.json(
          { status: 409, message: '김민지 님이 편집 중입니다 — 저장되거나 편집이 끝날 때까지 이 HTML 문서를 바꿀 수 없습니다', errors: { code: 'HTML_LOCKED', holderName: '김민지' } },
          { status: 409 },
        ),
      ),
    ],
  })
  await user.click(await screen.findByTestId('wiki-html-mode-edit'))
  expect(await screen.findByText(/김민지 님이 편집 중입니다/)).toBeInTheDocument()
  expect(screen.queryByTestId('wiki-html-source')).not.toBeInTheDocument()
})

test('다시 올리기가 남의 잠금(409 HTML_LOCKED)에 막히면 버전 충돌 안내가 아니라 서버 문구를 알린다', async () => {
  const { user } = open({
    handlers: [
      http.put(`/api/v1/wiki/pages/${PAGE_ID}/html`, () =>
        HttpResponse.json(
          { status: 409, message: '김민지 님이 편집 중입니다 — 저장되거나 편집이 끝날 때까지 이 HTML 문서를 바꿀 수 없습니다', errors: { code: 'HTML_LOCKED', holderName: '김민지' } },
          { status: 409 },
        ),
      ),
    ],
  })
  await screen.findByTestId('wiki-html-reupload')
  const input = screen.getByTestId<HTMLInputElement>('wiki-html-reupload-input')
  await user.upload(input, new File(['<p>새 파일</p>'], 'new.html', { type: 'text/html' }))
  expect(await screen.findByText(/김민지 님이 편집 중입니다/)).toBeInTheDocument()
  expect(screen.queryByText(/다른 사람이 먼저 저장했습니다/)).not.toBeInTheDocument()
})

test('남은 임시 저장본이 있으면 이어 고칠지 묻고, 그사이 다른 저장을 알린다 — 이어 고치기는 그 내용, 기준은 지금 version', async () => {
  const saves: { html: string; version: number }[] = []
  const { user } = open({
    detail: () => wikiHtmlPageDetail({ id: PAGE_ID, version: 5 }),
    draft: { html: '<p>고치던 내용</p>', baseVersion: 3, updatedAt: '2026-11-02T09:00:00Z', pageChangedSince: true },
    handlers: [
      http.put(`/api/v1/wiki/pages/${PAGE_ID}/html`, async ({ request }) => {
        const body = (await request.json()) as { html: string; version: number }
        saves.push(body)
        return HttpResponse.json(wikiHtmlPageDetail({ id: PAGE_ID, version: 6, html: body.html }))
      }),
    ],
  })
  await user.click(await screen.findByTestId('wiki-html-mode-edit'))
  const dialog = await screen.findByTestId('wiki-html-resume-dialog')
  expect(within(dialog).getByTestId('wiki-html-resume-changed')).toHaveTextContent('그사이 다른 사람이 이 문서를 저장했습니다')
  await user.click(within(dialog).getByTestId('wiki-html-resume-continue'))
  expect(screen.getByTestId<HTMLTextAreaElement>('wiki-html-source').value).toBe('<p>고치던 내용</p>')
  await user.click(screen.getByTestId('wiki-html-source-save'))
  await waitFor(() => expect(saves).toEqual([{ html: '<p>고치던 내용</p>', version: 5, lockToken: TOKEN }]))
})

test('이어 고칠지 물을 때 「새로 시작」이면 지금 원본으로 고친다(그사이 저장이 없으면 그 알림도 없다)', async () => {
  const { user, lockCalls } = open({
    draft: { html: '<p>고치던 내용</p>', baseVersion: 3, updatedAt: '2026-11-02T09:00:00Z', pageChangedSince: false },
  })
  await user.click(await screen.findByTestId('wiki-html-mode-edit'))
  const dialog = await screen.findByTestId('wiki-html-resume-dialog')
  expect(within(dialog).queryByTestId('wiki-html-resume-changed')).not.toBeInTheDocument()
  await user.click(within(dialog).getByTestId('wiki-html-resume-fresh'))
  expect(screen.getByTestId<HTMLTextAreaElement>('wiki-html-source').value).toContain('<h1>매출 차트</h1>')
  // 답했으니 잠금은 그대로 쥐고 있다(풀기 요청이 없다).
  expect(lockCalls).toEqual([{ method: 'POST' }])
})

test('편집 중 잠금이 남에게 넘어가면(소유자가 풀고 남이 시작) 편집을 끝내고 알린다 — 내용은 남기고 잠금만 푼다', async () => {
  let other = false
  const { user, lockCalls, queryClient } = open({
    lock: () => (other ? wikiHtmlLock({ locked: true, holderName: '김민지' }) : MY_LOCK),
  })
  await user.click(await screen.findByTestId('wiki-html-mode-edit'))
  await screen.findByTestId('wiki-html-source')
  other = true
  // SSE(wiki.page.lock)가 잠금 상태를 다시 받게 한 것과 같다.
  await queryClient.invalidateQueries({ queryKey: wikiKeys.htmlLock(PAGE_ID) })
  expect(await screen.findByText(/김민지 님이 편집을 시작해 내 편집이 끝났습니다/)).toBeInTheDocument()
  expect(screen.queryByTestId('wiki-html-source')).not.toBeInTheDocument()
  expect(await screen.findByTestId('wiki-html-lock-banner')).toHaveTextContent('김민지 님이 편집 중입니다')
  await waitFor(() => expect(lockCalls).toContainEqual({ method: 'DELETE', query: `?force=false&keepDraft=true&token=${TOKEN}` }))
})

test('편집 중 입력이 있으면 신호로 고치던 소스를 임시 저장본에 남기고, 입력이 10분 없으면 편집을 끝낸다(내용은 남기고 잠금만 푼다)', async () => {
  // 앱 타이머(신호 간격·10분)만 앞당긴다 — shouldAdvanceTime 이라 MSW·화면 갱신은 실제 시간으로 흐른다.
  vi.useFakeTimers({ shouldAdvanceTime: true })
  try {
    const beats: { token?: string; html?: string; baseVersion?: number }[] = []
    const { user, lockCalls } = open({
      handlers: [
        http.put(`/api/v1/wiki/pages/${PAGE_ID}/html-lock`, async ({ request }) => {
          beats.push((await request.json()) as { token?: string; html?: string; baseVersion?: number })
          return HttpResponse.json(MY_LOCK)
        }),
      ],
    })
    await user.click(await screen.findByTestId('wiki-html-mode-edit'))
    const source = await screen.findByTestId<HTMLTextAreaElement>('wiki-html-source')
    await user.click(source)
    await user.paste('<p>고치는 중</p>')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HTML_EDIT_HEARTBEAT_MS)
    })
    await waitFor(() => expect(beats).toHaveLength(1))
    expect(beats[0]).toMatchObject({ token: TOKEN, baseVersion: 3 })
    expect(beats[0].html).toContain('<p>고치는 중</p>')
    // 고쳤다가 되돌려 마지막으로 남긴 소스와 같으면 소스 없이 시각만 미룬다.
    await user.paste('x')
    await user.keyboard('{Backspace}')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HTML_EDIT_HEARTBEAT_MS)
    })
    await waitFor(() => expect(beats).toHaveLength(2))
    expect(beats[1]).toEqual({ token: TOKEN })
    // 입력이 없는 동안은 신호를 보내지 않는다(서버의 10분 규칙이 흐르게).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HTML_EDIT_IDLE_MS)
    })
    expect(beats).toHaveLength(2)
    expect(await screen.findByText(/입력이 10분 동안 없어 편집을 마쳤습니다/)).toBeInTheDocument()
    expect(screen.queryByTestId('wiki-html-source')).not.toBeInTheDocument()
    await waitFor(() => expect(lockCalls).toEqual([{ method: 'POST' }, { method: 'DELETE', query: `?force=false&keepDraft=true&token=${TOKEN}` }]))
  } finally {
    vi.useRealTimers()
  }
})

test('신호 응답이 mine=false 면(내 다른 창이 편집을 넘겨받음) 편집을 끝내고 알린다 — 잠금은 그 창 것이라 띠는 없다', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  try {
    // 같은 사람(id 1)이 다른 창에서 다시 「편집」 — 쥔 사람은 같고 시작 시각·세션이 다르다.
    const otherWindow = wikiHtmlLock({ locked: true, mine: false, holderId: 1, holderName: '나', acquiredAt: '2026-11-02T09:05:00Z' })
    const { user, lockCalls } = open({
      handlers: [http.put(`/api/v1/wiki/pages/${PAGE_ID}/html-lock`, () => HttpResponse.json(otherWindow))],
    })
    await user.click(await screen.findByTestId('wiki-html-mode-edit'))
    await user.click(await screen.findByTestId('wiki-html-source'))
    await user.paste('<p>옛 창</p>')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HTML_EDIT_HEARTBEAT_MS)
    })
    expect(await screen.findByText(/다른 창에서 편집을 시작해 내 편집이 끝났습니다/)).toBeInTheDocument()
    expect(screen.queryByTestId('wiki-html-source')).not.toBeInTheDocument()
    expect(screen.queryByTestId('wiki-html-lock-banner')).not.toBeInTheDocument()
    // 풀기 요청은 이 세션 표지로 보낸다(서버가 다른 창의 잠금이라 거절한다).
    await waitFor(() => expect(lockCalls).toContainEqual({ method: 'DELETE', query: `?force=false&keepDraft=true&token=${TOKEN}` }))
  } finally {
    vi.useRealTimers()
  }
})

test('잠금 이벤트(SSE)가 같은 사람의 새 세션을 알리면(시작 시각이 다름) 다시 받지 않고 편집을 끝낸다', async () => {
  const { user, queryClient } = open()
  await user.click(await screen.findByTestId('wiki-html-mode-edit'))
  await screen.findByTestId('wiki-html-source')
  act(() => {
    handleWikiEvent(queryClient, 'wiki.page.lock', {
      spaceId: 1,
      pageId: PAGE_ID,
      locked: true,
      holderId: 1,
      holderName: '나',
      acquiredAt: '2026-11-02T09:05:00Z',
      expiresAt: '2026-11-02T09:15:00Z',
    })
  })
  expect(await screen.findByText(/다른 창에서 편집을 시작해 내 편집이 끝났습니다/)).toBeInTheDocument()
  expect(screen.queryByTestId('wiki-html-source')).not.toBeInTheDocument()
})

test('잠금 이벤트(SSE)는 다시 받지 않고 띠를 바꾼다 — 남이 잡으면 띠, 풀리면 사라진다(소유자면 잠금 풀기도 보인다)', async () => {
  let gets = 0
  const { queryClient } = open({
    handlers: [
      http.get(`/api/v1/wiki/pages/${PAGE_ID}/html-lock`, () => {
        gets++
        return HttpResponse.json(wikiHtmlLock())
      }),
    ],
  })
  await screen.findByTestId('wiki-html-mode-edit')
  await waitFor(() => expect(gets).toBe(1))
  act(() => {
    handleWikiEvent(queryClient, 'wiki.page.lock', {
      spaceId: 1,
      pageId: PAGE_ID,
      locked: true,
      holderId: 2,
      holderName: '김민지',
      acquiredAt: '2026-11-02T09:00:00Z',
      expiresAt: '2026-11-02T09:10:00Z',
    })
  })
  expect(await screen.findByTestId('wiki-html-lock-banner')).toHaveTextContent('김민지 님이 편집 중입니다')
  expect(screen.getByTestId('wiki-html-force-unlock')).toBeInTheDocument()
  expect(screen.getByTestId('wiki-html-mode-edit')).toBeDisabled()
  act(() => {
    handleWikiEvent(queryClient, 'wiki.page.lock', { spaceId: 1, pageId: PAGE_ID, locked: false, holderId: null })
  })
  await waitFor(() => expect(screen.queryByTestId('wiki-html-lock-banner')).not.toBeInTheDocument())
  expect(gets).toBe(1)
})

test('남이 편집 중이면 버전 기록의 「되돌리기」가 막히고 이유를 알린다(서버도 막는다)', async () => {
  const list: WikiRevisionList = {
    current: { version: 3, editedAt: '2026-01-02T00:00:00Z', editors: [] },
    items: [{ version: 2, title: 'x', editedAt: '2026-01-01T09:00:00Z', createdAt: '2026-01-01T09:00:00Z', reason: null, editors: [], aiActor: null }],
  }
  const { user } = open({
    lock: () => wikiHtmlLock({ locked: true, holderName: '김민지' }),
    handlers: [
      http.get(`/api/v1/wiki/pages/${PAGE_ID}/revisions`, () => HttpResponse.json(list)),
      http.get(`/api/v1/wiki/pages/${PAGE_ID}/revisions/2`, () => HttpResponse.json({ ...list.items[0], body: '', html: '<p>옛</p>' })),
    ],
  })
  await screen.findByTestId('wiki-html-lock-banner')
  await user.click(screen.getByTestId('wiki-html-history'))
  await user.click(await screen.findByTestId('wiki-html-revision-2'))
  await screen.findByTestId('wiki-html-revision-frame')
  expect(screen.getByTestId('wiki-html-revision-restore')).toBeDisabled()
  expect(screen.getByTestId('wiki-html-revision-restore-wrap')).toHaveAttribute('title', expect.stringContaining('김민지 님이 편집 중입니다'))
})

test('고친 내용이 있는 동안만 「저장 안 한 입력」으로 등록된다(탭 닫기 경고·자동 새로고침 막기)', async () => {
  const { user } = open()
  await user.click(await screen.findByTestId('wiki-html-mode-edit'))
  const source = await screen.findByTestId('wiki-html-source')
  expect(hasUnsavedInput()).toBe(false)
  await user.click(source)
  await user.paste('<p>고침</p>')
  await waitFor(() => expect(hasUnsavedInput()).toBe(true))
  await user.click(screen.getByTestId('wiki-html-source-cancel'))
  await waitFor(() => expect(hasUnsavedInput()).toBe(false))
})
