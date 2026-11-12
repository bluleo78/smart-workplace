// 이슈 첨부(업로드·삭제·검증·스피너·버튼 이름)와 첨부 뷰어 묶음의 조건부 표시(WP-203·WP-277·WP-431·#782·#783) — 페이지 테스트(WP-980).
// 파일 선택 → POST·토스트·목록 갱신, 25MB·10개 한도 사전 검증, 업로드 중 스피너, 권한별 삭제 버튼, 문서(HWP) 변환 경로·휴지통·삭제된 링크,
// 요약 403·요약 패널·⋯ 메뉴, 드라이브에 저장 POST·위치 토스트, 없는 첨부 딥링크 안내는 브라우저 없이 판정되므로
// e2e/pages/projects/attachments.spec.ts 에서 옮겼다. 그 spec 에는 다운로드·PDF·이미지 렌더·실시간 재조회(@platform),
// ‹ › 키보드 넘기기·포커스 복귀(@input), 드라이브 폴더로 여는 흐름(@flow)이 남는다.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { delay, http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { recordRequests } from '@/test/kits/projects/issueDetailStubs'
import { openIssueDetail } from '@/test/kits/projects/openIssueDetail'
import type { IssueAttachment } from '@/types/attachment'

import { createAttachment } from '../../../e2e/factories/attachment.factory'
import { createFile, createFolder, personalSpace } from '../../../e2e/factories/drive.factory'
import { createIssue, createIssueDetail } from '../../../e2e/factories/issue.factory'

const KEY = 'WP'
const BASE = `/api/v1/projects/${KEY}/issues/1`
const ATT = `${BASE}/attachments`

const detail = (attachmentCount: number) =>
  createIssueDetail({ summary: createIssue({ id: 1, number: 1, title: '첨부 대상', attachmentCount }), body: '본문' })

/** 드롭존의 숨은 file input. */
const fileInput = () => screen.getByTestId('attachment-dropzone').querySelector<HTMLInputElement>('input[type=file]')!

const driveLink = (driveFileId: number, over: Record<string, unknown> = {}) => ({
  driveFileId, fileId: driveFileId + 1000, name: `linked-${driveFileId}.txt`, mimeType: 'text/plain', sizeBytes: 4, hasThumbnail: false,
  spaceId: 1, spaceName: '팀 공간', availability: 'ACTIVE', createdById: 1, createdAt: '2026-01-01T00:00:00Z', ...over,
})

/** 드라이브 링크 미리보기에 필요한 콘텐츠·요약·참조된 곳. summary 를 주면 그 응답(상태 코드 포함). */
function linkHandlers(id: number, summary: { status?: number; body: unknown } = { body: { summary: null, status: 'PENDING' } }) {
  return [
    http.get(`${BASE}/drive-links/${id}/content`, () => new HttpResponse('LINKED-BODY', { headers: { 'Content-Type': 'text/plain' } })),
    http.get(`/api/v1/drive/files/${id}/summary`, () => HttpResponse.json(summary.body as never, { status: summary.status ?? 200 })),
    http.get(`/api/v1/drive/files/${id}/backlinks`, () => HttpResponse.json([])),
  ]
}

describe('이슈 첨부 업로드·삭제', () => {
  test('파일 선택 → POST 1회·토스트·목록 1행 → 삭제 확인창 → DELETE·토스트·칩 사라짐(드롭존만)', async () => {
    let store: IssueAttachment[] = []
    const requests = recordRequests()
    const { user } = await openIssueDetail({
      detail: detail(0),
      attachments: () => store,
      handlers: [
        http.post(ATT, () => {
          const added = createAttachment({ fileId: 9001, originalName: 'spec.pdf', sizeBytes: 1024, mimeType: 'application/pdf', attachedById: 1 })
          store = [...store, added]
          return HttpResponse.json([added])
        }),
        http.delete(`${ATT}/:id`, ({ params }) => {
          store = store.filter((a) => a.fileId !== Number(params.id))
          return new HttpResponse(null, { status: 204 })
        }),
      ],
    })
    expect(await screen.findByTestId('attachment-dropzone')).toHaveTextContent('파일을 드롭하거나 클릭해 첨부')
    await user.upload(fileInput(), new File(['hello-attachment'], 'spec.pdf', { type: 'application/pdf' }))
    expect(await screen.findByText('1개 첨부를 추가했습니다')).toBeInTheDocument()
    expect(requests.count('POST', ATT)).toBe(1)
    const row = await screen.findByTestId('attachment-row-9001')
    expect(screen.getByTestId('attachment-list')).toBeInTheDocument()
    expect(row).toHaveTextContent('spec.pdf')

    // WP-203: 삭제 버튼은 hover 없이 항상 있다. 확인창(#148) → 삭제.
    await user.click(within(row).getByRole('button', { name: 'spec.pdf 삭제' }))
    expect(await screen.findByTestId('attachment-delete-dialog')).toBeInTheDocument()
    await user.click(screen.getByTestId('attachment-delete-confirm'))
    expect(await screen.findByText('첨부를 삭제했습니다')).toBeInTheDocument()
    expect(requests.count('DELETE', `${ATT}/9001`)).toBe(1)
    const strip = screen.getByTestId('issue-attachment-strip')
    await waitFor(() => expect(within(strip).queryByTestId('attachment-row-9001')).not.toBeInTheDocument())
    expect(within(strip).getByTestId('attachment-dropzone')).toBeInTheDocument()
  })

  test('25MB 초과 파일은 사전 검증 토스트만 보이고 POST 가 없다', async () => {
    const requests = recordRequests()
    const { user } = await openIssueDetail({ detail: detail(0), handlers: [http.post(ATT, () => HttpResponse.json([]))] })
    await screen.findByTestId('attachment-dropzone')
    await user.upload(fileInput(), new File([new Uint8Array(26 * 1024 * 1024)], 'huge.bin', { type: 'application/octet-stream' }))
    expect(await screen.findByText('huge.bin는 25MB 한도를 초과합니다')).toBeInTheDocument()
    await act(() => new Promise((r) => setTimeout(r, 200)))
    expect(requests.count('POST', ATT)).toBe(0)
  })

  // 첨부 9개인 이슈에 2개 — 첫 번째만 받고 두 번째는 한도 초과. 'test.pdf' 끝 글자 f 는 받침 없음 → 「를」.
  test('이슈당 첨부 한도(10개)를 넘는 파일은 올바른 조사로 건너뛰고, 앞 파일만 POST 한다', async () => {
    const requests = recordRequests()
    const { user } = await openIssueDetail({
      detail: detail(9),
      handlers: [http.post(ATT, () => HttpResponse.json([createAttachment({ fileId: 9999, originalName: 'first.pdf' })]))],
    })
    await screen.findByTestId('attachment-dropzone')
    await user.upload(fileInput(), [
      new File(['a'], 'first.pdf', { type: 'application/pdf' }),
      new File(['b'], 'test.pdf', { type: 'application/pdf' }),
    ])
    expect(await screen.findByText('이슈당 첨부 한도(10개)를 초과하여 test.pdf를 건너뜁니다')).toBeInTheDocument()
    await waitFor(() => expect(requests.count('POST', ATT)).toBe(1))
    await act(() => new Promise((r) => setTimeout(r, 200)))
    expect(requests.count('POST', ATT)).toBe(1)
  })

  test('업로드 중에는 드롭존이 「업로드 중…」 + 회전 스피너, 끝나면 스피너가 사라진다 (#782)', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const { user } = await openIssueDetail({
      detail: detail(0),
      handlers: [
        http.post(ATT, async () => {
          await gate
          return HttpResponse.json([createAttachment({ fileId: 9101, originalName: 'slow.pdf' })])
        }),
      ],
    })
    const dropzone = await screen.findByTestId('attachment-dropzone')
    await user.upload(fileInput(), new File(['slow-upload'], 'slow.pdf', { type: 'application/pdf' }))
    await waitFor(() => expect(dropzone).toHaveTextContent('업로드 중…'))
    expect(dropzone.querySelector('svg.animate-spin')).not.toBeNull()
    act(() => release())
    expect(await screen.findByText('1개 첨부를 추가했습니다')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('attachment-dropzone').querySelector('svg.animate-spin')).toBeNull())
  })

  test('삭제 버튼 접근 이름은 파일명별로 다르다 (#783)', async () => {
    await openIssueDetail({
      detail: detail(2),
      attachments: [
        createAttachment({ fileId: 8101, originalName: 'alpha.pdf', mimeType: 'application/pdf' }),
        createAttachment({ fileId: 8102, originalName: 'beta.png', mimeType: 'image/png' }),
      ],
    })
    const alpha = await screen.findByTestId('attachment-row-8101')
    const beta = screen.getByTestId('attachment-row-8102')
    expect(within(alpha).getAllByRole('button', { name: 'alpha.pdf 삭제' })).toHaveLength(1)
    expect(within(beta).getAllByRole('button', { name: 'beta.png 삭제' })).toHaveLength(1)
    expect(within(alpha).queryByRole('button', { name: 'beta.png 삭제' })).not.toBeInTheDocument()
    expect(within(beta).queryByRole('button', { name: 'alpha.pdf 삭제' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '첨부 삭제' })).not.toBeInTheDocument()
  })

  // WP-203 — 현재 사용자(id 1)는 OWNER 가 아니라 내 첨부만 삭제할 수 있다. 다운로드는 모두에게.
  test('첨부 칩의 다운로드·삭제 버튼은 늘 있고, 남의 첨부에는 삭제가 없다', async () => {
    await openIssueDetail({
      detail: detail(2),
      attachments: [
        createAttachment({ fileId: 8001, originalName: 'mine.pdf', attachedById: 1 }),
        createAttachment({ fileId: 8002, originalName: 'others.pdf', attachedById: 2 }),
      ],
    })
    const mine = await screen.findByTestId('attachment-row-8001')
    const others = screen.getByTestId('attachment-row-8002')
    expect(within(mine).getByRole('button', { name: 'mine.pdf 다운로드' })).toBeInTheDocument()
    expect(within(mine).getByRole('button', { name: 'mine.pdf 삭제' })).toBeInTheDocument()
    expect(within(others).getByRole('button', { name: 'others.pdf 다운로드' })).toBeInTheDocument()
    expect(within(others).queryByRole('button', { name: 'others.pdf 삭제' })).not.toBeInTheDocument()
  })
})

describe('첨부 뷰어 — 조건부 표시', () => {
  // WP-1457: 이슈 첨부 문서(HWP)도 드라이브처럼 서버 변환 PDF — 첨부 콘텐츠 경로 옆 /preview 를 부르고 원본은 받지 않는다.
  test('이슈 첨부 HWP 는 변환 경로(/preview?start=true)를 부르고 원본 콘텐츠는 받지 않는다', async () => {
    const requests = recordRequests()
    const name = '2026년 언택트 AI R&D 과제기획 전담반 회의 참석안내.hwp'
    const { user } = await openIssueDetail({
      detail: detail(1),
      attachments: [createAttachment({ fileId: 7302, originalName: name, mimeType: 'application/x-hwp' })],
      handlers: [http.get(`${ATT}/7302/preview`, () => HttpResponse.json({ status: 'CONVERTING' }, { status: 202 }))],
    })
    await user.click(await screen.findByRole('button', { name: `${name} 미리보기` }))
    expect(await screen.findByTestId('preview-converting')).toBeInTheDocument()
    await waitFor(() => expect(requests.of('GET', `${ATT}/7302/preview`).filter((r) => r.search.get('start') === 'true')).toHaveLength(1))
    expect(requests.count('GET', `${ATT}/7302/content`)).toBe(0)
  })

  test('드라이브 링크 원본이 휴지통이면 사용할 수 없음 안내만 보이고 다운로드는 없다', async () => {
    const { user } = await openIssueDetail({ detail: detail(0), driveLinks: [driveLink(602, { name: 'gone.txt', availability: 'TRASHED' })] })
    await user.click(await screen.findByRole('button', { name: 'gone.txt 미리보기' }))
    expect(await screen.findByTestId('preview-unavailable')).toBeInTheDocument()
    expect(screen.queryByTestId('preview-download')).not.toBeInTheDocument()
  })

  test('원본이 삭제된 드라이브 링크 행에는 다운로드 아이콘이 없다(활성 링크에만)', async () => {
    await openIssueDetail({ detail: detail(0), driveLinks: [driveLink(606, { name: 'deleted.txt', availability: 'DELETED' }), driveLink(607, { name: 'alive.txt' })] })
    expect(await screen.findByRole('button', { name: 'alive.txt 다운로드' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'deleted.txt 미리보기' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'deleted.txt 다운로드' })).not.toBeInTheDocument()
  })

  test('이슈 드라이브 링크의 요약이 403 이면 ✨(AI 요약) 버튼이 없다', async () => {
    const { user } = await openIssueDetail({
      detail: detail(0),
      driveLinks: [driveLink(603)],
      handlers: linkHandlers(603, { status: 403, body: { message: 'forbidden' } }),
    })
    await user.click(await screen.findByRole('button', { name: 'linked-603.txt 미리보기' }))
    await waitFor(() => expect(screen.getByTestId('preview-body')).toHaveTextContent('LINKED-BODY'))
    await act(() => new Promise((r) => setTimeout(r, 100)))
    expect(screen.queryByRole('button', { name: 'AI 요약' })).not.toBeInTheDocument()
  })

  test('이슈 드라이브 링크는 기본 접힘, ✨ 로 요약 패널을 열고(aria-pressed), ⋯ 에 「드라이브에서 열기」가 있다', async () => {
    const { user } = await openIssueDetail({
      detail: detail(0),
      driveLinks: [driveLink(604)],
      handlers: linkHandlers(604, { body: { summary: '링크 요약', status: 'DONE' } }),
    })
    await user.click(await screen.findByRole('button', { name: 'linked-604.txt 미리보기' }))
    await waitFor(() => expect(screen.getByTestId('preview-body')).toHaveTextContent('LINKED-BODY'))
    expect(screen.queryByTestId('viewer-side-panel')).not.toBeInTheDocument()
    const toggle = await screen.findByRole('button', { name: 'AI 요약' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    // AI 표식 — 요약 토글 아이콘은 sparkles + ai-accent 색(WP-1529).
    expect(toggle.querySelector('svg.lucide-sparkles')).toHaveClass('text-ai-accent')
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    // 켜짐이면 토글의 상태색(primary)을 상속 — AI 색은 빠진다(§7.2 상태 색 우선).
    expect(toggle.querySelector('svg.lucide-sparkles')).not.toHaveClass('text-ai-accent')
    expect(within(await screen.findByTestId('viewer-side-panel')).getByTestId('drive-summary-card')).toHaveTextContent('링크 요약')
    await user.click(screen.getByRole('button', { name: '더 보기' }))
    expect(await screen.findByRole('menuitem', { name: '드라이브에서 열기' })).toBeInTheDocument()
  })

  // WP-1262: 요약이 없는 이슈 HTML 첨부도 보안 점검이 있으면 ✨ 로 패널을 열고, 제목은 「보안 점검」이다.
  test('이슈 HTML 첨부는 점검 결과가 있으면 ✨ 로 보안 점검 패널을 연다', async () => {
    const { user } = await openIssueDetail({
      detail: detail(1),
      attachments: [createAttachment({ fileId: 7801, originalName: 'page.html', mimeType: 'text/html' })],
      handlers: [
        http.get(`${ATT}/7801/content`, () => new HttpResponse('<html><body><script>1</script></body></html>', { headers: { 'Content-Type': 'text/html' } })),
        http.get(`${ATT}/7801/security-check`, () =>
          HttpResponse.json({ status: 'DONE', risk: 'LOW', headline: '문제 없어 보여요', evidence: [], checkedAt: '2026-11-01T01:00:00Z', reason: null }),
        ),
      ],
    })
    await user.click(await screen.findByRole('button', { name: 'page.html 미리보기' }))
    const toggle = await screen.findByRole('button', { name: 'AI 요약' })
    await user.click(toggle)
    const panel = await screen.findByTestId('viewer-side-panel')
    expect(within(panel).getByRole('heading', { name: '보안 점검' })).toBeInTheDocument()
    expect(await within(panel).findByTestId('security-check-card')).toHaveTextContent('문제 없어 보여요')
    expect(within(panel).queryByTestId('drive-summary-card')).not.toBeInTheDocument()
  })

  // WP-1262: 업로드 직후 PENDING(스크립트 없는 HTML 도 잠깐 거친다)은 패널을 열지 않는다 — CHECKING 부터 연다.
  test('이슈 HTML 첨부의 점검이 PENDING 이면 ✨ 가 없다', async () => {
    let securityFetched = false
    const { user } = await openIssueDetail({
      detail: detail(1),
      attachments: [createAttachment({ fileId: 7802, originalName: 'plain.html', mimeType: 'text/html' })],
      handlers: [
        http.get(`${ATT}/7802/content`, () => new HttpResponse('<html><body><p>hi</p></body></html>', { headers: { 'Content-Type': 'text/html' } })),
        http.get(`${ATT}/7802/security-check`, () => {
          securityFetched = true
          return HttpResponse.json({ status: 'PENDING', risk: null, headline: null, evidence: [], checkedAt: null, reason: null })
        }),
      ],
    })
    await user.click(await screen.findByRole('button', { name: 'plain.html 미리보기' }))
    await waitFor(() => expect(securityFetched).toBe(true))
    await act(async () => {})
    expect(screen.queryByRole('button', { name: 'AI 요약' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('viewer-side-panel')).not.toBeInTheDocument()
  })

  test('업로드 첨부는 ✨ 없이 🔗(링크 복사)·☁ 를 보이고, ☁ → 루트 확정 → 드라이브에 저장 POST', async () => {
    const requests = recordRequests()
    const { user } = await openIssueDetail({
      detail: detail(1),
      attachments: [createAttachment({ fileId: 7701, originalName: 'up.txt', mimeType: 'text/plain' })],
      // 서버 이름과 상관없이 개인 공간은 사이드바처럼 「내 드라이브」로 보인다(spaceDisplayName).
      driveSpaces: [personalSpace({ id: 1, name: '홍길동' })],
      handlers: [
        http.get(`${ATT}/7701/content`, () => new HttpResponse('UP', { headers: { 'Content-Type': 'text/plain' } })),
        http.get('/api/v1/drive/spaces/1/items', () => HttpResponse.json({ folders: [], files: [] })),
        http.post('/api/v1/drive/spaces/1/import-attachment', () => HttpResponse.json(createFile({ id: 77, folderId: null }))),
      ],
    })
    await user.click(await screen.findByRole('button', { name: 'up.txt 미리보기' }))
    await waitFor(() => expect(screen.getByTestId('preview-body')).toHaveTextContent('UP'))
    expect(screen.queryByRole('button', { name: 'AI 요약' })).not.toBeInTheDocument()
    // WP-1234 링크 복사는 ⋯ 가 아니라 헤더 🔗 — 지금 주소(?preview 포함)를 복사해 같은 뷰어가 열린다.
    await user.click(within(screen.getByTestId('attachment-viewer')).getByRole('button', { name: /^링크 복사 / }))
    await waitFor(async () => expect(await navigator.clipboard.readText()).toBe(`${window.location.origin}${window.location.pathname}${window.location.search}`))
    expect(new URL(await navigator.clipboard.readText()).searchParams.get('preview')).toBe('file:7701')
    // WP-1525: ⋯ 에는 저장 항목이 없다 — 헤더 ☁ 와 겹치던 항목을 없앴다(다른 항목은 그대로라 ⋯ 는 보인다).
    await user.click(screen.getByRole('button', { name: '더 보기' }))
    expect(await screen.findByRole('menuitem', { name: /채팅·이슈로 보내기/ })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /드라이브에 저장|드라이브로 가져오기/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: '링크 복사' })).not.toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menuitem', { name: /채팅·이슈로 보내기/ })).not.toBeInTheDocument())
    // ☁ 는 아이콘만이라 다운로드처럼 툴팁으로 이름을 보인다(WP-1525).
    const cloud = screen.getByRole('button', { name: '드라이브에 저장' })
    await user.hover(cloud)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('드라이브에 저장')
    await user.click(cloud)
    const picker = await screen.findByTestId('folder-picker')
    await user.click(within(picker).getByTestId('folder-picker-confirm'))
    await waitFor(() => expect(requests.count('POST', '/api/v1/drive/spaces/1/import-attachment')).toBe(1))
    // 루트에 저장하면 위치는 공간 이름만.
    const toast = (await screen.findByText('드라이브에 저장했습니다')).closest('[data-sonner-toast]') as HTMLElement
    expect(toast).toHaveTextContent('내 드라이브')
    expect(toast).not.toHaveTextContent('내 드라이브 /')
  })

  // WP-1525 라이브 결함: 조회 중 ☁ 에 disabled 를 달면 브라우저가 포커스를 body 로 떨어뜨려, 폴더 창이 닫힐 때 ☁ 로 돌아오지 못했다.
  // 조회 중에는 aria-disabled 로만 막아 포커스가 ☁ 에 남고(다시 눌러도 조회가 겹치지 않음), 확정 뒤 포커스가 ☁ 로 돌아온다.
  // jsdom 은 disabled 가 된 요소에서 포커스를 빼지 않으므로, 조회 중 disabled 속성이 없다는 판정이 그 브라우저 동작을 대신 잡는다.
  test('키보드로 ☁ 를 누르면 조회 중에도 포커스가 ☁ 에 남고, 폴더를 확정하면 포커스가 ☁ 로 돌아온다', async () => {
    let spacesFetches = 0
    // 공간 조회 응답을 테스트가 풀어 줄 때까지 붙잡는다 — 조회 중(busy) 상태를 시간에 기대지 않고 확실히 관찰하려고.
    let releaseSpaces: () => void = () => {}
    const spacesGate = new Promise<void>((resolve) => {
      releaseSpaces = resolve
    })
    const { user } = await openIssueDetail({
      detail: detail(1),
      attachments: [createAttachment({ fileId: 7703, originalName: 'kb.txt', mimeType: 'text/plain' })],
      handlers: [
        http.get('/api/v1/drive/spaces', async () => {
          spacesFetches += 1
          await spacesGate
          return HttpResponse.json([personalSpace({ id: 1 })])
        }),
        http.get(`${ATT}/7703/content`, () => new HttpResponse('KB', { headers: { 'Content-Type': 'text/plain' } })),
        http.get('/api/v1/drive/spaces/1/items', () => HttpResponse.json({ folders: [], files: [] })),
        http.post('/api/v1/drive/spaces/1/import-attachment', () => HttpResponse.json(createFile({ id: 78, folderId: null }))),
      ],
    })
    await user.click(await screen.findByRole('button', { name: 'kb.txt 미리보기' }))
    await waitFor(() => expect(screen.getByTestId('preview-body')).toHaveTextContent('KB'))
    const cloud = within(screen.getByTestId('attachment-viewer')).getByRole('button', { name: '드라이브에 저장' })
    act(() => cloud.focus())
    await user.keyboard('{Enter}')
    // 조회 중 — 막혔음은 aria-disabled 로 알리되 disabled 가 아니어서 포커스가 그대로 ☁ 에 있다.
    await waitFor(() => expect(cloud).toHaveAttribute('aria-disabled', 'true'))
    expect(cloud).not.toBeDisabled()
    expect(document.activeElement).toBe(cloud)
    // 조회 중 다시 눌러도 무시된다 — 조회가 한 번뿐이고 폴더 창도 하나만 뜬다.
    await user.keyboard('{Enter}')
    await waitFor(() => expect(spacesFetches).toBe(1))
    releaseSpaces()
    const picker = await screen.findByTestId('folder-picker')
    expect(spacesFetches).toBe(1)
    expect(screen.getAllByTestId('folder-picker')).toHaveLength(1)
    expect(cloud).not.toHaveAttribute('aria-disabled')
    await user.click(within(picker).getByTestId('folder-picker-confirm'))
    await waitFor(() => expect(screen.queryByTestId('folder-picker')).not.toBeInTheDocument())
    // 폴더 창이 닫히면 Radix 가 포커스를 연 버튼(☁)으로 돌려준다.
    await waitFor(() => expect(document.activeElement).toBe(cloud))
    expect(await screen.findByText('드라이브에 저장했습니다')).toBeInTheDocument()
  })

  // WP-1525: 하위 폴더에 저장하면 토스트가 「공간 / 폴더 / 하위」 위치를 보이고, 「열기」는 저장 응답(folderId·id)의 드라이브 미리보기로 간다.
  test('하위 폴더에 저장하면 토스트에 위치가 보이고 「열기」로 드라이브 그 폴더의 미리보기로 간다', async () => {
    const posts: string[] = []
    const { user, location } = await openIssueDetail({
      detail: detail(1),
      attachments: [createAttachment({ fileId: 7702, originalName: 'deep.txt', mimeType: 'text/plain' })],
      driveSpaces: [personalSpace({ id: 1, name: '홍길동' })],
      handlers: [
        http.get(`${ATT}/7702/content`, () => new HttpResponse('DEEP', { headers: { 'Content-Type': 'text/plain' } })),
        http.get('/api/v1/drive/spaces/1/items', ({ request }) => {
          const folderId = new URL(request.url).searchParams.get('parentId')
          if (folderId == null) return HttpResponse.json({ folders: [createFolder({ id: 30, name: '문서' })], files: [] })
          if (folderId === '30') return HttpResponse.json({ folders: [createFolder({ id: 31, parentId: 30, name: '계약' })], files: [] })
          return HttpResponse.json({ folders: [], files: [] })
        }),
        http.post('/api/v1/drive/spaces/1/folders/:folderId/import-attachment', ({ params }) => {
          posts.push(String(params.folderId))
          return HttpResponse.json(createFile({ id: 555, folderId: 31, name: 'deep.txt' }))
        }),
        // 「열기」로 옮겨 간 드라이브 화면이 부르는 조회.
        http.get('/api/v1/drive/quota', () => HttpResponse.json({ usedBytes: 0, quotaBytes: 1024 * 1024 * 1024 })),
        http.get('/api/v1/drive/spaces/1', () => HttpResponse.json(personalSpace({ id: 1 }))),
        http.get('/api/v1/drive/folders/31/path', () => HttpResponse.json([{ id: 30, name: '문서' }, { id: 31, name: '계약' }])),
      ],
    })
    await user.click(await screen.findByRole('button', { name: 'deep.txt 미리보기' }))
    await waitFor(() => expect(screen.getByTestId('preview-body')).toHaveTextContent('DEEP'))
    await user.click(within(screen.getByTestId('attachment-viewer')).getByRole('button', { name: '드라이브에 저장' }))
    const picker = await screen.findByTestId('folder-picker')
    await user.click(await within(picker).findByRole('button', { name: '문서' }))
    await user.click(await within(picker).findByRole('button', { name: '계약' }))
    await waitFor(() => expect(within(picker).getByTestId('folder-picker-path')).toHaveTextContent('계약'))
    await user.click(within(picker).getByTestId('folder-picker-confirm'))
    await waitFor(() => expect(posts).toEqual(['31']))
    const toast = (await screen.findByText('드라이브에 저장했습니다')).closest('[data-sonner-toast]') as HTMLElement
    expect(toast).toHaveTextContent('내 드라이브 / 문서 / 계약')
    // 뷰어(모달)가 열린 동안 Radix 가 body 에 pointer-events:none 을 건다. 실제 브라우저에서는 index.css 의
    // [data-sonner-toast]{pointer-events:auto} 가 토스트만 다시 받게 하지만 jsdom 은 그 CSS 를 싣지 않아 클릭 이벤트를 직접 보낸다.
    fireEvent.click(within(toast).getByRole('button', { name: '열기' }))
    // 주소는 고른 폴더가 아니라 저장 응답(folderId 31·id 555)으로 만든다.
    await waitFor(() => expect(location()).toBe('/drive/spaces/1?folderId=31&preview=555'))
  })

  test('삭제된 첨부 딥링크(?preview=file:999)는 찾을 수 없음 안내를 보이고 뷰어는 열지 않는다', async () => {
    await openIssueDetail({
      path: `/projects/${KEY}/issues/1?preview=file:999`,
      detail: detail(1),
      attachments: [createAttachment({ fileId: 7901, originalName: 'live.txt', mimeType: 'text/plain' })],
    })
    expect(await screen.findByTestId('preview-not-found')).toBeInTheDocument()
    expect(screen.queryByTestId('attachment-viewer')).not.toBeInTheDocument()
  })

  test('드라이브 링크 조회가 403 이어도 없는 첨부 딥링크(?preview=drive:999)는 찾을 수 없음 안내로 끝난다', async () => {
    await openIssueDetail({
      path: `/projects/${KEY}/issues/1?preview=drive:999`,
      detail: detail(0),
      handlers: [http.get(`${BASE}/drive-links`, async () => {
        await delay(0)
        return HttpResponse.json({ message: 'forbidden' }, { status: 403 })
      })],
    })
    expect(await screen.findByTestId('preview-not-found')).toBeInTheDocument()
  })
})
