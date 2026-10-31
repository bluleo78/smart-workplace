// WP-1242 — HTML 블록 NodeView. 편집기·판 미리보기·공개 공유가 함께 쓰는 확장 묶음(wikiRenderExtensions)으로 띄워
// 격리 iframe(allow-same-origin 없음)·srcdoc(소스 + 높이 스크립트)·높이 메시지(보낸 창 확인·범위)·소스 편집 토글(편집 가능할 때만)을 본다.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { Editor } from '@tiptap/core'
import { EditorContent, useEditor } from '@tiptap/react'
import { http, HttpResponse } from 'msw'
import { useEffect } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { server } from '@/test/msw/server'
import { renderWithProviders } from '@/test/renderWithProviders'

import { HTML_EMBED_DEFAULT_HEIGHT, HTML_EMBED_HEIGHT_SCRIPT, HTML_EMBED_MAX_HEIGHT } from './wikiHtmlEmbedFrame'
import { insertHtmlEmbed } from './wikiHtmlEmbedNode'
import { PREVIEW_DEBOUNCE_MS, REMOTE_PREVIEW_DEBOUNCE_MS } from './WikiHtmlEmbedView'
import { wikiRenderExtensions } from './wikiRenderExtensions'
import { WikiRevisionPreview } from './WikiRevisionPreview'

const SOURCE = '<canvas id="c"></canvas>\n\n<script>document.title = "</scr" + "ipt>"</script>'
const BODY = ['앞 문단', '', '```html-embed', SOURCE, '```'].join('\n')

/** 노트 본문을 그리는 화면과 같은 확장 묶음으로 에디터를 띄운다(편집 가능 여부 지정). onEditor 로 에디터를 테스트에 넘긴다. */
function Body({ markdown, editable, onEditor }: { markdown: string; editable: boolean; onEditor?: (e: Editor) => void }) {
  const editor = useEditor({ extensions: wikiRenderExtensions(), content: markdown, editable }, [])
  useEffect(() => {
    if (editor) onEditor?.(editor)
  }, [editor, onEditor])
  return <EditorContent editor={editor} className="wiki-editor" />
}

/** 에디터를 띄우고 만들어질 때까지 기다린다. */
async function mountEditor(markdown: string, editable = true): Promise<Editor> {
  let ed: Editor | null = null
  render(<Body markdown={markdown} editable={editable} onEditor={(e) => (ed = e)} />)
  await waitFor(() => expect(ed).not.toBeNull())
  return ed!
}

/** 블록 소스 글자 위치(첫 글자 앞) — 문서의 첫 HTML 블록 기준. */
function embedTextPos(ed: Editor): number {
  let at = -1
  ed.state.doc.descendants((n, pos) => {
    if (at < 0 && n.type.name === 'wikiHtmlEmbed') at = pos + 1
    return at < 0
  })
  return at
}

const frame = () => screen.getByTestId('wiki-html-embed-frame') as HTMLIFrameElement

describe('HTML 블록 NodeView', () => {
  it('스크립트만 허용하고 same-origin 은 주지 않는 격리 iframe 에 소스 + 높이 스크립트를 넣는다', async () => {
    render(<Body markdown={BODY} editable={false} />)
    const iframe = await waitFor(frame)
    const sandbox = iframe.getAttribute('sandbox')!.split(/\s+/)
    expect(sandbox).toEqual(
      expect.arrayContaining(['allow-scripts', 'allow-popups', 'allow-popups-to-escape-sandbox', 'allow-downloads']),
    )
    expect(sandbox).not.toContain('allow-same-origin')
    // 대화상자(alert·confirm 되풀이)로 앱 탭을 잠그지 못하게.
    expect(sandbox).not.toContain('allow-modals')
    expect(sandbox).not.toContain('allow-top-navigation')
    const srcdoc = iframe.getAttribute('srcdoc')!
    expect(srcdoc).toContain(SOURCE)
    expect(srcdoc.endsWith(HTML_EMBED_HEIGHT_SCRIPT)).toBe(true)
    expect(iframe.style.height).toBe(`${HTML_EMBED_DEFAULT_HEIGHT}px`)
  })

  it('그 iframe 이 보낸 높이만 받아 범위로 자르고, 다른 창이 보낸 메시지는 무시한다', async () => {
    render(<Body markdown={BODY} editable={false} />)
    const iframe = await waitFor(frame)
    const post = (source: Window | null, height: unknown) =>
      act(() => {
        window.dispatchEvent(new MessageEvent('message', { data: { type: 'wp-html-embed-height', height }, source }))
      })
    post(iframe.contentWindow, 321)
    expect(iframe.style.height).toBe('321px')
    // 다른 창(여기선 상위 창 자신)이 같은 꼴로 보낸 메시지 — 무시.
    post(window, 700)
    expect(iframe.style.height).toBe('321px')
    post(iframe.contentWindow, 99999)
    expect(iframe.style.height).toBe(`${HTML_EMBED_MAX_HEIGHT}px`)
  })

  it('보기 전용이면 머리 띠·소스 편집 단추가 없고 소스 칸은 숨긴다', async () => {
    render(<Body markdown={BODY} editable={false} />)
    const block = await screen.findByTestId('wiki-html-embed')
    expect(within(block).queryByText('HTML 블록')).not.toBeInTheDocument()
    expect(screen.queryByTestId('wiki-html-embed-toggle')).not.toBeInTheDocument()
    expect(block).not.toHaveAttribute('data-source-open')
  })

  it('편집 가능하면 「소스 편집」으로 소스 칸(노드 글자)을 열고 닫는다', async () => {
    render(<Body markdown={BODY} editable />)
    const block = await screen.findByTestId('wiki-html-embed')
    expect(within(block).getByText('HTML 블록')).toBeInTheDocument()
    const toggle = screen.getByTestId('wiki-html-embed-toggle')
    expect(toggle).toHaveTextContent('소스 편집')
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect(block).not.toHaveAttribute('data-source-open')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expect(block).toHaveAttribute('data-source-open')
    // 소스 칸은 노드 글자(contentDOM)다 — 빈 줄·</script> 글자까지 그대로.
    expect(screen.getByTestId('wiki-html-embed-source').textContent).toBe(SOURCE)
    fireEvent.click(toggle)
    expect(block).not.toHaveAttribute('data-source-open')
  })

  it('머리 띠·소스 편집 단추는 노트 CSS 가 숨기지 못하게 인라인 !important 로 고정된다', async () => {
    render(<Body markdown={BODY} editable />)
    const bar = await screen.findByTestId('wiki-html-embed-bar')
    const toggle = screen.getByTestId('wiki-html-embed-toggle')
    for (const [el, display] of [
      [bar, 'flex'],
      [toggle, 'inline-flex'],
    ] as const) {
      expect(el.style.getPropertyValue('display')).toBe(display)
      for (const prop of ['display', 'visibility', 'opacity', 'pointer-events', 'position']) {
        expect(el.style.getPropertyPriority(prop)).toBe('important')
      }
    }
  })

  it('동료가 넣은 빈 블록(문서로 받은 블록)은 소스 칸이 닫힌 채다', async () => {
    render(<Body markdown={'```html-embed\n\n```'} editable />)
    expect(await screen.findByTestId('wiki-html-embed')).not.toHaveAttribute('data-source-open')
  })

  it('이 화면에서 슬래시로 넣은 블록만 소스 칸이 열린 채 시작한다', async () => {
    const ed = await mountEditor('본문')
    act(() => {
      ed.commands.setTextSelection(2)
      ed.commands.command(insertHtmlEmbed)
    })
    expect(await screen.findByTestId('wiki-html-embed')).toHaveAttribute('data-source-open')
  })

  it('닫힌 소스 글자 안으로 커서가 들어오면(화살표 등) 소스 칸을 연다 — 포커스가 없으면 열지 않는다', async () => {
    const ed = await mountEditor(BODY)
    const block = await screen.findByTestId('wiki-html-embed')
    expect(block).not.toHaveAttribute('data-source-open')
    // 포커스 없는 화면에서 위치만 바뀐 경우(동료 편집 매핑 등)는 그대로.
    act(() => {
      ed.commands.setTextSelection(embedTextPos(ed) + 2)
    })
    expect(block).not.toHaveAttribute('data-source-open')
    act(() => {
      ed.commands.setTextSelection(1)
    })
    act(() => {
      ed.view.focus()
      ed.commands.setTextSelection(embedTextPos(ed) + 2)
    })
    await waitFor(() => expect(block).toHaveAttribute('data-source-open'))
  })

  it('커서가 안에 있을 때 닫으면 커서를 블록 뒤로 옮겨 닫힌 채로 남는다', async () => {
    const ed = await mountEditor(BODY + '\n\n뒤 문단')
    act(() => {
      ed.view.focus()
      ed.commands.setTextSelection(embedTextPos(ed) + 2)
    })
    const block = await screen.findByTestId('wiki-html-embed')
    await waitFor(() => expect(block).toHaveAttribute('data-source-open'))
    fireEvent.click(screen.getByTestId('wiki-html-embed-toggle'))
    expect(block).not.toHaveAttribute('data-source-open')
    expect(ed.state.selection.$from.parent.textContent).toBe('뒤 문단')
  })

  describe('미리보기 다시 그리기', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    /** 블록 소스를 통째로 바꾼다(동료 편집처럼 커서·포커스와 무관하게). */
    const setSource = (ed: Editor, text: string) =>
      act(() => {
        const at = embedTextPos(ed)
        const end = at + ed.state.doc.resolve(at).parent.content.size
        ed.view.dispatch(ed.state.tr.replaceWith(at, end, ed.schema.text(text)))
      })

    it('소스 칸이 닫힌 채면 2초 뒤에, 연 채면 0.5초 뒤에 다시 그리고, 같은 소스로 돌아오면 iframe 을 새로 만들지 않는다', async () => {
      const ed = await mountEditor(BODY)
      const first = frame()
      vi.useFakeTimers()
      // 닫힌 채(동료 편집) — 0.5초로는 그대로, 2초 뒤에 바뀐다.
      setSource(ed, '<p>remote</p>')
      act(() => vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS + 10))
      expect(frame().getAttribute('srcdoc')).toContain(SOURCE)
      act(() => vi.advanceTimersByTime(REMOTE_PREVIEW_DEBOUNCE_MS))
      expect(frame().getAttribute('srcdoc')).toContain('<p>remote</p>')
      expect(frame()).not.toBe(first)
      // 연 채(이 화면에서 고침) — 0.5초 뒤에 바뀐다.
      fireEvent.click(screen.getByTestId('wiki-html-embed-toggle'))
      setSource(ed, '<p>local</p>')
      act(() => vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS + 10))
      expect(frame().getAttribute('srcdoc')).toContain('<p>local</p>')
      // 고쳤다가 기다림 안에 되돌리면(마지막으로 그린 소스와 같음) iframe 을 다시 만들지 않는다.
      const drawn = frame()
      setSource(ed, '<p>tmp</p>')
      setSource(ed, '<p>local</p>')
      act(() => vi.advanceTimersByTime(REMOTE_PREVIEW_DEBOUNCE_MS + 10))
      expect(frame()).toBe(drawn)
    })
  })
})

describe('판 미리보기의 HTML 블록', () => {
  it('읽기 전용으로 같은 격리 iframe 을 그리고, 바뀐 블록은 통째 지움+추가로 표시한다', async () => {
    // 멘션 라벨 조회(WikiMentionLabelsProvider) — 이 본문엔 멘션이 없어 빈 목록.
    server.use(http.get('/api/v1/wiki/pages/:id/mentions', () => HttpResponse.json([])))
    renderWithProviders(
      <WikiRevisionPreview pageId={1} title="판" body={BODY} compareTo={BODY.replace('canvas id="c"', 'canvas id="d"')} showDiff />,
    )
    const preview = await screen.findByTestId('wiki-revision-preview')
    await waitFor(() => expect(within(preview).getAllByTestId('wiki-html-embed-frame')).toHaveLength(2))
    const frames = within(preview).getAllByTestId('wiki-html-embed-frame')
    for (const f of frames) expect(f.getAttribute('sandbox')).not.toContain('allow-same-origin')
    expect(frames[0].getAttribute('srcdoc')).toContain('canvas id="c"')
    expect(frames[1].getAttribute('srcdoc')).toContain('canvas id="d"')
    expect(frames[0].closest('.wiki-diff-removed')).not.toBeNull()
    expect(frames[1].closest('.wiki-diff-added')).not.toBeNull()
    expect(within(preview).queryByTestId('wiki-html-embed-toggle')).not.toBeInTheDocument()
  })
})
