// 「HTML 문서」 페이지 화면(WP-1307) — 화면 테스트. 노트 페이지 자리(WikiPageView)를 띄워 kind=HTML 이면 블록 편집기 대신 이 화면이 그려지는지,
// 격리 iframe 의 sandbox(보안), 보기/소스 권한, 소스 저장 payload·409 안내, 원본 내려받기 형식, 버전 미리보기·되돌리기를 본다.
// 편집기 쪽 조회(멘션·요약·동기화)는 핸들러를 주지 않는다 — 편집기가 뜨면 처리되지 않은 요청으로 테스트가 실패한다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse, type RequestHandler } from 'msw'
import { expect, test, vi } from 'vitest'

import { renderScreen } from '@/test/renderScreen'
import type { WikiPageDetail, WikiRevisionDetail, WikiRevisionList, WikiRole } from '@/types/wiki'

import { wikiHtmlPageDetail, wikiPageSummary, wikiSpace } from '../../../../e2e/factories/wiki.factory'
import { WikiPageView } from '../WikiPageView'

const PAGE_ID = 9

/** HTML 문서 페이지를 연다 — detail 은 함수로 받아 저장·복원 뒤 다시 받을 때 바뀐 값을 돌려줄 수 있다. */
function open({
  role = 'OWNER',
  detail = () => wikiHtmlPageDetail({ id: PAGE_ID, version: 3 }),
  handlers = [],
}: { role?: WikiRole; detail?: () => WikiPageDetail; handlers?: RequestHandler[] } = {}) {
  return renderScreen(<WikiPageView pageId={PAGE_ID} spaceId={1} />, {
    path: `/wiki/spaces/1/pages/${PAGE_ID}`,
    handlers: [
      ...handlers,
      http.get('/api/v1/wiki/spaces', () => HttpResponse.json([wikiSpace({ id: 1, name: '팀 노트', role })])),
      http.get('/api/v1/wiki/spaces/1/pages', () =>
        HttpResponse.json([wikiPageSummary({ id: PAGE_ID, title: '분기 대시보드', kind: 'HTML' })]),
      ),
      http.get(`/api/v1/wiki/pages/${PAGE_ID}`, () => HttpResponse.json(detail())),
    ],
  })
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

test('보기 전용(VIEWER)에게는 보기/소스 전환·다시 올리기가 없고 원본 내려받기·버전 기록만 있다', async () => {
  open({ role: 'VIEWER' })
  await screen.findByTestId('wiki-html-frame')
  expect(screen.queryByTestId('wiki-html-mode-source')).not.toBeInTheDocument()
  expect(screen.queryByTestId('wiki-html-reupload')).not.toBeInTheDocument()
  expect(screen.queryByTestId('wiki-share-button')).not.toBeInTheDocument()
  expect(screen.getByTestId('wiki-html-download')).toBeInTheDocument()
  expect(screen.getByTestId('wiki-html-history')).toBeInTheDocument()
  // 제목도 고칠 수 없다(입력란이 아니다).
  expect(screen.getByTestId('wiki-html-title').tagName).toBe('P')
})

test('소스 → 고쳐 저장하면 고치기 시작한 version 으로 {html, version} 을 PUT 하고 보기로 돌아와 새 원본을 그린다', async () => {
  const saves: unknown[] = []
  let current = wikiHtmlPageDetail({ id: PAGE_ID, version: 3 })
  const { user } = open({
    detail: () => current,
    handlers: [
      http.put(`/api/v1/wiki/pages/${PAGE_ID}/html`, async ({ request }) => {
        const body = (await request.json()) as { html: string; version: number }
        saves.push(body)
        current = { ...current, html: body.html, version: 4 }
        return HttpResponse.json(current)
      }),
    ],
  })
  await user.click(await screen.findByTestId('wiki-html-mode-source'))
  const source = screen.getByTestId<HTMLTextAreaElement>('wiki-html-source')
  expect(source.value).toContain('<h1>매출 차트</h1>')
  await user.clear(source)
  await user.click(source)
  await user.paste('<p>새 원본</p>')
  // 미리보기는 늦춰 따라간다.
  await waitFor(() => expect(screen.getByTestId('wiki-html-preview').getAttribute('srcdoc')).toContain('<p>새 원본</p>'))
  await user.click(screen.getByTestId('wiki-html-source-save'))
  await waitFor(() => expect(saves).toEqual([{ html: '<p>새 원본</p>', version: 3 }]))
  const frame = await screen.findByTestId('wiki-html-frame')
  expect(frame.getAttribute('srcdoc')).toContain('<p>새 원본</p>')
  expect(screen.queryByTestId('wiki-html-source')).not.toBeInTheDocument()
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
  await user.click(await screen.findByTestId('wiki-html-mode-source'))
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
  await user.click(await screen.findByTestId('wiki-html-mode-source'))
  await user.click(screen.getByTestId('wiki-html-source-save'))
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
