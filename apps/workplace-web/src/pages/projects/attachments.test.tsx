// 이슈 첨부(업로드·삭제·검증·스피너·버튼 이름)와 첨부 뷰어 묶음의 조건부 표시(WP-203·WP-277·WP-431·#782·#783) — 페이지 테스트(WP-980).
// 파일 선택 → POST·토스트·목록 갱신, 25MB·10개 한도 사전 검증, 업로드 중 스피너, 권한별 삭제 버튼, 미리보기 미지원(HWP)·휴지통·삭제된 링크,
// 요약 403·요약 패널·⋯ 메뉴, 드라이브로 가져오기 POST, 없는 첨부 딥링크 안내는 브라우저 없이 판정되므로
// e2e/pages/projects/attachments.spec.ts 에서 옮겼다. 그 spec 에는 다운로드·PDF·이미지 렌더·실시간 재조회(@platform),
// ‹ › 키보드 넘기기·포커스 복귀(@input), 드라이브 폴더로 여는 흐름(@flow)이 남는다.
import { act, screen, waitFor, within } from '@testing-library/react'
import { delay, http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { recordRequests } from '@/test/kits/projects/issueDetailStubs'
import { openIssueDetail } from '@/test/kits/projects/openIssueDetail'
import type { IssueAttachment } from '@/types/attachment'

import { createAttachment } from '../../../e2e/factories/attachment.factory'
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
  // WP-431: 변환 미리보기는 드라이브만 — 이슈 첨부 HWP 는 미지원 안내 그대로, /preview·콘텐츠도 받지 않는다.
  test('이슈 첨부 HWP 는 미리 볼 수 없다는 안내만 보이고 변환·콘텐츠를 요청하지 않는다', async () => {
    const requests = recordRequests()
    const name = '2026년 언택트 AI R&D 과제기획 전담반 회의 참석안내.hwp'
    const { user } = await openIssueDetail({
      detail: detail(1),
      attachments: [createAttachment({ fileId: 7302, originalName: name, mimeType: 'application/x-hwp' })],
    })
    await user.click(await screen.findByRole('button', { name: `${name} 미리보기` }))
    expect(await screen.findByTestId('preview-body')).toHaveTextContent('이 형식은 미리 볼 수 없어요')
    expect(screen.queryByTestId('preview-converting')).not.toBeInTheDocument()
    await act(() => new Promise((r) => setTimeout(r, 200)))
    expect(requests.of('ANY', /\/preview$/)).toHaveLength(0)
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
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expect(within(await screen.findByTestId('viewer-side-panel')).getByTestId('drive-summary-card')).toHaveTextContent('링크 요약')
    await user.click(screen.getByRole('button', { name: '더 보기' }))
    expect(await screen.findByRole('menuitem', { name: '드라이브에서 열기' })).toBeInTheDocument()
  })

  test('업로드 첨부는 ✨ 없이 🔗(링크 복사)·☁ 를 보이고, ☁ → 폴더 고르기 → 드라이브로 가져오기 POST', async () => {
    const requests = recordRequests()
    const { user } = await openIssueDetail({
      detail: detail(1),
      attachments: [createAttachment({ fileId: 7701, originalName: 'up.txt', mimeType: 'text/plain' })],
      driveSpaces: [{ id: 1, type: 'PERSONAL', name: '내 드라이브', ownerId: 1, role: 'OWNER', archived: false, createdAt: '2026-06-01T00:00:00Z' }],
      handlers: [
        http.get(`${ATT}/7701/content`, () => new HttpResponse('UP', { headers: { 'Content-Type': 'text/plain' } })),
        http.get('/api/v1/drive/spaces/1/items', () => HttpResponse.json({ folders: [], files: [] })),
        http.post('/api/v1/drive/spaces/1/import-attachment', () => HttpResponse.json({})),
      ],
    })
    await user.click(await screen.findByRole('button', { name: 'up.txt 미리보기' }))
    await waitFor(() => expect(screen.getByTestId('preview-body')).toHaveTextContent('UP'))
    expect(screen.queryByRole('button', { name: 'AI 요약' })).not.toBeInTheDocument()
    // WP-1234 링크 복사는 ⋯ 가 아니라 헤더 🔗 — 지금 주소(?preview 포함)를 복사해 같은 뷰어가 열린다.
    await user.click(within(screen.getByTestId('attachment-viewer')).getByRole('button', { name: /^링크 복사 / }))
    await waitFor(async () => expect(await navigator.clipboard.readText()).toBe(`${window.location.origin}${window.location.pathname}${window.location.search}`))
    expect(new URL(await navigator.clipboard.readText()).searchParams.get('preview')).toBe('file:7701')
    await user.click(screen.getByRole('button', { name: '더 보기' }))
    expect(await screen.findByRole('menuitem', { name: '드라이브로 가져오기' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: '링크 복사' })).not.toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menuitem', { name: '드라이브로 가져오기' })).not.toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: '드라이브로 가져오기' }))
    const picker = await screen.findByTestId('folder-picker')
    await user.click(within(picker).getByTestId('folder-picker-confirm'))
    await waitFor(() => expect(requests.count('POST', '/api/v1/drive/spaces/1/import-attachment')).toBe(1))
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
