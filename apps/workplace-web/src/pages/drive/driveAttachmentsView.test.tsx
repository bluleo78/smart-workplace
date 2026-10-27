// @vitest-environment jsdom
// happy-dom(화면 테스트 기본, WP-1002)과 날짜 칸·글자 수 제한·포커스 이동 처리가 달라 이 파일은 jsdom 에서 돈다.
// 첨부 모아보기(/drive/attachments, DriveAttachmentsView) — 화면 컴포넌트 테스트(WP-971, WP-984).
// 출처 그룹·접기, 이슈/채널 첨부에 없는 작업, 다운로드·미리보기 콘텐츠 경로(downloadUrl), 출처 필터 source·빈 화면,
// 「내 드라이브에 저장」 import payload, 미리보기 묶음(같은 출처 안에서만 ‹ ›)·딥링크(없음·예전 숫자·조회 실패)는 브라우저 없이 판정되므로
// e2e/pages/drive/drive-attachments-grouped.spec.ts·drive-preview-attachment.spec.ts·drive-cross-link.spec.ts 에서 옮겼다.
// 화면 배선(@wiring)·키보드 포커스로 보이는 다운로드(@input)·헤더/AI 칩 기하(@layout)는 drive-attachments-grouped.spec.ts 가 지킨다.
// 같은 교차링크(#80)의 반대 방향 — 이슈 첨부 스트립(IssueAttachmentStrip)의 「드라이브에서 링크」 payload — 도 여기 둔다(파일당 모듈 로딩 비용을 아끼려 한 파일에 모음).
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse, type RequestHandler } from 'msw'
import { describe, expect, test } from 'vitest'

import { AIAssistantProvider } from '@/components/ai/AIAssistantContext'
import { DriveAttachmentsView } from '@/pages/drive/DriveAttachmentsView'
import { IssueAttachmentStrip } from '@/pages/projects/components/IssueAttachmentStrip'
import { PAGE_LOAD_TIMEOUT } from '@/test/renderPage'
import { renderScreen } from '@/test/renderScreen'
import type { VirtualAttachment } from '@/types/drive'

import { createFile, personalSpace } from '../../../e2e/factories/drive.factory'

const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))

/** 가상 첨부 하나. */
function att(fileId: number, name: string, sourceType: 'ISSUE' | 'MESSAGE', label: string, link: string, url: string, extra: Partial<VirtualAttachment> = {}): VirtualAttachment {
  return { fileId, name, mimeType: 'image/png', sizeBytes: 100, hasThumbnail: false, sourceType, sourceLabel: label, deepLink: link, downloadUrl: url, attachedAt: '2026-07-01T10:00:00Z', ...extra }
}

/** 이슈 첨부 2건 + 채널 첨부 1건(drive-attachments-grouped.spec 과 같은 묶음). */
const GROUPED = [
  att(1, 'design.png', 'ISSUE', 'PROJ-123 제목', '/projects/PROJ/issues/123', '/api/v1/projects/PROJ/issues/123/attachments/1/content', { sizeBytes: 2100, hasThumbnail: true, attachedAt: '2026-07-01T12:00:00Z' }),
  att(2, 'spec.pdf', 'ISSUE', 'PROJ-123 제목', '/projects/PROJ/issues/123', '/api/v1/projects/PROJ/issues/123/attachments/2/content', { mimeType: 'application/pdf', attachedAt: '2026-07-01T11:00:00Z' }),
  att(3, 'report.docx', 'MESSAGE', '#general', '/chat/channels/5', '/api/v1/messaging/channels/5/messages/9/attachments/3/content', { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
]

/**
 * 첨부 모아보기를 띄운다 — 공간 목록(개인)·썸네일(404)과 첨부 목록 응답(list)을 준다. list 는 요청 URL 로 응답을 고른다.
 * 미리보기가 AI 진입점(useAssistant)을 쓰므로 앱 셸의 AIAssistantProvider 만 함께 감싼다.
 */
type ListReply = { items: VirtualAttachment[]; nextCursor: string | null } | Response

function renderView({
  search = '',
  list = (): ListReply => ({ items: GROUPED, nextCursor: null }),
  handlers = [] as RequestHandler[],
  urls = [] as URL[],
}: { search?: string; list?: (url: URL) => ListReply; handlers?: RequestHandler[]; urls?: URL[] } = {}) {
  return renderScreen(
    <AIAssistantProvider hotkeysEnabled={false}>
      <DriveAttachmentsView />
    </AIAssistantProvider>,
    {
      path: `/drive/attachments${search}`,
      handlers: [
        ...handlers,
        http.get('/api/v1/drive/spaces', () => HttpResponse.json([personalSpace({ id: 1 })])),
        http.get('/api/v1/drive/attachments', ({ request }) => {
          const url = new URL(request.url)
          urls.push(url)
          const body = list(url)
          return body instanceof Response ? body : HttpResponse.json(body)
        }),
        http.get('/api/v1/drive/files/:id/thumbnail', () => new HttpResponse(null, { status: 404 })),
      ],
    },
  )
}

const imageContent = () => new HttpResponse(PNG, { headers: { 'Content-Type': 'image/png' } })

describe('목록', () => {
  // 그룹 접기(WP-940: 버튼 이름에 묶음 이름) — 접으면 행이 빠지고 이름이 「펼치기」로 바뀐다.
  test('셰브론 토글로 그룹을 접고 펼친다', async () => {
    const { user } = renderView()
    const first = (await screen.findAllByTestId('drive-attachment-group', {}, { timeout: PAGE_LOAD_TIMEOUT }))[0]
    const toggle = within(first).getByTestId('drive-attachment-group-toggle')
    expect(toggle).toHaveAccessibleName('PROJ-123 제목 묶음 접기')
    await user.click(toggle)
    expect(within(first).queryByTestId('drive-attachment-row-1')).not.toBeInTheDocument()
    expect(toggle).toHaveAccessibleName('PROJ-123 제목 묶음 펼치기')
    await user.click(toggle)
    expect(within(first).getByTestId('drive-attachment-row-1')).toBeInTheDocument()
  })

  // 이슈/채널 첨부에는 공유·버전·이동·복사·삭제·선택이 없고 「내 드라이브에 저장」만 있다. 다운로드는 downloadUrl(첨부 콘텐츠 경로)을 받는다.
  test('불가 작업은 없고 저장 버튼이 있으며, 다운로드는 downloadUrl 을 요청한다', async () => {
    let downloads = 0
    const { user } = renderView({
      handlers: [
        http.get('/api/v1/projects/PROJ/issues/123/attachments/1/content', () => {
          downloads++
          return imageContent()
        }),
      ],
    })
    const row = await screen.findByTestId('drive-attachment-row-1', {}, { timeout: PAGE_LOAD_TIMEOUT })
    for (const name of ['공유 링크', '버전 이력', '이동', '복사', '삭제']) expect(within(row).queryByRole('button', { name })).not.toBeInTheDocument()
    expect(row.querySelector('input[type="checkbox"]')).toBeNull()
    expect(within(row).getByTestId('drive-attachment-save-1')).toHaveTextContent('내 드라이브에 저장')
    // 다운로드 버튼은 hover·포커스 때만 보이지만(E2E @input) DOM 에는 있다.
    await user.click(within(row).getByTestId('drive-attachment-download-1'))
    await waitFor(() => expect(downloads).toBeGreaterThan(0))
  })

  // #80: 출처 배지(이슈/메시지)와 라벨 딥링크, 「이슈」 필터를 누르면 source=ISSUE 로 다시 불러 메시지 첨부가 빠진다.
  test('출처 배지·딥링크를 보이고, 이슈 필터는 source=ISSUE 로 다시 조회한다', async () => {
    const urls: URL[] = []
    const issueFile = att(201, 'design.png', 'ISSUE', 'WP-42', '/projects/WP/issues/42', '/api/v1/files/201/download')
    const messageFile = att(202, 'log.txt', 'MESSAGE', '#general', '/messaging/channels/1', '/api/v1/files/202/download', { mimeType: 'text/plain' })
    const { user } = renderView({
      urls,
      list: (url) => ({ items: url.searchParams.get('source') === 'ISSUE' ? [issueFile] : [issueFile, messageFile], nextCursor: null }),
    })
    const issueRow = await screen.findByTestId('drive-attachment-row-201', {}, { timeout: PAGE_LOAD_TIMEOUT })
    const issueGroup = issueRow.closest('[data-testid="drive-attachment-group"]') as HTMLElement
    expect(issueGroup).toHaveTextContent('이슈')
    expect(within(issueGroup).getByRole('link', { name: 'WP-42' })).toHaveAttribute('href', '/projects/WP/issues/42')
    const messageGroup = screen.getByTestId('drive-attachment-row-202').closest('[data-testid="drive-attachment-group"]') as HTMLElement
    expect(messageGroup).toHaveTextContent('메시지')
    expect(within(messageGroup).getByRole('link', { name: '#general' })).toHaveAttribute('href', '/messaging/channels/1')

    await user.click(screen.getByTestId('drive-attachment-filter-issue'))
    await waitFor(() => expect(screen.queryByTestId('drive-attachment-row-202')).not.toBeInTheDocument())
    expect(screen.getByTestId('drive-attachment-row-201')).toBeInTheDocument()
    expect(urls.at(-1)?.searchParams.get('source')).toBe('ISSUE')
    expect(screen.getByTestId('drive-attachment-filter-issue')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('drive-attachment-filter-all')).toHaveAttribute('aria-pressed', 'false')
  })

  // 첨부가 없으면 빈 화면 안내.
  test('빈 응답이면 「첨부가 없어요」 안내', async () => {
    renderView({ list: () => ({ items: [], nextCursor: null }) })
    await waitFor(() => expect(screen.getByTestId('drive-attachments-view')).toHaveTextContent('첨부가 없어요'), { timeout: PAGE_LOAD_TIMEOUT })
  })

  // 「내 드라이브에 저장」 → 폴더 창(개인 공간) → 확정하면 import-attachment 에 그 첨부 fileId 를 보낸다.
  test('저장 → 폴더 창 → 확정하면 import-attachment 에 fileId 를 보낸다', async () => {
    const posts: Record<string, unknown>[] = []
    const file = att(301, 'report.xlsx', 'ISSUE', 'WP-10', '/projects/WP/issues/10', '/api/v1/files/301/download')
    const { user } = renderView({
      list: () => ({ items: [file], nextCursor: null }),
      handlers: [
        http.get('/api/v1/drive/spaces/1', () => HttpResponse.json(personalSpace({ id: 1 }))),
        http.get('/api/v1/drive/spaces/1/items', () => HttpResponse.json({ folders: [], files: [] })),
        http.post('/api/v1/drive/spaces/1/import-attachment', async ({ request }) => {
          posts.push((await request.json()) as Record<string, unknown>)
          return HttpResponse.json(createFile({ id: 301, fileId: 301, name: 'report.xlsx' }), { status: 201 })
        }),
      ],
    })
    const save = await screen.findByTestId('drive-attachment-save-301', {}, { timeout: PAGE_LOAD_TIMEOUT })
    await waitFor(() => expect(save).toBeEnabled())
    await user.click(save)
    const picker = await screen.findByTestId('folder-picker')
    await user.click(within(picker).getByTestId('folder-picker-confirm'))
    await waitFor(() => expect(posts).toHaveLength(1))
    expect(posts[0].fileId).toBe(301)
  })
})

describe('미리보기', () => {
  // 첨부 미리보기는 downloadUrl 콘텐츠를 받아 그리고, 드라이브 전용 패널(AI 요약·참조된 곳)은 없다.
  test('이미지 첨부는 downloadUrl 로 받아 그리고 드라이브 요약·참조 패널이 없다', async () => {
    let contents = 0
    const { user } = renderView({
      list: () => ({ items: [att(77, 'shot.png', 'ISSUE', 'PROJ-1 제목', '/projects/PROJ/issues/1', '/api/v1/projects/PROJ/issues/1/attachments/77/content', { hasThumbnail: true })], nextCursor: null }),
      handlers: [
        http.get('/api/v1/projects/PROJ/issues/1/attachments/77/content', () => {
          contents++
          return imageContent()
        }),
      ],
    })
    await user.click(await screen.findByRole('button', { name: 'shot.png' }, { timeout: PAGE_LOAD_TIMEOUT }))
    const body = await screen.findByTestId('preview-body')
    await waitFor(() => expect(body.querySelector('img')).not.toBeNull())
    expect(contents).toBeGreaterThan(0)
    expect(screen.queryByTestId('drive-summary-card')).not.toBeInTheDocument()
    expect(screen.queryByTestId('file-backlinks')).not.toBeInTheDocument()
  })

  // WP-277: 묶음 = 클릭한 첨부의 출처 그룹 — ‹ › 는 그 안에서만, 순번도 그룹 개수. 1건 그룹은 ‹ › 가 없다.
  test('‹ › 는 같은 출처 그룹 안에서만 움직이고 순번은 그룹 개수다', async () => {
    const items = [
      att(1, 'a1.png', 'ISSUE', 'PROJ-1 제목', '/projects/PROJ/issues/1', '/api/v1/projects/PROJ/issues/1/attachments/1/content'),
      att(2, 'a2.png', 'ISSUE', 'PROJ-1 제목', '/projects/PROJ/issues/1', '/api/v1/projects/PROJ/issues/1/attachments/2/content'),
      att(3, 'm1.png', 'MESSAGE', '#general', '/chat/channels/5', '/api/v1/messaging/channels/5/messages/9/attachments/3/content'),
    ]
    const { user } = renderView({
      list: () => ({ items, nextCursor: null }),
      handlers: [http.get(/\/attachments\/\d+\/content$/, imageContent)],
    })
    await user.click(await screen.findByRole('button', { name: 'a1.png' }, { timeout: PAGE_LOAD_TIMEOUT }))
    await screen.findByTestId('attachment-viewer')
    expect(screen.getByTestId('preview-meta')).toHaveTextContent('1 / 2')
    expect(screen.queryByRole('button', { name: '이전 파일' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '다음 파일' }))
    await waitFor(() => expect(screen.getByTestId('preview-meta')).toHaveTextContent('2 / 2'))
    expect(screen.queryByRole('button', { name: '다음 파일' })).not.toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByTestId('attachment-viewer')).not.toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'm1.png' }))
    await screen.findByTestId('attachment-viewer')
    expect(screen.queryByRole('button', { name: '이전 파일' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '다음 파일' })).not.toBeInTheDocument()
  })

  // WP-277: 목록 끝까지 없는 첨부 딥링크는 찾을 수 없음 안내, 닫으면 ?preview 를 지운다.
  test('없는 첨부 딥링크는 찾을 수 없음 안내이고 닫으면 preview 를 지운다', async () => {
    const { user, location } = renderView({ search: '?preview=file:999', list: () => ({ items: [], nextCursor: null }) })
    expect(await screen.findByTestId('preview-not-found', {}, { timeout: PAGE_LOAD_TIMEOUT })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByTestId('preview-not-found')).not.toBeInTheDocument())
    await waitFor(() => expect(location()).not.toMatch(/preview=/))
  })

  // WP-277: 예전 형식(?preview=<숫자>)도 file:<id> 로 읽어 그 첨부를 연다.
  test('예전 숫자 딥링크(?preview=77)도 그 첨부를 연다', async () => {
    renderView({
      search: '?preview=77',
      list: () => ({ items: [att(77, 'legacy.txt', 'ISSUE', 'PROJ-1 제목', '/projects/PROJ/issues/1', '/api/v1/projects/PROJ/issues/1/attachments/77/content', { mimeType: 'text/plain', sizeBytes: 6 })], nextCursor: null }),
      handlers: [http.get('/api/v1/projects/PROJ/issues/1/attachments/77/content', () => new HttpResponse('LEGACY', { headers: { 'Content-Type': 'text/plain' } }))],
    })
    await waitFor(() => expect(screen.getByTestId('preview-body')).toHaveTextContent('LEGACY'), { timeout: PAGE_LOAD_TIMEOUT })
    expect(screen.queryByTestId('preview-not-found')).not.toBeInTheDocument()
  })

  // WP-277: 목록 조회가 실패해도 딥링크를 방치하지 않고 찾을 수 없음 안내를 보인다.
  test('목록 조회 실패(403) 시 딥링크는 찾을 수 없음 안내', async () => {
    renderView({ search: '?preview=file:77', list: () => HttpResponse.json({ message: 'forbidden' }, { status: 403 }) })
    expect(await screen.findByTestId('preview-not-found', {}, { timeout: PAGE_LOAD_TIMEOUT })).toBeInTheDocument()
  })
})

describe('이슈 → 드라이브 링크', () => {
  // 「드라이브에서 링크」 → 파일 선택 창(개인 공간) → 파일을 고르면 drive-links 에 그 driveFileId 를 보낸다(링크 행 표시·키보드 제거는 E2E @input).
  test('「드라이브에서 링크」 → 파일 선택 → drive-links 에 driveFileId 를 보낸다', async () => {
    const [KEY, NUMBER, PERSONAL, FILE_ID] = ['WP', 42, 99, 999] as const
    const posts: Record<string, unknown>[] = []
    const { user } = renderScreen(
      <AIAssistantProvider hotkeysEnabled={false}>
        <IssueAttachmentStrip projectKey={KEY} number={NUMBER} attachmentCount={1} currentUserId={1} isOwner canEditContent />
      </AIAssistantProvider>,
      {
        path: `/projects/${KEY}/issues/${NUMBER}`,
        handlers: [
          http.get('/api/v1/drive/spaces', () => HttpResponse.json([personalSpace({ id: PERSONAL })])),
          http.get(`/api/v1/drive/spaces/${PERSONAL}`, () => HttpResponse.json(personalSpace({ id: PERSONAL }))),
          http.get(`/api/v1/drive/spaces/${PERSONAL}/items`, () =>
            HttpResponse.json({ folders: [], files: [createFile({ id: FILE_ID, fileId: FILE_ID, name: 'target.pdf' })] }),
          ),
          http.get(`/api/v1/projects/${KEY}/issues/${NUMBER}/attachments`, () => HttpResponse.json([])),
          http.get(`/api/v1/projects/${KEY}/issues/${NUMBER}/drive-links`, () => HttpResponse.json([])),
          http.post(`/api/v1/projects/${KEY}/issues/${NUMBER}/drive-links`, async ({ request }) => {
            posts.push((await request.json()) as Record<string, unknown>)
            return HttpResponse.json({}, { status: 201 })
          }),
        ],
      },
    )
    const add = await screen.findByTestId('issue-drive-link-add-btn', {}, { timeout: PAGE_LOAD_TIMEOUT })
    await waitFor(() => expect(add).toBeEnabled())
    await user.click(add)
    await screen.findByTestId('folder-picker')
    await user.click(await screen.findByTestId(`file-picker-file-${FILE_ID}`))
    await waitFor(() => expect(posts).toHaveLength(1))
    expect(posts[0].driveFileId).toBe(FILE_ID)
  })
})
