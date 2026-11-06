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
import type { VirtualAttachment, VirtualAttachmentSource } from '@/types/drive'

import { createFile, personalSpace } from '../../../e2e/factories/drive.factory'

const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))

/** 가상 첨부 하나. */
function att(fileId: number | null, name: string, sourceType: VirtualAttachmentSource, label: string, link: string, url: string, extra: Partial<VirtualAttachment> = {}): VirtualAttachment {
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

  // WP-1391: 「이슈챗」 칩은 이슈와 메시지 사이에 있고, 누르면 source=CHAT_MESSAGE 로 다시 조회한다.
  // 이슈챗 묶음은 「메시지」가 아니라 「이슈챗」 배지(이슈·메시지와 다른 색)로 보인다.
  test('이슈챗 칩은 source=CHAT_MESSAGE 로 다시 조회하고, 이슈챗 묶음은 「이슈챗」 배지다', async () => {
    const urls: URL[] = []
    const issueFile = att(401, 'design.png', 'ISSUE', 'WP-42', '/projects/WP/issues/42', '/api/v1/files/401/download')
    const chatFile = att(402, 'trace.log', 'CHAT_MESSAGE', 'WP-42 이슈챗', '/projects/WP/issues/42?tab=chat', '/api/v1/files/402/download', { mimeType: 'text/plain' })
    const { user } = renderView({
      urls,
      list: (url) => ({ items: url.searchParams.get('source') === 'CHAT_MESSAGE' ? [chatFile] : [issueFile, chatFile], nextCursor: null }),
    })
    const chatRow = await screen.findByTestId('drive-attachment-row-402', {}, { timeout: PAGE_LOAD_TIMEOUT })
    const chatGroup = chatRow.closest('[data-testid="drive-attachment-group"]') as HTMLElement
    const chatBadge = within(chatGroup).getByTestId('drive-attachment-group-badge')
    expect(chatBadge).toHaveTextContent('이슈챗')
    const issueGroup = screen.getByTestId('drive-attachment-row-401').closest('[data-testid="drive-attachment-group"]') as HTMLElement
    const issueBadge = within(issueGroup).getByTestId('drive-attachment-group-badge')
    expect(issueBadge).toHaveTextContent('이슈')
    expect(chatBadge.className).not.toBe(issueBadge.className)

    // 칩 순서: 전체 → 이슈 → 이슈챗 → 메시지 → 노트 → 메일(WP-1392 에서 노트·메일 추가).
    const chips = [...document.querySelectorAll('[data-testid^="drive-attachment-filter-"]')].map((el) => el.textContent)
    expect(chips).toEqual(['전체', '이슈', '이슈챗', '메시지', '노트', '메일'])

    await user.click(screen.getByTestId('drive-attachment-filter-chat_message'))
    await waitFor(() => expect(screen.queryByTestId('drive-attachment-row-401')).not.toBeInTheDocument())
    expect(urls.at(-1)?.searchParams.get('source')).toBe('CHAT_MESSAGE')
    expect(screen.getByTestId('drive-attachment-filter-chat_message')).toHaveAttribute('aria-pressed', 'true')
  })

  // WP-1392: 노트·메일 칩은 각각 source=WIKI·MAIL 로 다시 조회한다. 노트·메일 묶음 배지는 다른 출처와 겹치지 않는 색이다.
  test('노트·메일 칩은 source=WIKI·MAIL 로 다시 조회하고, 노트·메일 묶음은 각자의 배지다', async () => {
    const urls: URL[] = []
    const issueFile = att(501, 'design.png', 'ISSUE', 'WP-42', '/projects/WP/issues/42', '/api/v1/files/501/download')
    const wikiFile = att(502, 'rollout.png', 'WIKI', '운영 / 배포 체크리스트', '/wiki/spaces/3/pages/7', '/api/v1/wiki/pages/7/attachments/502/content')
    const mailFile = att(null, '견적서.pdf', 'MAIL', '[견적] 11월 — 김담당', '/mail/1?messageId=9', '/api/v1/mail/attachments/601/content', {
      mimeType: 'application/pdf', mailAttachmentId: 601,
    })
    const bySource: Record<string, VirtualAttachment[]> = { WIKI: [wikiFile], MAIL: [mailFile] }
    const { user } = renderView({
      urls,
      list: (url) => ({ items: bySource[url.searchParams.get('source') ?? ''] ?? [issueFile, wikiFile, mailFile], nextCursor: null }),
    })
    const badgeOf = (rowTestId: string) =>
      within(screen.getByTestId(rowTestId).closest('[data-testid="drive-attachment-group"]') as HTMLElement).getByTestId('drive-attachment-group-badge')
    await screen.findByTestId('drive-attachment-row-502', {}, { timeout: PAGE_LOAD_TIMEOUT })
    const [issueBadge, wikiBadge, mailBadge] = [badgeOf('drive-attachment-row-501'), badgeOf('drive-attachment-row-502'), badgeOf('drive-attachment-row-mail-601')]
    expect(wikiBadge).toHaveTextContent('노트')
    expect(mailBadge).toHaveTextContent('메일')
    expect(new Set([issueBadge.className, wikiBadge.className, mailBadge.className]).size).toBe(3)

    await user.click(screen.getByTestId('drive-attachment-filter-wiki'))
    await waitFor(() => expect(screen.queryByTestId('drive-attachment-row-501')).not.toBeInTheDocument())
    expect(urls.at(-1)?.searchParams.get('source')).toBe('WIKI')
    expect(screen.getByTestId('drive-attachment-filter-wiki')).toHaveAttribute('aria-pressed', 'true')
    // 노트 첨부는 다른 파일 첨부처럼 드라이브에 저장할 수 있다.
    expect(screen.getByTestId('drive-attachment-save-502')).toBeInTheDocument()

    await user.click(screen.getByTestId('drive-attachment-filter-mail'))
    await waitFor(() => expect(screen.queryByTestId('drive-attachment-row-502')).not.toBeInTheDocument())
    expect(urls.at(-1)?.searchParams.get('source')).toBe('MAIL')
    expect(screen.getByTestId('drive-attachment-row-mail-601')).toBeInTheDocument()
  })

  // WP-1392: 이슈 본문 이미지(kind=BODY_IMAGE)는 이슈 묶음 안에서 「· 본문」으로 업로드 첨부와 구분된다.
  test('이슈 본문 이미지 행에는 「· 본문」이 붙고 업로드 첨부에는 없다', async () => {
    const upload = att(701, 'quota.png', 'ISSUE', 'WP-1391', '/projects/WP/issues/1391', '/api/v1/projects/WP/issues/1391/attachments/701/content', { kind: null })
    const bodyImage = att(702, 'image-1.png', 'ISSUE', 'WP-1391', '/projects/WP/issues/1391', '/api/v1/projects/WP/issue-images/702', { kind: 'BODY_IMAGE' })
    renderView({ list: () => ({ items: [upload, bodyImage], nextCursor: null }) })
    const bodyRow = await screen.findByTestId('drive-attachment-row-702', {}, { timeout: PAGE_LOAD_TIMEOUT })
    expect(within(bodyRow).getByTestId('drive-attachment-body-image')).toHaveTextContent('· 본문')
    expect(within(screen.getByTestId('drive-attachment-row-701')).queryByTestId('drive-attachment-body-image')).not.toBeInTheDocument()
    // 둘 다 같은 이슈 묶음 하나에 든다.
    expect(screen.getAllByTestId('drive-attachment-group')).toHaveLength(1)
  })

  // WP-1392: 메일 첨부 행 — 썸네일 대신 형식 아이콘, 다운로드는 downloadUrl(메일 첨부 경로).
  // WP-1400: 메일 행에도 「내 드라이브에 저장」이 있다(예전 줄 맞춤용 빈 자리 대신 실제 버튼).
  test('메일 첨부 행은 저장 버튼이 있고 형식 아이콘이며, 다운로드는 downloadUrl 을 요청한다', async () => {
    let downloads = 0
    const mailFile = att(null, '견적서.pdf', 'MAIL', '[견적] 11월 — 김담당', '/mail/1?messageId=9', '/api/v1/mail/attachments/601/content', {
      mimeType: 'application/pdf', mailAttachmentId: 601,
    })
    const { user } = renderView({
      list: () => ({ items: [mailFile], nextCursor: null }),
      handlers: [
        http.get('/api/v1/mail/attachments/601/content', () => {
          downloads++
          return new HttpResponse('%PDF', { headers: { 'Content-Type': 'application/pdf' } })
        }),
      ],
    })
    const row = await screen.findByTestId('drive-attachment-row-mail-601', {}, { timeout: PAGE_LOAD_TIMEOUT })
    expect(within(row).getByRole('button', { name: '내 드라이브에 저장' })).toHaveAttribute('data-testid', 'drive-attachment-save-mail-601')
    expect(within(row).queryByTestId('drive-attachment-save-spacer-mail-601')).not.toBeInTheDocument()
    expect(within(row).getByTestId('drive-attachment-type-icon')).toBeInTheDocument()
    await user.click(within(row).getByTestId('drive-attachment-download-mail-601'))
    await waitFor(() => expect(downloads).toBeGreaterThan(0))
  })

  // WP-1400: 저장 대상이 없는 비정상 메일 행(fileId·mailAttachmentId 둘 다 없음)은 저장 버튼 대신 같은 폭의 빈 자리를 둬
  // 크기·다운로드 열이 다른 행과 줄 맞는다 — 빈 자리는 보이지 않고 보조 기술·Tab 에서 빠진다.
  test('저장 대상이 없는 행은 저장 버튼 대신 보이지 않는 빈 자리를 둔다', async () => {
    const broken = att(null, '깨진.pdf', 'MAIL', '[깨짐] — 김담당', '/mail/1?messageId=9', '/api/v1/mail/attachments/0/content', {
      mimeType: 'application/pdf', mailAttachmentId: null,
    })
    renderView({ list: () => ({ items: [broken], nextCursor: null }) })
    const row = await screen.findByTestId('drive-attachment-row-mail-null', {}, { timeout: PAGE_LOAD_TIMEOUT })
    expect(within(row).queryByRole('button', { name: '내 드라이브에 저장' })).not.toBeInTheDocument()
    const spacer = within(row).getByTestId('drive-attachment-save-spacer-mail-null')
    expect(spacer).toHaveAttribute('aria-hidden', 'true')
    expect(spacer).toHaveAttribute('tabindex', '-1')
    expect(spacer).toHaveClass('invisible')
  })

  // WP-1391·1392: 머리 아래 한 줄로 세는 기준을 알린다 — 사이드바 저장 공간과 숫자가 다른 이유. 노트·메일 출처도 밝힌다.
  test('머리 아래에 세는 기준 설명이 있다', async () => {
    renderView()
    expect(await screen.findByTestId('drive-attachments-description', {}, { timeout: PAGE_LOAD_TIMEOUT })).toHaveTextContent(
      '내가 볼 수 있는 이슈·이슈챗·채팅·노트의 첨부와 내 메일의 첨부입니다 — 저장 공간 사용량과 세는 기준이 다릅니다.',
    )
  })

  // 첨부가 없으면 빈 화면 안내.
  test('빈 응답이면 「첨부가 없어요」 안내', async () => {
    renderView({ list: () => ({ items: [], nextCursor: null }) })
    await waitFor(() => expect(screen.getByTestId('drive-attachments-view')).toHaveTextContent('첨부가 없어요'), { timeout: PAGE_LOAD_TIMEOUT })
    expect(screen.getByTestId('drive-attachments-view')).toHaveTextContent('볼 수 있는 이슈·이슈챗·채팅·노트의 첨부와 내 메일의 첨부가 여기에 모입니다')
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

  // WP-1400: 메일 첨부 행의 저장 → 같은 폴더 창 → 확정하면 메일 첨부 저장(save-to-drive)에 공간·폴더를 보낸다(import-attachment 는 부르지 않는다).
  test('메일 행 저장 → 폴더 창 → 확정하면 save-to-drive 에 spaceId·folderId 를 보낸다', async () => {
    const saves: { path: string; body: Record<string, unknown> }[] = []
    let imports = 0
    const mailFile = att(null, '견적서.pdf', 'MAIL', '[견적] 11월 — 김담당', '/mail/1?messageId=9', '/api/v1/mail/attachments/601/content', {
      mimeType: 'application/pdf', mailAttachmentId: 601,
    })
    const { user } = renderView({
      list: () => ({ items: [mailFile], nextCursor: null }),
      handlers: [
        http.get('/api/v1/drive/spaces/1', () => HttpResponse.json(personalSpace({ id: 1 }))),
        http.get('/api/v1/drive/spaces/1/items', () => HttpResponse.json({ folders: [], files: [] })),
        http.post('/api/v1/mail/attachments/:id/save-to-drive', async ({ request }) => {
          saves.push({ path: new URL(request.url).pathname, body: (await request.json()) as Record<string, unknown> })
          return HttpResponse.json(createFile({ id: 900, fileId: 901, name: '견적서.pdf' }), { status: 201 })
        }),
        http.post(/import-attachment$/, () => {
          imports++
          return new HttpResponse(null, { status: 500 })
        }),
      ],
    })
    const save = await screen.findByTestId('drive-attachment-save-mail-601', {}, { timeout: PAGE_LOAD_TIMEOUT })
    await waitFor(() => expect(save).toBeEnabled())
    await user.click(save)
    const picker = await screen.findByTestId('folder-picker')
    await user.click(within(picker).getByTestId('folder-picker-confirm'))
    await waitFor(() => expect(saves).toHaveLength(1))
    expect(saves[0]).toEqual({ path: '/api/v1/mail/attachments/601/save-to-drive', body: { spaceId: 1, folderId: null } })
    expect(imports).toBe(0)
    expect(await screen.findByText('파일을 드라이브로 가져왔습니다')).toBeInTheDocument()
  })

  // WP-1400: 같은 이름 파일이 그 폴더에 있으면 서버가 409 — 가져오기와 같은 처리로 서버 문구를 오류 알림으로 보인다.
  test('메일 행 저장이 409(같은 이름)이면 서버 문구를 오류 알림으로 보인다', async () => {
    const mailFile = att(null, '견적서.pdf', 'MAIL', '[견적] 11월 — 김담당', '/mail/1?messageId=9', '/api/v1/mail/attachments/601/content', {
      mimeType: 'application/pdf', mailAttachmentId: 601,
    })
    const { user } = renderView({
      list: () => ({ items: [mailFile], nextCursor: null }),
      handlers: [
        http.get('/api/v1/drive/spaces/1', () => HttpResponse.json(personalSpace({ id: 1 }))),
        http.get('/api/v1/drive/spaces/1/items', () => HttpResponse.json({ folders: [], files: [] })),
        http.post('/api/v1/mail/attachments/601/save-to-drive', () =>
          HttpResponse.json({ status: 409, error: 'Conflict', message: "같은 폴더에 이미 '견적서.pdf' 이름이 있습니다." }, { status: 409 }),
        ),
      ],
    })
    const save = await screen.findByTestId('drive-attachment-save-mail-601', {}, { timeout: PAGE_LOAD_TIMEOUT })
    await waitFor(() => expect(save).toBeEnabled())
    await user.click(save)
    await user.click(within(await screen.findByTestId('folder-picker')).getByTestId('folder-picker-confirm'))
    expect(await screen.findByText("같은 폴더에 이미 '견적서.pdf' 이름이 있습니다.")).toBeInTheDocument()
    expect(screen.queryByText('파일을 드라이브로 가져왔습니다')).not.toBeInTheDocument()
  })

  // WP-1400: 메일 서버에서 못 받으면 500 — 서버 문구가 없으면 가져오기와 같은 일반 실패 문구를 보인다.
  test('메일 행 저장이 500(메일 서버 실패)이면 일반 실패 알림을 보인다', async () => {
    const mailFile = att(null, '견적서.pdf', 'MAIL', '[견적] 11월 — 김담당', '/mail/1?messageId=9', '/api/v1/mail/attachments/601/content', {
      mimeType: 'application/pdf', mailAttachmentId: 601,
    })
    const { user } = renderView({
      list: () => ({ items: [mailFile], nextCursor: null }),
      handlers: [
        http.get('/api/v1/drive/spaces/1', () => HttpResponse.json(personalSpace({ id: 1 }))),
        http.get('/api/v1/drive/spaces/1/items', () => HttpResponse.json({ folders: [], files: [] })),
        http.post('/api/v1/mail/attachments/601/save-to-drive', () => new HttpResponse(null, { status: 500 })),
      ],
    })
    const save = await screen.findByTestId('drive-attachment-save-mail-601', {}, { timeout: PAGE_LOAD_TIMEOUT })
    await waitFor(() => expect(save).toBeEnabled())
    await user.click(save)
    await user.click(within(await screen.findByTestId('folder-picker')).getByTestId('folder-picker-confirm'))
    expect(await screen.findByText('드라이브 임포트에 실패했습니다')).toBeInTheDocument()
    expect(screen.queryByText('파일을 드라이브로 가져왔습니다')).not.toBeInTheDocument()
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

  // WP-1392: 메일 첨부 미리보기는 메일 화면과 같은 항목 — 키 mail:{id}, 메일 첨부 콘텐츠 경로. 메일 첨부 id 가 다른 첨부의 fileId 와
  // 같은 숫자여도 행·미리보기·저장이 섞이지 않는다(파일 첨부 5 는 저장 가능, 메일 첨부 5 는 메일 경로로 열린다).
  test('메일 첨부는 mail:{id} 키·메일 경로로 열리고, 같은 숫자의 파일 첨부와 섞이지 않는다', async () => {
    const paths: string[] = []
    const issueFile = att(5, 'issue.txt', 'ISSUE', 'WP-1', '/projects/WP/issues/1', '/api/v1/projects/WP/issues/1/attachments/5/content', { mimeType: 'text/plain' })
    const mailFile = att(null, 'mail.txt', 'MAIL', '안내 — 김담당', '/mail/1?messageId=9', '/api/v1/mail/attachments/5/content', {
      mimeType: 'text/plain', mailAttachmentId: 5,
    })
    const { user, location } = renderView({
      list: () => ({ items: [issueFile, mailFile], nextCursor: null }),
      handlers: [
        http.get('/api/v1/mail/attachments/5/content', ({ request }) => {
          paths.push(new URL(request.url).pathname)
          return new HttpResponse('MAIL-BODY', { headers: { 'Content-Type': 'text/plain' } })
        }),
        http.get('/api/v1/projects/WP/issues/1/attachments/5/content', ({ request }) => {
          paths.push(new URL(request.url).pathname)
          return new HttpResponse('ISSUE-BODY', { headers: { 'Content-Type': 'text/plain' } })
        }),
      ],
    })
    // 두 행이 각자 그려지고, 저장 버튼도 행마다 따로다(WP-1400 — 메일 행 저장은 mail- 접두어 testid).
    const fileRow = await screen.findByTestId('drive-attachment-row-5', {}, { timeout: PAGE_LOAD_TIMEOUT })
    const mailRow = screen.getByTestId('drive-attachment-row-mail-5')
    expect(within(fileRow).getByTestId('drive-attachment-save-5')).toBeInTheDocument()
    expect(within(mailRow).getByTestId('drive-attachment-save-mail-5')).toBeInTheDocument()

    await user.click(within(mailRow).getByRole('button', { name: 'mail.txt' }))
    await waitFor(() => expect(screen.getByTestId('preview-body')).toHaveTextContent('MAIL-BODY'))
    expect(location()).toMatch(/preview=mail(%3A|:)5/)
    expect(paths).toContain('/api/v1/mail/attachments/5/content')
    expect(paths).not.toContain('/api/v1/projects/WP/issues/1/attachments/5/content')
  })

  // WP-1400: 뷰어 ☁ 도 행 저장과 같은 대상으로 저장한다 — 메일 첨부는 save-to-drive, 같은 숫자의 파일 첨부는 import-attachment.
  test('뷰어 ☁ 는 메일 첨부면 save-to-drive, 파일 첨부면 import-attachment 를 부른다', async () => {
    const calls: { path: string; body: Record<string, unknown> }[] = []
    const issueFile = att(5, 'issue.txt', 'ISSUE', 'WP-1', '/projects/WP/issues/1', '/api/v1/projects/WP/issues/1/attachments/5/content', { mimeType: 'text/plain' })
    const mailFile = att(null, 'mail.txt', 'MAIL', '안내 — 김담당', '/mail/1?messageId=9', '/api/v1/mail/attachments/5/content', {
      mimeType: 'text/plain', mailAttachmentId: 5,
    })
    const record = async (request: Request) => {
      calls.push({ path: new URL(request.url).pathname, body: (await request.json()) as Record<string, unknown> })
      return HttpResponse.json(createFile({ id: 900, fileId: 901, name: 'x.txt' }), { status: 201 })
    }
    const { user } = renderView({
      list: () => ({ items: [issueFile, mailFile], nextCursor: null }),
      handlers: [
        http.get('/api/v1/mail/attachments/5/content', () => new HttpResponse('MAIL-BODY', { headers: { 'Content-Type': 'text/plain' } })),
        http.get('/api/v1/projects/WP/issues/1/attachments/5/content', () => new HttpResponse('ISSUE-BODY', { headers: { 'Content-Type': 'text/plain' } })),
        http.get('/api/v1/drive/spaces/1', () => HttpResponse.json(personalSpace({ id: 1 }))),
        http.get('/api/v1/drive/spaces/1/items', () => HttpResponse.json({ folders: [], files: [] })),
        http.post('/api/v1/mail/attachments/:id/save-to-drive', ({ request }) => record(request)),
        http.post('/api/v1/drive/spaces/1/import-attachment', ({ request }) => record(request)),
      ],
    })
    const saveVia = async (rowTestId: string, name: string) => {
      await user.click(within(await screen.findByTestId(rowTestId, {}, { timeout: PAGE_LOAD_TIMEOUT })).getByRole('button', { name }))
      const viewer = await screen.findByTestId('attachment-viewer')
      const cloud = within(viewer).getByRole('button', { name: '드라이브로 가져오기' })
      await waitFor(() => expect(cloud).toBeEnabled())
      await user.click(cloud)
      await user.click(within(await screen.findByTestId('folder-picker')).getByTestId('folder-picker-confirm'))
      await waitFor(() => expect(screen.queryByTestId('folder-picker')).not.toBeInTheDocument())
      await user.keyboard('{Escape}')
      await waitFor(() => expect(screen.queryByTestId('attachment-viewer')).not.toBeInTheDocument())
    }
    await saveVia('drive-attachment-row-mail-5', 'mail.txt')
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toEqual({ path: '/api/v1/mail/attachments/5/save-to-drive', body: { spaceId: 1, folderId: null } })
    await saveVia('drive-attachment-row-5', 'issue.txt')
    await waitFor(() => expect(calls).toHaveLength(2))
    expect(calls[1]).toEqual({ path: '/api/v1/drive/spaces/1/import-attachment', body: { fileId: 5 } })
  })

  // WP-1392 리뷰: 메일 id 가 빠진 비정상 메일 행 둘이 한 키(file:null)를 나눠 가지면 두 번째 행을 눌러도 첫 행이 열린다 —
  // 행마다 다른 대체 키라 누른 그 행의 downloadUrl 로 열린다.
  test('메일 id 가 빠진 메일 행 둘은 각자 자기 첨부로 열린다', async () => {
    const paths: string[] = []
    const mk = (n: number) =>
      att(null, `broken-${n}.txt`, 'MAIL', '안내 — 김담당', '/mail/1?messageId=9', `/api/v1/mail/attachments/${n}/content`, {
        mimeType: 'text/plain', mailAttachmentId: null,
      })
    const { user, location } = renderView({
      list: () => ({ items: [mk(71), mk(72)], nextCursor: null }),
      handlers: [
        http.get('/api/v1/mail/attachments/:id/content', ({ request, params }) => {
          paths.push(new URL(request.url).pathname)
          return new HttpResponse(`BODY-${params.id}`, { headers: { 'Content-Type': 'text/plain' } })
        }),
      ],
    })
    await user.click(await screen.findByRole('button', { name: 'broken-72.txt' }, { timeout: PAGE_LOAD_TIMEOUT }))
    await waitFor(() => expect(screen.getByTestId('preview-body')).toHaveTextContent('BODY-72'))
    expect(location()).not.toMatch(/preview=file(%3A|:)null/)
    expect(paths).not.toContain('/api/v1/mail/attachments/71/content')
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
