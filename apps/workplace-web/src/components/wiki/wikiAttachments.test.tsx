import { docToMarkdown, markdownToDoc } from '@smart-workplace/wiki-editor-schema'
import { act, screen, waitFor, within } from '@testing-library/react'
import { type Editor, EditorContent, useEditor } from '@tiptap/react'
import { http, HttpResponse } from 'msw'
import { useEffect, useRef } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'

import { renderScreen } from '@/test/renderScreen'

import { useWikiAttachmentViewer } from './useWikiAttachmentViewer'
import { useWikiImageUpload } from './useWikiImageUpload'
import { WikiLinkActionSheet } from './WikiLinkActionSheet'
import { wikiRenderExtensions } from './wikiRenderExtensions'
import { WikiUploadPlaceholder } from './wikiUploadPlaceholder'

// 노트 본문 파일 첨부(WP-1545) 화면 판정 — 편집기와 같은 확장·업로드 훅·뷰어 훅을 엮은 가장 작은 본문으로 띄운다
// (WikiEditor 전체는 동기화 서버·멘션·AI 를 끌고 와 무겁다). 칩 렌더·클릭 → 뷰어(blob 받기), 붙여넣기·드롭 → 업로드 API →
// 본문 마크다운의 [이름](url), 크기 초과 → 요청 없는 토스트를 본다. 슬래시 「파일」 항목은 wikiSlashSuggestion.test.ts 가 본다.

const PAGE_ID = 5
const UPLOAD_PATH = `/api/v1/wiki/pages/${PAGE_ID}/attachments`
const LOG_URL = `/api/v1/wiki/pages/${PAGE_ID}/attachments/9/content`

let editorRef: Editor | null = null
// 드롭 처리기 — jsdom 은 좌표 → 문서 위치 판정이 없어 ProseMirror 가 drop 이벤트를 처리기까지 넘기지 않는다. 같은 처리기를 직접 부른다.
let dropRef: ReturnType<typeof useWikiImageUpload>['handleDrop'] | null = null

// 앞 테스트의 편집기를 보지 않게 테스트마다 비운다(렌더 뒤 effect 가 다시 채운다).
beforeEach(() => {
  editorRef = null
  dropRef = null
})

/** 편집기 본문만 — 업로드 훅(붙여넣기·드롭)과 첨부 뷰어 훅을 WikiEditor 와 같은 방식으로 엮는다. */
function Body({ markdown, editable = true }: { markdown: string; editable?: boolean }) {
  const canEditRef = useRef(editable)
  const { handlePaste, handleDrop } = useWikiImageUpload(PAGE_ID, canEditRef)
  const attachments = useWikiAttachmentViewer()
  const editor = useEditor(
    {
      extensions: [...wikiRenderExtensions(), WikiUploadPlaceholder],
      content: markdownToDoc(markdown).toJSON(),
      editable,
      editorProps: { handlePaste, handleDrop },
    },
    [],
  )
  // 테스트가 문서·드롭 처리기를 직접 보도록 렌더 뒤에 넘겨 둔다.
  useEffect(() => {
    editorRef = editor
    dropRef = handleDrop
  })
  return (
    <>
      <EditorContent editor={editor} onClick={attachments.onClick} />
      {attachments.viewer}
    </>
  )
}

/** 본문 마크다운 — 칩은 데코레이션이라 문서에는 링크만 있다. */
const markdownNow = () => docToMarkdown(editorRef!.state.doc).trim()

/** 업로드 응답 — 서버 WikiAttachmentResponse 모양. 요청 횟수를 센다. */
function uploadHandler(res: { fileId: number; originalName: string; mimeType: string; sizeBytes: number; image: boolean }) {
  const calls: string[] = []
  const handler = http.post(UPLOAD_PATH, async ({ request }) => {
    const file = (await request.formData()).get('file') as File
    calls.push(file.name)
    return HttpResponse.json({ ...res, url: `/api/v1/wiki/pages/${PAGE_ID}/attachments/${res.fileId}/content` }, { status: 201 })
  })
  return { handler, calls }
}

/** 붙여넣기 — 클립보드에 파일(과 글자)을 담은 paste 이벤트. */
function pasteFiles(files: File[], text = '') {
  const dom = editorRef!.view.dom
  const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
  Object.defineProperty(event, 'clipboardData', {
    value: { files, items: [], getData: (t: string) => (t === 'text/plain' ? text : '') },
  })
  act(() => {
    dom.dispatchEvent(event)
  })
}

describe('본문 첨부 칩', () => {
  it('첨부 링크는 이름이 보이는 칩이고, 일반 링크는 그대로 링크다', async () => {
    renderScreen(<Body markdown={`로그 [app.log](${LOG_URL}) 와 [바깥](https://example.com/x)`} editable={false} />)
    const chip = await screen.findByTestId('wiki-attachment-chip')
    expect(chip).toHaveTextContent('app.log')
    expect(chip).toHaveAccessibleName('파일 app.log')
    expect(screen.getByRole('link', { name: '바깥' })).toHaveAttribute('href', 'https://example.com/x')
  })

  it('칩을 누르면 첨부 뷰어가 열리고 로그인 경로를 blob 으로 받는다', async () => {
    const fetched: string[] = []
    const { user } = renderScreen(<Body markdown={`[app.log](${LOG_URL})`} editable={false} />, {
      handlers: [
        http.get(LOG_URL, ({ request }) => {
          fetched.push(new URL(request.url).pathname)
          return new HttpResponse('ERROR boom', { headers: { 'Content-Type': 'text/plain' } })
        }),
      ],
    })
    await user.click(await screen.findByTestId('wiki-attachment-chip'))
    const dialog = await screen.findByRole('dialog')
    await waitFor(() => expect(fetched).toEqual([LOG_URL]))
    expect(await within(dialog).findByText(/ERROR boom/)).toBeInTheDocument()
  })
})

/** 터치 편집의 링크 시트 — WikiEditor 처럼 시트의 「미리 보기」를 뷰어 훅의 openLink 에 잇는다. */
function SheetWithViewer({ href }: { href: string }) {
  const attachments = useWikiAttachmentViewer()
  return (
    <>
      <WikiLinkActionSheet
        open
        href={href}
        canModify
        onClose={() => {}}
        onEdit={() => {}}
        onUnlink={() => {}}
        onPreview={() => attachments.openLink(href, 'app.log')}
      />
      {attachments.viewer}
    </>
  )
}

describe('터치 편집 — 링크 시트에서 첨부 미리 보기', () => {
  it('첨부 링크면 「링크 열기」 대신 「미리 보기」가 있고, 누르면 뷰어가 blob 으로 받는다', async () => {
    const fetched: string[] = []
    const { user } = renderScreen(<SheetWithViewer href={LOG_URL} />, {
      handlers: [
        http.get(LOG_URL, ({ request }) => {
          fetched.push(new URL(request.url).pathname)
          return new HttpResponse('ERROR boom', { headers: { 'Content-Type': 'text/plain' } })
        }),
      ],
    })
    expect(screen.queryByTestId('wiki-link-sheet-open')).not.toBeInTheDocument()
    expect(screen.getByTestId('wiki-link-sheet-edit')).toBeInTheDocument()
    await user.click(screen.getByTestId('wiki-link-sheet-preview'))
    await waitFor(() => expect(fetched).toEqual([LOG_URL]))
    expect(await screen.findByText(/ERROR boom/)).toBeInTheDocument()
  })

  it('일반 링크면 「미리 보기」 없이 「링크 열기」다', () => {
    renderScreen(<SheetWithViewer href="https://example.com/x" />)
    expect(screen.queryByTestId('wiki-link-sheet-preview')).not.toBeInTheDocument()
    expect(screen.getByTestId('wiki-link-sheet-open')).toHaveAttribute('href', 'https://example.com/x')
  })
})

describe('파일 업로드', () => {
  it('PDF 를 붙여 넣으면 업로드 API 를 부르고 본문에 [이름](url) 링크를 넣는다', async () => {
    const up = uploadHandler({ fileId: 21, originalName: 'report.pdf', mimeType: 'application/pdf', sizeBytes: 3, image: false })
    renderScreen(<Body markdown="" />, { handlers: [up.handler] })
    await waitFor(() => expect(editorRef).not.toBeNull())
    // Finder 복사처럼 text/plain 에 파일 이름이 함께 실려도 이름을 글자로 한 번 더 넣지 않는다.
    pasteFiles([new File(['%PDF'], 'report.pdf', { type: 'application/pdf' })], 'report.pdf')
    await waitFor(() => expect(markdownNow()).toBe(`[report.pdf](/api/v1/wiki/pages/${PAGE_ID}/attachments/21/content)`))
    expect(up.calls).toEqual(['report.pdf'])
    // 화면에는 칩으로 보이고, 올린 응답의 크기도 함께 보인다.
    expect(await screen.findByTestId('wiki-attachment-chip')).toHaveTextContent('report.pdf3 B')
  })

  it('PDF 를 끌어다 놓아도 같은 링크가 들어간다', async () => {
    const up = uploadHandler({ fileId: 22, originalName: 'dropped.pdf', mimeType: 'application/pdf', sizeBytes: 4, image: false })
    renderScreen(<Body markdown="" />, { handlers: [up.handler] })
    await waitFor(() => expect(editorRef).not.toBeNull())
    // 본문 밖 좌표 — 드롭 자리를 못 찾으면 훅이 현재 커서에 넣는다.
    const event = { dataTransfer: { files: [new File(['%PDF'], 'dropped.pdf', { type: 'application/pdf' })] }, clientX: -9999, clientY: -9999, preventDefault() {} }
    let handled = false
    act(() => {
      handled = dropRef!(editorRef!.view, event as unknown as DragEvent, null, false)
    })
    expect(handled).toBe(true)
    await waitFor(() => expect(markdownNow()).toBe(`[dropped.pdf](/api/v1/wiki/pages/${PAGE_ID}/attachments/22/content)`))
    expect(up.calls).toEqual(['dropped.pdf'])
  })

  it('4종 밖의 이미지(TIFF)는 파일로 올리고 그렇다고 알린다', async () => {
    const up = uploadHandler({ fileId: 25, originalName: 'scan.tiff', mimeType: 'image/tiff', sizeBytes: 4, image: false })
    renderScreen(<Body markdown="" />, { handlers: [up.handler] })
    await waitFor(() => expect(editorRef).not.toBeNull())
    pasteFiles([new File(['II*'], 'scan.tiff', { type: 'image/tiff' })])
    expect(await screen.findByText('PNG·JPEG·GIF·WebP 가 아니라 파일로 첨부했습니다.')).toBeInTheDocument()
    await waitFor(() => expect(markdownNow()).toBe(`[scan.tiff](/api/v1/wiki/pages/${PAGE_ID}/attachments/25/content)`))
    expect(up.calls).toEqual(['scan.tiff'])
  })

  it('폴더를 끌어다 놓으면 요청 없이 한 번 알린다', async () => {
    const up = uploadHandler({ fileId: 26, originalName: 'photos', mimeType: 'application/octet-stream', sizeBytes: 0, image: false })
    renderScreen(<Body markdown="" />, { handlers: [up.handler] })
    await waitFor(() => expect(editorRef).not.toBeNull())
    const folder = new File([], 'photos', { type: '' })
    const event = {
      dataTransfer: { files: [folder], items: [{ kind: 'file', webkitGetAsEntry: () => ({ isDirectory: true }) }] },
      clientX: -9999,
      clientY: -9999,
      preventDefault() {},
    }
    let handled = false
    act(() => {
      handled = dropRef!(editorRef!.view, event as unknown as DragEvent, null, false)
    })
    expect(handled).toBe(true)
    expect(await screen.findByText('폴더는 첨부할 수 없습니다.')).toBeInTheDocument()
    expect(up.calls).toEqual([])
    expect(markdownNow()).toBe('')
  })

  it('서버가 이미지라고 하면 링크가 아니라 그림으로 넣는다', async () => {
    const up = uploadHandler({ fileId: 23, originalName: 'a.png', mimeType: 'image/png', sizeBytes: 16, image: true })
    renderScreen(<Body markdown="" />, { handlers: [up.handler] })
    await waitFor(() => expect(editorRef).not.toBeNull())
    pasteFiles([new File(['png'], 'a.png', { type: 'image/png' })])
    await waitFor(() => expect(markdownNow()).toBe(`![a.png](/api/v1/wiki/pages/${PAGE_ID}/attachments/23/content)`))
  })

  it('25MB 를 넘는 파일은 요청 없이 서버와 같은 문구로 알린다', async () => {
    const up = uploadHandler({ fileId: 24, originalName: 'big.zip', mimeType: 'application/zip', sizeBytes: 1, image: false })
    renderScreen(<Body markdown="" />, { handlers: [up.handler] })
    await waitFor(() => expect(editorRef).not.toBeNull())
    const big = new File(['x'], 'big.zip', { type: 'application/zip' })
    Object.defineProperty(big, 'size', { value: 25 * 1024 * 1024 + 1 })
    pasteFiles([big])
    expect(await screen.findByText('첨부 파일은 최대 25MB까지 업로드할 수 있습니다: big.zip')).toBeInTheDocument()
    expect(up.calls).toEqual([])
    expect(markdownNow()).toBe('')
  })

  it('업로드가 실패하면 서버 사유를 토스트로 보이고 본문에 남기지 않는다', async () => {
    renderScreen(<Body markdown="" />, {
      handlers: [http.post(UPLOAD_PATH, () => HttpResponse.json({ message: '페이지당 첨부 한도 초과' }, { status: 409 }))],
    })
    await waitFor(() => expect(editorRef).not.toBeNull())
    pasteFiles([new File(['x'], 'a.log', { type: 'text/plain' })])
    expect(await screen.findByText('페이지당 첨부 한도 초과')).toBeInTheDocument()
    expect(markdownNow()).toBe('')
  })
})
