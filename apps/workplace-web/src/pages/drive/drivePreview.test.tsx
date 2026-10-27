// @vitest-environment jsdom
// happy-dom(화면 테스트 기본, WP-1002)과 날짜 칸·글자 수 제한·포커스 이동 처리가 달라 이 파일은 jsdom 에서 돈다.
// 드라이브 파일 미리보기(통합 첨부 뷰어, DrivePage) — 화면 컴포넌트 테스트(WP-971, WP-984).
// 형식별 본문(마크다운·SVG·CSV·0 바이트 텍스트)·큰 파일 확인·로딩 스켈레톤·PDF 위장 차단·늦게 온 응답 무시·딥링크 없음,
// 요약 카드(DONE·마크다운 헤딩·진행 중·불가 사유·응답 전 숨김)·참조된 곳·패널 토글/기억·AI 꺼짐, 헤더 다운로드 위치·형식 크기,
// 재조회로 빠진 파일의 1건 묶음, 데스크톱 배치, 발표 아이콘은 브라우저 없이 판정되므로 다음 E2E 에서 옮겼다:
// drive-preview-formats.spec.ts · drive-preview-summary.spec.ts · drive-summary-reason.spec.ts · drive-converted-preview.spec.ts · attachment-viewer.spec.ts.
// 실제 PDF·미디어·iframe 렌더와 SheetJS 시트 파싱(jsdom 의 다른 realm ArrayBuffer 를 SheetJS 가 읽지 못함)(@platform), 확대·정렬·패널 겹침(@layout), 키보드 넘김·포커스(@input)는 각 E2E 가 지킨다.
import { act, screen, waitFor, within } from '@testing-library/react'
import { delay, http, HttpResponse, type RequestHandler } from 'msw'
import { describe, expect, test } from 'vitest'

import { API, driveBaseHandlers, fileSideHandlers, renderDrivePage } from '@/test/kits/drive/testkit-b6'
import { PAGE_LOAD_TIMEOUT } from '@/test/renderPage'
import { testAuthValue } from '@/test/renderWithProviders'
import type { DriveFile } from '@/types/drive'

import { createFile } from '../../../e2e/factories/drive.factory'

const SPACE_ID = 1
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/** 미리보기 파일 하나 — 목록 항목·콘텐츠 응답·부속 조회(요약·참조된 곳·썸네일). */
type PreviewFile = {
  file: DriveFile
  /** 콘텐츠 응답 본문 — 없으면 콘텐츠 핸들러를 두지 않는다(받으면 안 되는 경우는 counter 로 센다). */
  body?: string | Uint8Array
  summary?: Record<string, unknown> | number
  backlinks?: Record<string, unknown>[]
}

const textFile = (id: number, name: string, mimeType = 'text/plain', extra: Partial<DriveFile> = {}) =>
  createFile({ id, fileId: id + 1000, name, mimeType, category: 'TEXT', ...extra })

/** 공간 화면을 띄운다 — 파일마다 콘텐츠·요약·참조된 곳을 준다. contentCalls 는 파일 id 별 콘텐츠 요청 수. */
function renderPreview(files: PreviewFile[], { search = '', handlers = [] as RequestHandler[], auth = {} } = {}) {
  const contentCalls: Record<number, number> = {}
  const view = renderDrivePage(SPACE_ID, {
    search,
    auth,
    handlers: [
      ...handlers,
      ...files.flatMap(({ file, body, summary, backlinks }) => [
        ...(body != null
          ? [
              http.get(`${API}/files/${file.id}/content`, () => {
                contentCalls[file.id] = (contentCalls[file.id] ?? 0) + 1
                return new HttpResponse(body, { headers: { 'Content-Type': file.mimeType } })
              }),
            ]
          : []),
        ...fileSideHandlers(file.id, { summary, backlinks }),
      ]),
      ...driveBaseHandlers({ items: { folders: [], files: files.map((f) => f.file) } }),
    ],
  })
  return { ...view, contentCalls }
}

/** 목록에서 파일명을 눌러 뷰어를 열고 본문 영역을 돌려준다. */
async function openPreview(user: ReturnType<typeof renderDrivePage>['user'], name: string) {
  await user.click(await screen.findByRole('button', { name }, { timeout: PAGE_LOAD_TIMEOUT }))
  return screen.findByTestId('preview-body')
}

describe('형식별 본문', () => {
  // 마크다운은 서식(h1·strong)으로 그린다.
  test('Markdown 은 서식 렌더된다', async () => {
    const { user } = renderPreview([{ file: textFile(60, 'readme.md', 'text/markdown'), body: '# 제목\n\n**굵게**' }])
    const body = await openPreview(user, 'readme.md')
    const md = await within(body).findByTestId('markdown-content')
    expect(within(md).getByRole('heading', { name: '제목' })).toBeInTheDocument()
    expect(within(md).getByText('굵게').tagName).toBe('STRONG')
  })

  // SVG 는 이미지(img)로 그린다(소스 텍스트 아님).
  test('SVG 는 이미지로 렌더된다', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="blue"/></svg>'
    const { user } = renderPreview([{ file: createFile({ id: 61, name: 'diagram.svg', mimeType: 'image/svg+xml', category: 'IMAGE' }), body: svg }])
    const body = await openPreview(user, 'diagram.svg')
    await waitFor(() => expect(body.querySelector('img')).not.toBeNull())
  })

  // CSV 는 표(머리글 a,b / 셀 1,2)로 그린다.
  test('CSV 는 표로 렌더된다', async () => {
    const { user } = renderPreview([{ file: createFile({ id: 62, name: 'data.csv', mimeType: 'text/csv', category: 'DATA' }), body: 'a,b\n1,2' }])
    const body = await openPreview(user, 'data.csv')
    const table = await within(body).findByTestId('csv-table')
    expect(within(table).getByRole('columnheader', { name: 'a' })).toBeInTheDocument()
    expect(within(table).getByRole('columnheader', { name: 'b' })).toBeInTheDocument()
    expect(within(table).getByRole('cell', { name: '1' })).toBeInTheDocument()
    expect(within(table).getByRole('cell', { name: '2' })).toBeInTheDocument()
  })

  // WP-203 후속: 10MB 를 넘는 시트는 받기 전에 크기를 보이며 볼지 묻는다 — 묻는 동안 콘텐츠를 받지 않는다.
  test('10MB 를 넘는 XLSX 는 받지 않고 크기를 보이며 묻는다', async () => {
    const { user, contentCalls } = renderPreview([
      { file: createFile({ id: 91, name: 'big.xlsx', mimeType: XLSX_MIME, category: 'DATA', sizeBytes: 12 * 1024 * 1024 }), body: new Uint8Array(16) },
    ])
    const body = await openPreview(user, 'big.xlsx')
    expect(await within(body).findByTestId('preview-size-confirm')).toHaveTextContent('12.0 MB')
    expect(within(body).queryByTestId('xlsx-table')).not.toBeInTheDocument()
    expect(contentCalls[91] ?? 0).toBe(0)
  })

  // 0 바이트 텍스트는 오류가 아니라 빈 미리보기다(로딩도 끝난다).
  test('0 바이트 텍스트는 오류가 아니라 빈 미리보기', async () => {
    const { user, contentCalls } = renderPreview([{ file: textFile(71, 'empty.txt', 'text/plain', { sizeBytes: 0 }), body: '' }])
    const body = await openPreview(user, 'empty.txt')
    await waitFor(() => expect(contentCalls[71]).toBe(1))
    await waitFor(() => expect(within(body).queryByTestId('preview-loading')).not.toBeInTheDocument())
    expect(body).not.toHaveTextContent('미리보기를 불러오지 못했습니다.')
  })

  // WP-203: PDF 로 위장한 HTML 은 그리지 않고 오류 화면이다(pdf-document 없음).
  test('PDF 로 위장한 HTML 은 렌더하지 않는다', async () => {
    const { user } = renderPreview([{ file: createFile({ id: 73, name: 'fake.pdf', mimeType: 'application/pdf', category: 'PDF', sizeBytes: 20 }), body: '<html><script>1</script></html>' }])
    const body = await openPreview(user, 'fake.pdf')
    await waitFor(() => expect(body).toHaveTextContent('미리보기를 불러오지 못했습니다.'))
    expect(screen.queryByTestId('pdf-document')).not.toBeInTheDocument()
  })

  // #775: 콘텐츠가 늦게 오는 동안 빈 화면 대신 스켈레톤, 도착하면 스켈레톤이 빠지고 본문.
  test('콘텐츠 로딩 중에는 스켈레톤이 보인다', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const file = textFile(63, 'slow.md', 'text/markdown')
    const { user } = renderPreview([{ file }], {
      handlers: [
        http.get(`${API}/files/63/content`, async () => {
          await gate
          return new HttpResponse('# 늦은 본문', { headers: { 'Content-Type': 'text/markdown' } })
        }),
      ],
    })
    const body = await openPreview(user, 'slow.md')
    expect(await within(body).findByTestId('preview-loading')).toBeInTheDocument()
    expect(within(body).queryByTestId('markdown-content')).not.toBeInTheDocument()
    release()
    expect(await within(body).findByTestId('markdown-content')).toBeInTheDocument()
    expect(within(body).queryByTestId('preview-loading')).not.toBeInTheDocument()
  })

  // WP-431: 발표 자료(pptx·대소문자/파라미터 섞인 ppt mime)는 목록에서 발표 아이콘이다.
  test('PPTX·PPT 는 목록에서 발표 아이콘으로 보인다', async () => {
    renderPreview([
      { file: createFile({ id: 84, name: '분기 보고.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', category: 'DOCUMENT' }) },
      { file: createFile({ id: 88, name: '옛 발표.ppt', mimeType: 'Application/VND.MS-PowerPoint; charset=binary', category: 'DOCUMENT' }) },
    ])
    for (const id of [84, 88]) {
      const row = await screen.findByTestId(`drive-row-file-${id}`, {}, { timeout: PAGE_LOAD_TIMEOUT })
      expect(row.querySelector('svg.lucide-presentation')).not.toBeNull()
    }
  })
})

describe('묶음·딥링크', () => {
  // 넘긴 뒤 늦게 도착한 이전 파일 응답이 현재 파일 자리에 그려지지 않는다.
  test('늦게 온 이전 파일 응답이 현재 파일 자리에 그려지지 않는다', async () => {
    const files = [textFile(80, 'a.txt'), textFile(81, 'b.txt'), textFile(82, 'c.txt')]
    const { user } = renderPreview(
      [{ file: files[0], body: 'A' }, { file: files[1] }, { file: files[2], body: 'C' }],
      {
        handlers: [
          http.get(`${API}/files/81/content`, async () => {
            await delay(300)
            return new HttpResponse('B', { headers: { 'Content-Type': 'text/plain' } })
          }),
        ],
      },
    )
    const body = await openPreview(user, 'a.txt')
    await waitFor(() => expect(body).toHaveTextContent('A'))
    await user.click(screen.getByRole('button', { name: '다음 파일' }))
    await user.click(await screen.findByRole('button', { name: '다음 파일' }))
    await waitFor(() => expect(screen.getByTestId('preview-body')).toHaveTextContent('C'))
    // 지연 응답(300ms)이 도착할 시간을 실제로 흘려보내야 「그려지지 않음」을 볼 수 있다.
    await act(() => delay(400))
    expect(screen.getByTestId('preview-body')).not.toHaveTextContent('B')
  })

  // 목록에 없는 파일 딥링크(?preview=999)는 찾을 수 없음 안내.
  test('딥링크로 목록에 없는 파일을 열면 찾을 수 없음 안내', async () => {
    renderPreview([{ file: textFile(80, 'a.txt'), body: 'A' }], { search: '?preview=999' })
    expect(await screen.findByTestId('preview-not-found', {}, { timeout: PAGE_LOAD_TIMEOUT })).toBeInTheDocument()
  })

  // 열린 파일이 재조회(다른 사람의 삭제 등)로 목록에서 빠져도 뷰어는 그 파일을 1건 묶음으로 유지한다(순번·‹ › 없음, 없음 안내 아님).
  test('열린 파일이 재조회로 목록에서 빠지면 1건 묶음으로 유지한다', async () => {
    const files = [textFile(80, 'a.txt'), textFile(81, 'b.txt')]
    let listed = files
    const { user, queryClient } = renderPreview([{ file: files[0], body: 'A' }, { file: files[1], body: 'B' }], {
      handlers: [http.get(`${API}/spaces/${SPACE_ID}/items`, () => HttpResponse.json({ folders: [], files: listed }))],
    })
    await openPreview(user, 'a.txt')
    await waitFor(() => expect(screen.getByTestId('preview-meta')).toHaveTextContent('1 / 2'))
    listed = files.slice(1)
    // 실시간 변경 알림이 하는 일(목록 쿼리 무효화)을 직접 한다 — SSE 전달 자체는 E2E(@platform) 몫.
    await act(() => queryClient.invalidateQueries({ queryKey: ['drive', 'items'] }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'a.txt' })).not.toBeInTheDocument())
    expect(screen.getByTestId('preview-meta')).not.toHaveTextContent('/ 2')
    expect(screen.getByTestId('preview-body')).toHaveTextContent('A')
    expect(screen.queryByRole('button', { name: '다음 파일' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '이전 파일' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('preview-not-found')).not.toBeInTheDocument()
  })

  // 데스크톱(마우스)은 모바일 하단·상단 바 없이 헤더 다운로드·확대 툴바를 쓴다.
  test('데스크톱은 모바일 바 없이 헤더·확대 툴바를 쓴다', async () => {
    const { user } = renderPreview([{ file: createFile({ id: 90, name: 'desk.png', mimeType: 'image/png', category: 'IMAGE' }), body: new Uint8Array([137, 80, 78, 71]) }])
    await openPreview(user, 'desk.png')
    expect(screen.queryByTestId('viewer-action-bar')).not.toBeInTheDocument()
    expect(screen.queryByTestId('viewer-top-bar')).not.toBeInTheDocument()
    expect(await screen.findByRole('button', { name: '확대' })).toBeInTheDocument()
    expect(screen.getByTestId('preview-download')).toBeInTheDocument()
  })
})

describe('요약·참조 패널', () => {
  // Office 문서(미리보기 본문 없이 카드만 보려는 형식).
  const docx = createFile({ id: 1, fileId: 10, name: '문서.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', category: 'WORD', sizeBytes: 1024 })
  // 본문은 받지 못한 것으로 둔다(E2E 와 같이 오류 화면) — 카드만 본다. 가짜 바이트를 주면 mammoth 가 jsdom 의 다른 realm ArrayBuffer 를 읽지 못해 던진다.
  const noContent = http.get(`${API}/files/1/content`, () => new HttpResponse(null, { status: 404 }))

  // #526·WP-277: 요약 DONE 은 사이드 패널에 펼친 카드로 보인다.
  // #633: 요약 마크다운 헤딩은 원시 「#」 대신 heading 으로.
  test('요약 DONE 은 패널 카드로 펼쳐 보이고 마크다운 헤딩을 파싱한다', async () => {
    const { user } = renderPreview([{ file: docx, summary: { summary: '# 파일 요약: 문서.docx\n\n이 문서의 핵심 요약입니다.', status: 'DONE' } }], { handlers: [noContent] })
    await openPreview(user, '문서.docx')
    const card = await within(await screen.findByTestId('viewer-side-panel')).findByTestId('drive-summary-card')
    await waitFor(() => expect(card).toHaveTextContent('핵심 요약'))
    expect(within(card).getByRole('heading', { name: '파일 요약: 문서.docx' })).toBeInTheDocument()
    expect(card).not.toHaveTextContent('# 파일 요약')
  })

  // 추출 진행 중이면 패널이 기본 펼침이라 클릭 없이 스켈레톤.
  test('추출 진행 중이면 요약 스켈레톤이 보인다', async () => {
    const { user } = renderPreview([{ file: docx, summary: { summary: null, status: 'EXTRACTING' } }], { handlers: [noContent] })
    await openPreview(user, '문서.docx')
    expect(await screen.findByTestId('drive-summary-loading')).toBeInTheDocument()
  })

  // #735: 요약 불가(SKIPPED)는 클릭 없이 카드가 펼쳐져 서버 사유를 평문 그대로 보인다.
  test('SKIPPED 사유가 클릭 없이 평문으로 보인다', async () => {
    const zip = createFile({ id: 2, name: '압축.zip', mimeType: 'application/zip', category: 'OTHER', sizeBytes: 1024 })
    const { user } = renderPreview([{ file: zip, body: new Uint8Array([80, 75]), summary: { summary: null, status: 'SKIPPED', reason: '이 형식은 텍스트 추출을 지원하지 않습니다.' } }])
    await openPreview(user, '압축.zip')
    expect(await screen.findByTestId('drive-summary-card')).toBeInTheDocument()
    expect(await screen.findByTestId('drive-summary-reason')).toHaveTextContent('이 형식은 텍스트 추출을 지원하지 않습니다.')
  })

  // WP-274: 다운로드는 본문보다 앞(헤더)에 있는 아이콘 버튼(글자 없음·primary 아님)이고, 헤더 보조 줄은 크기다. 누르면 /download 를 받는다.
  test('헤더 다운로드는 본문 앞의 아이콘 버튼이고 크기를 보이며, 누르면 내려받는다', async () => {
    let downloads = 0
    const { user } = renderPreview([{ file: docx, summary: { summary: null, status: 'SKIPPED' } }], {
      handlers: [
        noContent,
        http.get(`${API}/files/1/download`, () => {
          downloads++
          return new HttpResponse('x', { headers: { 'Content-Type': 'application/octet-stream' } })
        }),
      ],
    })
    const body = await openPreview(user, '문서.docx')
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByTestId('preview-meta')).toHaveTextContent('1.0 KB')
    const download = screen.getByTestId('preview-download')
    expect(download).toHaveAccessibleName('다운로드')
    expect(download).toHaveTextContent('')
    expect(download).not.toHaveClass('bg-primary')
    expect(download.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(dialog).getAllByRole('button', { name: '닫기' })).toHaveLength(1)
    await user.click(download)
    await waitFor(() => expect(downloads).toBe(1))
  })

  // 드라이브에서 열면 요약 패널이 기본 펼침이고 참조된 곳(이슈)이 보인다. ✨(AI 요약)로 패널을 접고, 다시 열어도 접힌 상태를 기억한다.
  test('요약 패널은 기본 펼침에 참조된 곳을 보이고, 접은 상태를 다시 열 때도 기억한다', async () => {
    const md = textFile(90, 'doc.md', 'text/markdown', { sizeBytes: 5 })
    const { user } = renderPreview([
      {
        file: md,
        body: '# hi',
        summary: { summary: '요약 본문', status: 'DONE' },
        backlinks: [{ sourceType: 'ISSUE', sourceId: 3, label: 'WP-3 검토', deepLink: '/projects/WP/issues/3' }],
      },
    ])
    await openPreview(user, 'doc.md')
    const panel = await screen.findByTestId('viewer-side-panel')
    await waitFor(() => expect(within(panel).getByTestId('drive-summary-card')).toHaveTextContent('요약 본문'))
    expect(await within(panel).findByTestId('file-backlink-ISSUE-3')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'AI 요약' }))
    expect(screen.queryByTestId('viewer-side-panel')).not.toBeInTheDocument()

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByTestId('preview-body')).not.toBeInTheDocument())
    await openPreview(user, 'doc.md')
    expect(screen.queryByTestId('viewer-side-panel')).not.toBeInTheDocument()
  })

  // AI 가 꺼진 사용자도 참조된 곳은 보이지만 ✨ 버튼·요약 패널은 없다.
  test('AI 가 꺼져 있으면 참조된 곳만 보이고 ✨·패널이 없다', async () => {
    const { user } = renderPreview(
      [{ file: textFile(92, 'noai.md', 'text/markdown'), body: '# hi', backlinks: [{ sourceType: 'ISSUE', sourceId: 3, label: 'WP-3 검토', deepLink: '/projects/WP/issues/3' }] }],
      { auth: { user: { ...testAuthValue.user!, aiAvailable: false } } },
    )
    await openPreview(user, 'noai.md')
    expect(await screen.findByTestId('file-backlink-ISSUE-3')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'AI 요약' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('viewer-side-panel')).not.toBeInTheDocument()
  })

  // 요약 응답 전에는 ✨·패널을 띄우지 않고(403 이면 깜빡임), 성공하면 둘 다 보인다.
  test('요약 응답 전에는 ✨·패널이 없고 응답이 성공하면 보인다', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const { user } = renderPreview([{ file: textFile(94, 'slow.md', 'text/markdown'), body: '# hi' }], {
      handlers: [
        http.get(`${API}/files/94/summary`, async () => {
          await gate
          return HttpResponse.json({ summary: '늦은 요약', status: 'DONE' })
        }),
      ],
    })
    const body = await openPreview(user, 'slow.md')
    await waitFor(() => expect(body).toHaveTextContent('hi'))
    expect(screen.queryByRole('button', { name: 'AI 요약' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('viewer-side-panel')).not.toBeInTheDocument()
    release()
    const panel = await screen.findByTestId('viewer-side-panel')
    await waitFor(() => expect(within(panel).getByTestId('drive-summary-card')).toHaveTextContent('늦은 요약'))
    expect(screen.getByRole('button', { name: 'AI 요약' })).toBeInTheDocument()
  })
})
