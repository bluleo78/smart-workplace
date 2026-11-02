// WP-1242 — HTML 블록 NodeView. 편집기·판 미리보기·공개 공유가 함께 쓰는 확장 묶음(wikiRenderExtensions)으로 띄워
// 격리 iframe(allow-same-origin 없음)·srcdoc(소스 + 높이 스크립트)·높이 메시지(보낸 창 확인·범위)·소스 편집 토글(편집 가능할 때만)을 본다.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { Editor } from '@tiptap/core'
import { AllSelection, NodeSelection, TextSelection } from '@tiptap/pm/state'
import { EditorContent, useEditor } from '@tiptap/react'
import { http, HttpResponse } from 'msw'
import { type RefObject, useEffect } from 'react'
import { toast } from 'sonner'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { emitAiStreamEvent } from '@/lib/aiEventBus'
import { IN_PROGRESS_POLLS } from '@/lib/driveSummary'
import { doneView, htmlScriptsCheckHandlers, htmlScriptsHash } from '@/test/kits/wiki/htmlScriptsCheck'
import { server } from '@/test/msw/server'
import { renderWithProviders } from '@/test/renderWithProviders'

import { useHtmlSourceScripts, WikiHtmlBlockScopeProvider, WikiHtmlScriptBar } from './wikiHtmlBlockSecurity'
import { type WikiHtmlEmbedAi, WikiHtmlEmbedAiProvider } from './WikiHtmlEmbedAiContext'
import { HTML_EMBED_DEFAULT_HEIGHT, HTML_EMBED_HEIGHT_SCRIPT, HTML_EMBED_MAX_HEIGHT } from './wikiHtmlEmbedFrame'
import { HIGHLIGHT_MAX_CHARS } from './wikiHtmlEmbedHighlight'
import { insertHtmlEmbed } from './wikiHtmlEmbedNode'
import { PREVIEW_DEBOUNCE_MS, REMOTE_PREVIEW_DEBOUNCE_MS } from './WikiHtmlEmbedView'
import { HTML_IMPORT_MAX_BYTES } from './wikiHtmlImportInsert'
import { wikiRenderExtensions } from './wikiRenderExtensions'
import { WikiRevisionPreview } from './WikiRevisionPreview'

// 크기 초과 안내(toast.error)를 확인하려고 sonner 의 toast 만 바꾼다.
vi.mock('sonner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('sonner')>()),
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}))

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

/** 편집기에 키를 누른다 — 단축키 플러그인(handleKeyDown)을 실제 키 이벤트로 거친다. */
function pressKey(ed: Editor, key: string, init: KeyboardEventInit = {}) {
  ed.view.someProp('handleKeyDown', (f) => f(ed.view, new KeyboardEvent('keydown', { key, ...init })))
}

/** 문서 안 HTML 블록들의 소스 — 순서대로. */
function embedSources(ed: Editor): string[] {
  const out: string[] = []
  ed.state.doc.descendants((n) => {
    if (n.type.name === 'wikiHtmlEmbed') out.push(n.textContent)
    return true
  })
  return out
}

const frame = () => screen.getByTestId('wiki-html-embed-frame') as HTMLIFrameElement

describe('HTML 블록 NodeView', () => {
  it('스크립트만 허용하고 same-origin 은 주지 않는 격리 iframe 에 소스 + 높이 스크립트를 넣는다', async () => {
    render(<Body markdown={BODY} editable={false} />)
    const iframe = await waitFor(frame)
    const sandbox = iframe.getAttribute('sandbox')!.split(/\s+/)
    expect(sandbox).toEqual(expect.arrayContaining(['allow-scripts', 'allow-popups', 'allow-downloads']))
    expect(sandbox).not.toContain('allow-same-origin')
    // 스크립트가 연 새 창도 같은 격리를 물려받는다(WP-1290) — 블록 밖에서 격리 없이 도는 가짜 화면을 띄우지 못하게.
    expect(sandbox).not.toContain('allow-popups-to-escape-sandbox')
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
    // 연 동안 단추는 「완료」(WP-1300).
    expect(toggle).toHaveTextContent('완료')
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

  it('닫힌 소스 글자 안으로 커서가 들어오면 칸을 열지 않고 블록 통째 선택(선택 테두리)이 된다(WP-1288)', async () => {
    const ed = await mountEditor(BODY)
    const block = await screen.findByTestId('wiki-html-embed')
    act(() => {
      ed.view.focus()
      ed.commands.setTextSelection(embedTextPos(ed) + 2)
    })
    expect(ed.state.selection).toBeInstanceOf(NodeSelection)
    expect(block).not.toHaveAttribute('data-source-open')
    await waitFor(() => expect(block.parentElement).toHaveClass('ProseMirror-selectednode'))
    // 통째 선택에서 Enter·↓ 는 다음 줄(노트 끝이면 새 줄)로, ↑ 는 앞 줄 끝으로 간다.
    act(() => {
      pressKey(ed, 'Enter')
    })
    expect(ed.state.doc.lastChild!.type.name).toBe('paragraph')
    expect(ed.state.selection.$from.index(0)).toBe(ed.state.doc.childCount - 1)
    await waitFor(() => expect(block.parentElement).not.toHaveClass('ProseMirror-selectednode'))
    act(() => {
      ed.commands.setNodeSelection(embedTextPos(ed) - 1)
      pressKey(ed, 'ArrowUp')
    })
    expect(ed.state.selection.$from.parent.textContent).toBe('앞 문단')
    expect(ed.state.selection.$from.parentOffset).toBe('앞 문단'.length)
    // 다음 줄이 이미 있으면 Enter·↓ 모두 그 줄로 간다 — 새 줄을 더 만들지 않는다(기본 Enter 는 노드 선택 옆에 문단을 또 만든다).
    const count = ed.state.doc.childCount
    for (const key of ['Enter', 'ArrowDown']) {
      act(() => {
        ed.commands.setNodeSelection(embedTextPos(ed) - 1)
        pressKey(ed, key)
      })
      expect(ed.state.doc.childCount).toBe(count)
      expect(ed.state.selection.$from.index(0)).toBe(count - 1)
    }
  })

  it('「소스 편집」으로 열면 커서가 소스 끝에 들어가고, 커서가 안에 있을 때 닫으면 블록 통째 선택이 된다', async () => {
    const ed = await mountEditor(BODY + '\n\n뒤 문단')
    const block = await screen.findByTestId('wiki-html-embed')
    fireEvent.click(screen.getByTestId('wiki-html-embed-toggle'))
    expect(block).toHaveAttribute('data-source-open')
    expect(ed.state.selection.$from.parent.type.name).toBe('wikiHtmlEmbed')
    expect(ed.state.selection.$from.parentOffset).toBe(SOURCE.length)
    fireEvent.click(screen.getByTestId('wiki-html-embed-toggle'))
    expect(block).not.toHaveAttribute('data-source-open')
    expect(ed.state.selection).toBeInstanceOf(NodeSelection)
    expect(ed.state.selection.from).toBe(embedTextPos(ed) - 1)
  })

  describe('막대·선택 안내·소스 편집 개선(WP-1300)', () => {
    const TWO = ['앞 문단', '', '```html-embed', '<p>첫</p>', '```', '', '가운데', '', '```html-embed', '<p>둘</p>', '```', '', '뒤 문단'].join('\n')
    const blockAt = (i: number) => screen.getAllByTestId('wiki-html-embed')[i]
    /** i 번째 HTML 블록 앞 위치. */
    const embedPos = (ed: Editor, i: number) => {
      const found: number[] = []
      ed.state.doc.descendants((n, pos) => {
        if (n.type.name === 'wikiHtmlEmbed') found.push(pos)
        return true
      })
      return found[i]
    }
    const selectBlock = (ed: Editor, i = 0) =>
      act(() => {
        ed.view.focus()
        ed.commands.setNodeSelection(embedPos(ed, i))
      })

    it('선택하지 않은 블록 막대는 이름표·소스 편집·고르기·⋯ 만, 선택하면 다시 올리기·크게 보기·삭제와 키 안내가 보인다', async () => {
      const ed = await mountEditor(BODY + '\n\n뒤 문단')
      const block = await screen.findByTestId('wiki-html-embed')
      const bar = within(block).getByTestId('wiki-html-embed-bar')
      expect(within(bar).getByTestId('wiki-html-embed-label')).toHaveTextContent('HTML 블록')
      expect(within(bar).getByTestId('wiki-html-embed-more')).toBeInTheDocument()
      for (const id of ['wiki-html-embed-reupload', 'wiki-html-embed-expand', 'wiki-html-embed-delete', 'wiki-html-embed-hint']) {
        expect(within(block).queryByTestId(id)).not.toBeInTheDocument()
      }
      // 고르기(WP-1301)는 이름표·소스 편집 다음에 늘 있고, AI로 고치기(WP-1302)는 AI 를 쓰는 노트 편집 화면(컨텍스트)이 아니면 없다.
      expect(within(bar).getByTestId('wiki-html-embed-pick')).toHaveTextContent('고르기')
      expect(within(block).queryByText(/AI로 고치기/)).not.toBeInTheDocument()
      expect(block).not.toHaveAttribute('data-selected')

      selectBlock(ed)
      await waitFor(() => expect(block).toHaveAttribute('data-selected'))
      expect(within(bar).getByTestId('wiki-html-embed-reupload')).toHaveTextContent('다시 올리기')
      expect(within(bar).getByTestId('wiki-html-embed-expand')).toHaveTextContent('크게 보기')
      expect(within(bar).getByTestId('wiki-html-embed-delete')).toHaveTextContent('삭제')
      expect(within(bar).queryByTestId('wiki-html-embed-more')).not.toBeInTheDocument()
      // jsdom 의 navigator.platform 은 맥이 아니다 — Ctrl+Enter 로 표기한다.
      expect(within(block).getByTestId('wiki-html-embed-hint')).toHaveTextContent('Enter 다음 줄 · Esc 바깥으로 · Ctrl+Enter 바로 나가기')
      // 새로 붙인 막대 요소도 노트 CSS 가 숨기지 못하게 고정된다.
      for (const el of [within(bar).getByTestId('wiki-html-embed-label'), within(bar).getByTestId('wiki-html-embed-delete'), within(block).getByTestId('wiki-html-embed-hint')]) {
        expect(el.style.getPropertyPriority('display')).toBe('important')
      }

      // 선택을 풀면 안내·선택 단추가 사라진다.
      act(() => {
        ed.commands.setTextSelection(ed.state.doc.content.size - 1)
      })
      await waitFor(() => expect(within(block).queryByTestId('wiki-html-embed-hint')).not.toBeInTheDocument())
      expect(within(bar).queryByTestId('wiki-html-embed-reupload')).not.toBeInTheDocument()
    })

    it('막대 이름표를 누르면 블록 통째 선택이 된다', async () => {
      const ed = await mountEditor(BODY + '\n\n뒤 문단')
      act(() => {
        ed.commands.setTextSelection(ed.state.doc.content.size - 1)
      })
      fireEvent.click(await screen.findByTestId('wiki-html-embed-label'))
      expect(ed.state.selection).toBeInstanceOf(NodeSelection)
      expect(ed.state.selection.from).toBe(embedTextPos(ed) - 1)
    })

    it('소스 칸 안에서 Esc 를 누르면 칸이 닫히고 블록 통째 선택이 된다 — 그 상태의 Esc 는 옆 글 줄로 나간다', async () => {
      const ed = await mountEditor(BODY + '\n\n뒤 문단')
      const block = await screen.findByTestId('wiki-html-embed')
      fireEvent.click(screen.getByTestId('wiki-html-embed-toggle'))
      expect(block).toHaveAttribute('data-source-open')
      // 소스 안 Enter 는 코드 줄바꿈 그대로(다음 줄로 나가지 않는다).
      act(() => {
        ed.commands.setTextSelection(embedTextPos(ed) + 3)
      })
      act(() => {
        pressKey(ed, 'Escape')
      })
      expect(block).not.toHaveAttribute('data-source-open')
      expect(ed.state.selection).toBeInstanceOf(NodeSelection)
      expect(ed.state.selection.from).toBe(embedTextPos(ed) - 1)
      await waitFor(() => expect(screen.getByTestId('wiki-html-embed-hint')).toBeInTheDocument())
      // 통째 선택에서 Esc — 뒤 글 줄 처음으로(새 줄을 만들지 않는다).
      const count = ed.state.doc.childCount
      act(() => {
        pressKey(ed, 'Escape')
      })
      expect(ed.state.doc.childCount).toBe(count)
      expect(ed.state.selection.$from.parent.textContent).toBe('뒤 문단')
      expect(ed.state.selection.$from.parentOffset).toBe(0)
    })

    it('통째 선택에서 ⌘/Ctrl+Enter 는 바로 다음 줄로 나간다', async () => {
      const ed = await mountEditor(BODY)
      selectBlock(ed)
      act(() => {
        pressKey(ed, 'Enter', { ctrlKey: true })
      })
      expect(ed.state.doc.lastChild!.type.name).toBe('paragraph')
      expect(ed.state.selection.$from.index(0)).toBe(ed.state.doc.childCount - 1)
    })

    it('소스를 열면 줄 번호와 색 구분이 붙고, 닫으면 색 구분 데코레이션이 빠진다', async () => {
      await mountEditor(BODY)
      const source = await screen.findByTestId('wiki-html-embed-source')
      const gutter = screen.getByTestId('wiki-html-embed-code').querySelector('.wiki-html-embed__gutter')!
      expect(gutter).toHaveAttribute('aria-hidden')
      // 닫힌 동안은 줄 번호를 세지 않는다.
      expect(gutter.textContent).toBe('')
      expect(source.querySelectorAll('.wiki-html-tok')).toHaveLength(0)
      fireEvent.click(screen.getByTestId('wiki-html-embed-toggle'))
      // SOURCE 는 3줄(빈 줄 포함).
      expect(gutter.textContent).toBe('1\n2\n3')
      await waitFor(() => expect(source.querySelectorAll('.wiki-html-tok--tag').length).toBeGreaterThan(0))
      expect([...source.querySelectorAll('.wiki-html-tok--attr')].map((e) => e.textContent)).toEqual(['id'])
      expect([...source.querySelectorAll('.wiki-html-tok--value')].map((e) => e.textContent)).toEqual(['"c"'])
      // 꾸밈만 얹었다 — 노드 글자는 그대로다.
      expect(source.textContent).toBe(SOURCE)
      fireEvent.click(screen.getByTestId('wiki-html-embed-toggle'))
      await waitFor(() => expect(source.querySelectorAll('.wiki-html-tok')).toHaveLength(0))
    })

    it('블록을 덮는 글자 범위 선택(전체 선택·드래그)은 통째 선택이 아니다 — 선택 단추·안내가 뜨지 않는다', async () => {
      const ed = await mountEditor(BODY + '\n\n뒤 문단')
      const block = await screen.findByTestId('wiki-html-embed')
      selectBlock(ed)
      await waitFor(() => expect(block).toHaveAttribute('data-selected'))
      // 노드 선택 → 전체 선택: tiptap 의 selected 는 그대로 참이지만 단추·안내는 사라져야 한다.
      act(() => {
        ed.view.dispatch(ed.state.tr.setSelection(new AllSelection(ed.state.doc)))
      })
      await waitFor(() => expect(block).not.toHaveAttribute('data-selected'))
      expect(within(block).queryByTestId('wiki-html-embed-hint')).not.toBeInTheDocument()
      expect(within(block).queryByTestId('wiki-html-embed-reupload')).not.toBeInTheDocument()
      // 앞 문단부터 뒤 문단까지 끌어 고른 글자 선택도 같다.
      act(() => {
        ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, 1, ed.state.doc.content.size - 1)))
      })
      expect(block).not.toHaveAttribute('data-selected')
      expect(within(block).queryByTestId('wiki-html-embed-hint')).not.toBeInTheDocument()
    })

    it('통째 선택된 블록의 소스 칸이 열려 있으면 Esc 는 칸만 닫고 통째 선택을 둔다(한 단계씩)', async () => {
      const ed = await mountEditor(BODY + '\n\n뒤 문단')
      const block = await screen.findByTestId('wiki-html-embed')
      fireEvent.click(screen.getByTestId('wiki-html-embed-toggle'))
      // 이름표로 블록을 고른다 — 소스 칸은 열린 채.
      fireEvent.click(screen.getByTestId('wiki-html-embed-label'))
      expect(ed.state.selection).toBeInstanceOf(NodeSelection)
      expect(block).toHaveAttribute('data-source-open')
      act(() => {
        pressKey(ed, 'Escape')
      })
      expect(block).not.toHaveAttribute('data-source-open')
      expect(ed.state.selection).toBeInstanceOf(NodeSelection)
      expect(ed.state.selection.from).toBe(embedTextPos(ed) - 1)
    })

    it('옆에 글 줄이 없는 통째 선택 블록(노트 끝)에서 Esc 는 뒤에 새 줄을 만들어 나간다', async () => {
      const ed = await mountEditor('```html-embed\n<p>a</p>\n```')
      selectBlock(ed)
      const count = ed.state.doc.childCount
      act(() => {
        pressKey(ed, 'Escape')
      })
      expect(ed.state.doc.childCount).toBe(count + 1)
      expect(ed.state.doc.lastChild!.type.name).toBe('paragraph')
      expect(ed.state.selection.$from.index(0)).toBe(count)
    })

    it('소스를 연 채 고치면 바뀐 글자만 새로 칠한다 — 새 속성도 색이 붙는다', async () => {
      const ed = await mountEditor(BODY)
      const source = await screen.findByTestId('wiki-html-embed-source')
      fireEvent.click(screen.getByTestId('wiki-html-embed-toggle'))
      await waitFor(() => expect(source.querySelectorAll('.wiki-html-tok--attr')).toHaveLength(1))
      act(() => {
        const at = embedTextPos(ed)
        ed.view.dispatch(ed.state.tr.insertText('<b class="x">', at))
      })
      await waitFor(() => expect([...source.querySelectorAll('.wiki-html-tok--attr')].map((e) => e.textContent)).toEqual(['class', 'id']))
      expect([...source.querySelectorAll('.wiki-html-tok--value')].map((e) => e.textContent)).toEqual(['"x"', '"c"'])
    })

    it('소스가 칠하기 상한(HIGHLIGHT_MAX_CHARS)을 넘으면 열어도 칠하지 않는다', async () => {
      const long = '<p class="a">x</p>\n'.repeat(Math.ceil(HIGHLIGHT_MAX_CHARS / 19) + 1)
      await mountEditor(['```html-embed', long, '```'].join('\n'))
      const source = await screen.findByTestId('wiki-html-embed-source')
      fireEvent.click(screen.getByTestId('wiki-html-embed-toggle'))
      await waitFor(() => expect(screen.getByTestId('wiki-html-embed')).toHaveAttribute('data-source-open'))
      expect(source.querySelectorAll('.wiki-html-tok')).toHaveLength(0)
    })

    it('「다시 올리기」를 닫은 뒤 늦게 끝난 파일 읽기는 다음에 연 칸에 들어가지 않는다', async () => {
      const ed = await mountEditor(BODY)
      selectBlock(ed)
      fireEvent.click(await screen.findByTestId('wiki-html-embed-reupload'))
      let dialog = await screen.findByTestId('wiki-html-embed-reupload-dialog')
      let finish: (text: string) => void = () => {}
      const slow = { name: 'slow.html', type: 'text/html', size: 10, text: () => new Promise<string>((r) => (finish = r)) }
      fireEvent.change(within(dialog).getByTestId('wiki-html-embed-reupload-file'), { target: { files: [slow] } })
      fireEvent.click(within(dialog).getByRole('button', { name: '취소' }))
      await waitFor(() => expect(screen.queryByTestId('wiki-html-embed-reupload-dialog')).not.toBeInTheDocument())
      await act(async () => {
        finish('<p>늦게 온 소스</p>')
      })
      fireEvent.click(screen.getByTestId('wiki-html-embed-reupload'))
      dialog = await screen.findByTestId('wiki-html-embed-reupload-dialog')
      expect((within(dialog).getByTestId('wiki-html-embed-reupload-text') as HTMLTextAreaElement).value).toBe('')
      expect(within(dialog).getByTestId('wiki-html-embed-reupload-apply')).toBeDisabled()
    })

    it('「다시 올리기」에 붙여 넣은 소스로 이 블록 소스만 바꾼다', async () => {
      const ed = await mountEditor(TWO)
      selectBlock(ed, 1)
      await waitFor(() => expect(blockAt(1)).toHaveAttribute('data-selected'))
      fireEvent.click(within(blockAt(1)).getByTestId('wiki-html-embed-reupload'))
      const dialog = await screen.findByTestId('wiki-html-embed-reupload-dialog')
      const apply = within(dialog).getByTestId('wiki-html-embed-reupload-apply')
      // 손대기 전에는 바꿀 수 없다(실수로 블록을 비우지 않게).
      expect(apply).toBeDisabled()
      fireEvent.change(within(dialog).getByTestId('wiki-html-embed-reupload-text'), { target: { value: '<h1>새</h1>\r\n<p>본문</p>' } })
      fireEvent.click(apply)
      await waitFor(() => expect(screen.queryByTestId('wiki-html-embed-reupload-dialog')).not.toBeInTheDocument())
      expect(embedSources(ed)).toEqual(['<p>첫</p>', '<h1>새</h1>\n<p>본문</p>'])
      expect(ed.state.doc.textBetween(0, ed.state.doc.content.size, '|')).toBe('앞 문단|<p>첫</p>|가운데|<h1>새</h1>\n<p>본문</p>|뒤 문단')
    })

    it('「다시 올리기」는 5MB 넘는 파일을 거르고(안내), HTML 파일은 칸에 불러온 뒤 바꾼다 — 비운 칸으로 바꾸면 빈 블록', async () => {
      vi.mocked(toast.error).mockClear()
      const ed = await mountEditor(TWO)
      selectBlock(ed, 0)
      await waitFor(() => expect(blockAt(0)).toHaveAttribute('data-selected'))
      fireEvent.click(within(blockAt(0)).getByTestId('wiki-html-embed-reupload'))
      const dialog = await screen.findByTestId('wiki-html-embed-reupload-dialog')
      const text = within(dialog).getByTestId('wiki-html-embed-reupload-text') as HTMLTextAreaElement

      const big = new File(['<p>big</p>'], 'big.html', { type: 'text/html' })
      Object.defineProperty(big, 'size', { value: HTML_IMPORT_MAX_BYTES + 1 })
      fireEvent.drop(within(dialog).getByTestId('wiki-html-embed-dropzone'), { dataTransfer: { files: [big] } })
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('5MB'))
      expect(text.value).toBe('')
      expect(within(dialog).getByTestId('wiki-html-embed-reupload-apply')).toBeDisabled()

      // 파일 고르기(숨은 input) — 크기 검사 뒤 칸에 채운다.
      const ok = new File(['<p>파일</p>'], 'chart.html', { type: 'text/html' })
      fireEvent.change(within(dialog).getByTestId('wiki-html-embed-reupload-file'), { target: { files: [ok] } })
      await waitFor(() => expect(text.value).toBe('<p>파일</p>'))
      expect(within(dialog).getByText('불러온 파일: chart.html')).toBeInTheDocument()
      fireEvent.change(text, { target: { value: '' } })
      fireEvent.click(within(dialog).getByTestId('wiki-html-embed-reupload-apply'))
      expect(embedSources(ed)).toEqual(['', '<p>둘</p>'])
    })

    it('「크게 보기」는 같은 소스를 격리 iframe(스크립트 허용·same-origin 없음)으로 큰 창에 띄운다', async () => {
      const ed = await mountEditor(BODY)
      selectBlock(ed)
      fireEvent.click(await screen.findByTestId('wiki-html-embed-expand'))
      const big = await screen.findByTestId('wiki-html-embed-expand-frame')
      expect(big.getAttribute('srcdoc')).toContain(SOURCE)
      expect(big.getAttribute('sandbox')).toContain('allow-scripts')
      expect(big.getAttribute('sandbox')).not.toContain('allow-same-origin')
    })

    it('「삭제」는 그 블록만 지우고 선택은 문서 안 유효한 자리에 남는다', async () => {
      const ed = await mountEditor(TWO)
      selectBlock(ed, 0)
      await waitFor(() => expect(blockAt(0)).toHaveAttribute('data-selected'))
      fireEvent.click(within(blockAt(0)).getByTestId('wiki-html-embed-delete'))
      expect(embedSources(ed)).toEqual(['<p>둘</p>'])
      expect(ed.state.doc.textBetween(0, ed.state.doc.content.size, '|')).toBe('앞 문단|가운데|<p>둘</p>|뒤 문단')
      const { from } = ed.state.selection
      expect(from).toBeGreaterThanOrEqual(0)
      expect(from).toBeLessThanOrEqual(ed.state.doc.content.size)
    })

    it('보기 전용이면 블록을 통째 선택해도 막대·안내·선택 단추가 없다', async () => {
      const ed = await mountEditor(BODY, false)
      const block = await screen.findByTestId('wiki-html-embed')
      act(() => {
        ed.commands.setNodeSelection(embedTextPos(ed) - 1)
      })
      for (const id of ['wiki-html-embed-bar', 'wiki-html-embed-label', 'wiki-html-embed-hint', 'wiki-html-embed-reupload', 'wiki-html-embed-more']) {
        expect(within(block).queryByTestId(id)).not.toBeInTheDocument()
      }
      expect(block).not.toHaveAttribute('data-selected')
    })
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

// WP-1301 — 요소 고르기. iframe 안 스크립트의 실제 마우스 동작은 E2E(@input)가 보고, 여기서는 부모 쪽 배선을 본다:
// 편집 화면에만 토큰 실은 고르기 스크립트를 넣고, 그 iframe·그 토큰의 메시지로만 칩을 그리며, 단추·칩·Esc 가 iframe 에 맞는 명령을 보낸다.
describe('HTML 블록 요소 고르기', () => {
  const ITEM = (text: string, kind = '제목') => ({ path: `h1#${text}`, tag: 'h1', kind, text, html: '<h1>', rect: { x: 0, y: 0, width: 10, height: 10 } })
  const tokenOf = (iframe: HTMLIFrameElement) => /var TOKEN="([^"]+)"/.exec(iframe.getAttribute('srcdoc') ?? '')?.[1]
  const send = (source: Window | null, data: Record<string, unknown>) =>
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { data: { type: 'wp-html-picker', ...data }, source }))
    })

  it('편집 화면에만 블록 토큰을 실은 고르기 스크립트를 넣는다', async () => {
    const ed = await mountEditor(BODY, true)
    const iframe = await waitFor(frame)
    expect(tokenOf(iframe)).toMatch(/^[0-9a-f-]{32,}$/)
    expect(iframe.getAttribute('srcdoc')).toContain('<script data-wp-html-picker>')
    act(() => ed.setEditable(false))
    await waitFor(() => expect(frame().getAttribute('srcdoc')).not.toContain('data-wp-html-picker'))
    expect(screen.queryByTestId('wiki-html-embed-pick')).not.toBeInTheDocument()
  })

  it('「고르기」를 누르면 켜짐으로 바뀌고 그 iframe 에 켜기를 보낸다 — 다시 누르면 끈다', async () => {
    render(<Body markdown={BODY} editable />)
    const iframe = await waitFor(frame)
    const postSpy = vi.spyOn(iframe.contentWindow!, 'postMessage')
    const btn = screen.getByTestId('wiki-html-embed-pick')
    expect(btn).toHaveTextContent('고르기')
    fireEvent.click(btn)
    expect(btn).toHaveAttribute('aria-pressed', 'true')
    expect(btn).toHaveTextContent('고르기 켜짐')
    expect(postSpy).toHaveBeenLastCalledWith({ type: 'wp-html-picker', token: tokenOf(iframe), cmd: 'enable' }, '*')
    // 켜져 있고 고른 것이 없으면 안내 한 줄.
    expect(screen.getByTestId('wiki-html-embed-picks')).toHaveTextContent('누르면 고릅니다 · Shift+클릭 여러 개 · Esc 끄기')
    fireEvent.click(btn)
    expect(btn).toHaveAttribute('aria-pressed', 'false')
    expect(postSpy).toHaveBeenLastCalledWith({ type: 'wp-html-picker', token: tokenOf(iframe), cmd: 'disable' }, '*')
    expect(screen.queryByTestId('wiki-html-embed-picks')).not.toBeInTheDocument()
  })

  it('그 iframe 이 그 토큰으로 보낸 상태만 칩으로 그린다 — 다른 창·토큰이 틀린 메시지는 무시한다', async () => {
    render(<Body markdown={BODY} editable />)
    const iframe = await waitFor(frame)
    const token = tokenOf(iframe)
    // 다른 창(상위 창 자신)·다른 블록 토큰 — 무시.
    send(window, { token, event: 'state', enabled: true, items: [ITEM('남의 창')] })
    send(iframe.contentWindow, { token: 'other-block', event: 'state', enabled: true, items: [ITEM('남의 블록')] })
    expect(screen.queryByTestId('wiki-html-embed-chip')).not.toBeInTheDocument()
    expect(screen.getByTestId('wiki-html-embed-pick')).toHaveAttribute('aria-pressed', 'false')
    // iframe 안 ⌘+클릭으로 켜지고 두 개를 고른 상태 — 단추도 켜짐을 따라간다.
    send(iframe.contentWindow, { token, event: 'state', enabled: true, items: [ITEM('3분기 회고'), ITEM('', '차트')] })
    const chips = screen.getAllByTestId('wiki-html-embed-chip')
    expect(chips.map((c) => c.textContent)).toEqual(['1제목 · 3분기 회고', '2차트'])
    expect(screen.getByTestId('wiki-html-embed-pick')).toHaveAttribute('aria-pressed', 'true')
  })

  it('칩을 누르면 그 요소 강조, ✕ 는 빼기를 보낸다', async () => {
    render(<Body markdown={BODY} editable />)
    const iframe = await waitFor(frame)
    const token = tokenOf(iframe)
    const postSpy = vi.spyOn(iframe.contentWindow!, 'postMessage')
    send(iframe.contentWindow, { token, event: 'state', enabled: true, items: [ITEM('가'), ITEM('나')] })
    fireEvent.click(within(screen.getAllByTestId('wiki-html-embed-chip')[1]).getByText(/나/))
    expect(postSpy).toHaveBeenLastCalledWith({ type: 'wp-html-picker', token, cmd: 'highlight', index: 1 }, '*')
    fireEvent.click(screen.getByRole('button', { name: '1번 고른 것 빼기' }))
    expect(postSpy).toHaveBeenLastCalledWith({ type: 'wp-html-picker', token, cmd: 'remove', index: 0 }, '*')
  })

  // 고른 것 풀기 단계는 iframe 이 스스로 한다(E2E) — 부모에는 고른 것 없이 누른 Esc 만 온다.
  it('iframe 안 Esc(고른 것 없음) — 고르기를 끄고 블록을 통째 선택한다', async () => {
    const ed = await mountEditor(BODY, true)
    const iframe = await waitFor(frame)
    const token = tokenOf(iframe)
    const postSpy = vi.spyOn(iframe.contentWindow!, 'postMessage')
    send(iframe.contentWindow, { token, event: 'state', enabled: true, items: [] })
    send(iframe.contentWindow, { token, event: 'escape' })
    expect(postSpy).toHaveBeenLastCalledWith({ type: 'wp-html-picker', token, cmd: 'disable' }, '*')
    expect(screen.getByTestId('wiki-html-embed-pick')).toHaveAttribute('aria-pressed', 'false')
    expect(ed.state.selection).toBeInstanceOf(NodeSelection)
    expect((ed.state.selection as NodeSelection).node.type.name).toBe('wikiHtmlEmbed')
  })

  it('새 문서가 뜨면(ready) 고른 것을 비우고, 켜져 있었으면 다시 켜 보낸다', async () => {
    render(<Body markdown={BODY} editable />)
    const iframe = await waitFor(frame)
    const token = tokenOf(iframe)
    const postSpy = vi.spyOn(iframe.contentWindow!, 'postMessage')
    send(iframe.contentWindow, { token, event: 'state', enabled: true, items: [ITEM('가')] })
    send(iframe.contentWindow, { token, event: 'ready' })
    expect(screen.queryByTestId('wiki-html-embed-chip')).not.toBeInTheDocument()
    expect(postSpy).toHaveBeenLastCalledWith({ type: 'wp-html-picker', token, cmd: 'enable' }, '*')
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
    // 지난 판도 스크립트는 기본 멈춤(WP-1290) — 서버가 지난 판은 점검하지 않아 점검 칩 없이 스위치만 둔다.
    for (const f of frames) expect(f.getAttribute('sandbox')).not.toContain('allow-scripts')
    const bar = within(preview).getByTestId('wiki-html-script-bar')
    expect(bar).toHaveTextContent('스크립트가 있는 HTML 블록 2개')
    expect(within(bar).queryByRole('button', { name: /점검/ })).not.toBeInTheDocument()
    fireEvent.click(within(bar).getByRole('switch', { name: '스크립트 실행' }))
    await waitFor(() =>
      within(preview).getAllByTestId('wiki-html-embed-frame').forEach((f) => expect(f.getAttribute('sandbox')).toContain('allow-scripts')),
    )
  })
})

// WP-1290 — 노트 스크립트 스위치. 노트 편집 화면처럼 범위(Provider)로 감싼 편집기에서 기본 멈춤·스위치 하나로 모든 블록 켜기·
// 블록이 바뀌면 다시 멈춤·서버 지문이 같을 때만 결과를 씀·↻ 요청·「높음」 확인 창·멈춘 블록의 크게 보기와 고르기를 본다.
describe('노트 HTML 블록 스크립트 스위치(WP-1290)', () => {
  const SECOND = '<button onclick="go()">이동</button>'
  const TWO = ['```html-embed', SOURCE, '```', '', '```html-embed', SECOND, '```', '', '```html-embed', '<p>스크립트 없음</p>', '```'].join('\n')

  async function mountNote(check: Parameters<typeof htmlScriptsCheckHandlers>[0], markdown = TWO) {
    const mock = htmlScriptsCheckHandlers(check)
    server.use(...mock.handlers)
    let ed: Editor | null = null
    renderWithProviders(
      <WikiHtmlBlockScopeProvider scope={{ pageId: 7 }}>
        <WikiHtmlScriptBar />
        <Body markdown={markdown} editable onEditor={(e) => (ed = e)} />
      </WikiHtmlBlockScopeProvider>,
    )
    await waitFor(() => expect(ed).not.toBeNull())
    return { ed: ed!, calls: mock.calls, bar: await screen.findByTestId('wiki-html-script-bar') }
  }
  const sandboxes = () => screen.getAllByTestId('wiki-html-embed-frame').map((f) => f.getAttribute('sandbox') ?? '')

  it('스크립트 블록만 세어 기본 멈춤으로 그리고, 스위치 하나로 모두 켠다 — 스크립트 없는 블록은 처음부터 돈다', async () => {
    const { bar } = await mountNote({})
    await waitFor(() => expect(bar).toHaveTextContent('스크립트가 있는 HTML 블록 2개 · 스크립트가 멈춰 있어요'))
    await waitFor(() => expect(sandboxes()).toHaveLength(3))
    const [a, b, plain] = sandboxes()
    expect(a).not.toContain('allow-scripts')
    expect(b).not.toContain('allow-scripts')
    expect(plain).toContain('allow-scripts')
    expect(screen.getAllByTestId('wiki-html-block-badge')).toHaveLength(2)
    fireEvent.click(within(bar).getByRole('switch', { name: '스크립트 실행' }))
    await waitFor(() => sandboxes().forEach((sb) => expect(sb).toContain('allow-scripts')))
    expect(bar).toHaveAttribute('data-on', 'true')
    expect(screen.queryByTestId('wiki-html-block-badge')).not.toBeInTheDocument()
  })

  it('문서에서 떨어진 채 남은 블록은 세지 않는다 — 개발 모드에서 언마운트되지 않은 NodeView 가 블록을 두 번 세던 것', async () => {
    server.use(...htmlScriptsCheckHandlers().handlers)
    // 떨어진 블록 흉내 — 알린 뒤 요소만 문서에서 떼고 컴포넌트는 남긴다(tiptap 이 남긴 NodeView 와 같은 상태).
    const orphan = document.createElement('div')
    document.body.append(orphan)
    const Reporter = ({ source, anchor }: { source: string; anchor?: RefObject<Element | null> }) => {
      useHtmlSourceScripts(source, anchor)
      return null
    }
    const anchor = { current: orphan }
    const note = (live: string) => (
      <WikiHtmlBlockScopeProvider scope={{ pageId: 7 }}>
        <WikiHtmlScriptBar />
        <Reporter source={SOURCE} anchor={anchor} />
        <Reporter source={live} />
      </WikiHtmlBlockScopeProvider>
    )
    const { rerender } = renderWithProviders(note('<script>a()</script>'))
    const bar = await screen.findByTestId('wiki-html-script-bar')
    await waitFor(() => expect(bar).toHaveTextContent('스크립트가 있는 HTML 블록 2개'))
    // 요소가 떨어진 뒤 다른 블록이 바뀌면(다시 알림) 떨어진 블록은 빠진다.
    orphan.remove()
    rerender(note('<script>b()</script>'))
    await waitFor(() => expect(bar).toHaveTextContent('스크립트가 있는 HTML 블록 1개'))
  })

  it('점검 폴링이 상한에 닿은 뒤 ↻(다시 점검)를 누르면 다시 폴링한다', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const hash = await htmlScriptsHash([SOURCE])
      const checking = { hash, blockCount: 1, view: { ...doneView('LOW'), status: 'CHECKING' as const, risk: null } }
      const { bar, calls } = await mountNote(checking, ['```html-embed', SOURCE, '```'].join('\n'))
      const gets = () => calls.filter((c) => c.method === 'GET').length
      await waitFor(() => expect(gets()).toBeGreaterThan(0))
      // 상한(IN_PROGRESS_POLLS)을 넘길 만큼 흘려 폴링이 멈추게 한다.
      for (let i = 0; i < IN_PROGRESS_POLLS + 2; i++) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(3000)
        })
      }
      const stopped = gets()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(9000)
      })
      expect(gets()).toBe(stopped)
      fireEvent.click(within(bar).getByRole('button', { name: /다시 점검|점검/ }))
      await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(6100)
      })
      expect(gets()).toBeGreaterThan(stopped)
    } finally {
      vi.useRealTimers()
    }
  })

  it('지문을 낼 수 없는 출처(http — crypto.subtle 없음)에서도 앱 안 스위치로 켤 수 있다', async () => {
    const subtle = vi.spyOn(globalThis.crypto, 'subtle', 'get').mockReturnValue(undefined as unknown as SubtleCrypto)
    try {
      const { bar, calls } = await mountNote({})
      await waitFor(() => expect(sandboxes()).toHaveLength(3))
      fireEvent.click(within(bar).getByRole('switch', { name: '스크립트 실행' }))
      await waitFor(() => sandboxes().forEach((sb) => expect(sb).toContain('allow-scripts')))
      // 지문이 없으니 점검은 묻지 않는다.
      expect(calls).toEqual([])
    } finally {
      subtle.mockRestore()
    }
  })

  it('켠 뒤 블록 하나가 바뀌면 노트 지문이 달라져 다시 멈춘다', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const { ed, bar } = await mountNote({})
      fireEvent.click(within(bar).getByRole('switch', { name: '스크립트 실행' }))
      await waitFor(() => expect(bar).toHaveAttribute('data-on', 'true'))
      act(() => {
        ed.commands.insertContentAt(embedTextPos(ed), '<!-- 고침 -->')
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(REMOTE_PREVIEW_DEBOUNCE_MS + 50)
      })
      await waitFor(() => expect(bar).toHaveAttribute('data-on', 'false'))
      expect(sandboxes()[0]).not.toContain('allow-scripts')
    } finally {
      vi.useRealTimers()
    }
  })

  it('서버 지문이 화면 노트와 같을 때만 결과를 보이고(다르면 점검 전), ↻ 는 같은 경로로 다시 점검을 요청한다', async () => {
    const hash = await htmlScriptsHash([SOURCE, SECOND])
    const same = await mountNote({ hash, blockCount: 2, view: doneView('LOW') })
    await waitFor(() => expect(same.bar).toHaveAttribute('data-risk', 'LOW'))
    fireEvent.click(within(same.bar).getByRole('button', { name: '다시 점검' }))
    await waitFor(() => expect(same.calls).toContainEqual({ method: 'POST', path: '/api/v1/wiki/pages/7/html-scripts/security-check' }))
    cleanup()

    const other = await mountNote({ hash: 'f'.repeat(64), blockCount: 2, view: doneView('HIGH', '옛 내용') })
    await waitFor(() => expect(other.calls.some((c) => c.method === 'GET')).toBe(true))
    expect(other.bar).not.toHaveAttribute('data-risk')
    expect(other.bar).not.toHaveTextContent('옛 내용')
  })

  it('노트가 「높음」이면 줄이 이유를 보이고, 켜기 전에 확인 창을 한 번 거친다', async () => {
    const hash = await htmlScriptsHash([SOURCE, SECOND])
    const { bar } = await mountNote({ hash, blockCount: 2, view: doneView('HIGH', '로그인 화면을 흉내 낸다') })
    await waitFor(() => expect(bar).toHaveAttribute('data-risk', 'HIGH'))
    expect(bar).toHaveTextContent('로그인 화면을 흉내 낸다')
    fireEvent.click(within(bar).getByRole('switch', { name: '스크립트 실행' }))
    expect(bar).toHaveAttribute('data-on', 'false')
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('이 노트의 HTML 블록이 모두 실행돼요')
    fireEvent.click(within(dialog).getByRole('button', { name: /실행/ }))
    await waitFor(() => expect(bar).toHaveAttribute('data-on', 'true'))
  })

  it('멈춘 블록은 고르기를 쓸 수 없고(까닭을 보임) 크게 보기도 스크립트 없이 연다', async () => {
    const { ed } = await mountNote({}, BODY)
    act(() => {
      ed.commands.setNodeSelection(embedTextPos(ed) - 1)
    })
    const pick = await screen.findByTestId('wiki-html-embed-pick')
    expect(pick).toBeDisabled()
    expect(pick).toHaveAttribute('title', '노트 스크립트를 켜면 고를 수 있어요')
    fireEvent.click(await screen.findByRole('button', { name: '크게 보기' }))
    const big = await screen.findByTestId('wiki-html-embed-expand-frame')
    expect(big.getAttribute('sandbox')).not.toContain('allow-scripts')
  })
})

// WP-1302 — 「✦ AI로 고치기」. 노트 편집 화면처럼 AI 컨텍스트로 감싼 편집기에서 입력 칸 열기·Esc(글 남김)·요청 칩·고른 요소 칩·요청 본문(MSW)·
// 스트림(이벤트 버스)·결과 비교(지금/바뀐 뒤 격리 iframe·바뀐 코드)·적용(한 거래·울타리 벗김)·취소·다시 요청을 본다.
// 실제 키 입력의 포커스(입력 칸 ↔ 편집기)와 ⌘Z 되돌리기는 E2E(@input)가 본다.
describe('HTML 블록 AI로 고치기', () => {
  const ITEM = { path: 'h1#t', tag: 'h1', kind: '제목', text: '3분기 회고', html: '<h1 id="t">3분기 회고</h1>', rect: { x: 0, y: 0, width: 10, height: 10 } }
  const tokenOf = (iframe: HTMLIFrameElement) => /var TOKEN="([^"]+)"/.exec(iframe.getAttribute('srcdoc') ?? '')?.[1]
  const NEW_SOURCE = '<canvas id="c2"></canvas>\n<script>draw("4분기")</script>'

  /** 노트 편집 화면처럼 AI 컨텍스트로 감싼 편집기 — commit 은 바로 넣는다(핸드셰이크는 aiApplyHandshake.test). */
  async function mountAi(markdown = BODY, editable = true) {
    const ai: WikiHtmlEmbedAi = { pageId: 77, commit: vi.fn(async (insert: () => void) => (insert(), true)), onResult: vi.fn() }
    let ed: Editor | null = null
    render(
      <WikiHtmlEmbedAiProvider value={ai}>
        <Body markdown={markdown} editable={editable} onEditor={(e) => (ed = e)} />
      </WikiHtmlEmbedAiProvider>,
    )
    await waitFor(() => expect(ed).not.toBeNull())
    return { ed: ed!, ai }
  }

  /** /ai 시작 요청을 모으고 correlationId 를 돌려준다. 취소(DELETE)도 모은다. */
  function mockAi() {
    const starts: Array<Record<string, unknown>> = []
    const cancels: string[] = []
    server.use(
      http.post('/api/v1/wiki/pages/:id/ai', async ({ request, params }) => {
        starts.push({ pageId: params.id, ...((await request.json()) as Record<string, unknown>) })
        return HttpResponse.json({ correlationId: `corr-${starts.length}` })
      }),
      http.delete('/api/v1/wiki/pages/:id/ai/:cid', ({ params }) => {
        cancels.push(String(params.cid))
        return new HttpResponse(null, { status: 200 })
      }),
    )
    return { starts, cancels }
  }

  const input = () => screen.getByTestId('wiki-html-embed-ai-input') as HTMLTextAreaElement
  const openPanel = () => fireEvent.click(screen.getByTestId('wiki-html-embed-ai-toggle'))
  const stream = (cid: string, ...chunks: string[]) =>
    act(() => {
      for (const text of chunks) emitAiStreamEvent('wiki.ai.delta', { correlationId: cid, text })
      emitAiStreamEvent('wiki.ai.done', { correlationId: cid })
    })

  it('AI 컨텍스트가 있는 편집 화면에서만 막대 맨 앞(이름표 다음)에 보이고, 보기 전용이면 없다', async () => {
    const { ed } = await mountAi()
    const bar = await screen.findByTestId('wiki-html-embed-bar')
    const buttons = Array.from(bar.querySelectorAll(':scope > button')).map((b) => b.getAttribute('data-testid'))
    expect(buttons.slice(0, 3)).toEqual(['wiki-html-embed-label', 'wiki-html-embed-ai-toggle', 'wiki-html-embed-toggle'])
    expect(screen.getByTestId('wiki-html-embed-ai-toggle')).toHaveTextContent('AI로 고치기')
    expect(screen.getByTestId('wiki-html-embed-ai-toggle').style.getPropertyPriority('display')).toBe('important')
    act(() => ed.setEditable(false))
    await waitFor(() => expect(screen.queryByTestId('wiki-html-embed-ai-toggle')).not.toBeInTheDocument())
  })

  it('누르면 블록 아래 입력 칸이 열려 포커스를 받고, Esc 는 쓴 글을 남긴 채 닫고 블록 통째 선택으로 돌아간다', async () => {
    const { ed } = await mountAi(BODY + '\n\n뒤 문단')
    const block = await screen.findByTestId('wiki-html-embed')
    openPanel()
    const panel = screen.getByTestId('wiki-html-embed-ai')
    expect(block).toHaveAttribute('data-ai-open')
    expect(screen.getByTestId('wiki-html-embed-ai-toggle')).toHaveAttribute('aria-pressed', 'true')
    expect(document.activeElement).toBe(input())
    // 노트 CSS 가 숨기지 못하게 칸·입력이 고정된다.
    expect(panel.style.getPropertyPriority('display')).toBe('important')
    expect(input().style.getPropertyPriority('display')).toBe('important')
    // 요청 칩 다섯 가지.
    expect(within(panel).getAllByRole('button').map((b) => b.textContent).slice(0, 5)).toEqual(['값 바꾸기', '색 바꾸기', '제목 바꾸기', '항목 추가', '꺾은선으로'])

    fireEvent.change(input(), { target: { value: '제목을 4분기로' } })
    fireEvent.keyDown(input(), { key: 'Escape' })
    expect(screen.queryByTestId('wiki-html-embed-ai')).not.toBeInTheDocument()
    expect(block).not.toHaveAttribute('data-ai-open')
    expect(ed.state.selection).toBeInstanceOf(NodeSelection)
    expect(ed.state.selection.from).toBe(embedTextPos(ed) - 1)

    openPanel()
    expect(input().value).toBe('제목을 4분기로')
  })

  it('요청 칩은 입력 칸에 시작 말을 채운다 — 쓴 글은 뒤에 남는다', async () => {
    await mountAi()
    await screen.findByTestId('wiki-html-embed')
    openPanel()
    fireEvent.click(screen.getByTestId('wiki-html-embed-ai-chip-color'))
    expect(input().value).toBe('색을 이렇게 바꿔 줘: ')
    fireEvent.change(input(), { target: { value: '막대를 빨강으로' } })
    fireEvent.click(screen.getByTestId('wiki-html-embed-ai-chip-title'))
    expect(input().value).toBe('제목을 이렇게 바꿔 줘: 막대를 빨강으로')
  })

  it('고른 요소 칩은 칸이 열리면 칸 안으로 옮겨 가고(한곳에만), Enter 로 보낸 요청에 고른 요소·지금 소스·지시가 실린다', async () => {
    const { starts } = mockAi()
    await mountAi()
    const iframe = await waitFor(frame)
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', { data: { type: 'wp-html-picker', token: tokenOf(iframe), event: 'state', enabled: true, items: [ITEM] }, source: iframe.contentWindow }),
      )
    })
    expect(screen.getAllByTestId('wiki-html-embed-chip')).toHaveLength(1)
    openPanel()
    const panel = screen.getByTestId('wiki-html-embed-ai')
    expect(screen.getAllByTestId('wiki-html-embed-chip')).toHaveLength(1)
    expect(within(panel).getByTestId('wiki-html-embed-chip')).toHaveTextContent('1제목 · 3분기 회고')
    expect(input()).toHaveAttribute('placeholder', '고른 부분을 어떻게 고칠까요?')

    fireEvent.change(input(), { target: { value: '제목을 4분기로' } })
    // Shift+Enter 는 줄바꿈 — 보내지 않는다. 조합 중 Enter 도 보내지 않는다.
    fireEvent.keyDown(input(), { key: 'Enter', shiftKey: true })
    fireEvent.keyDown(input(), { key: 'Enter', isComposing: true })
    fireEvent.keyDown(input(), { key: 'Enter' })
    await waitFor(() => expect(starts).toHaveLength(1))
    expect(starts[0]).toEqual({
      pageId: '77',
      action: 'fix_html',
      selection: SOURCE,
      prompt: '제목을 4분기로',
      targets: ['선택자: h1#t\n태그: h1\n종류: 제목\n글자: 3분기 회고\nHTML: <h1 id="t">3분기 회고</h1>'],
    })
    expect(screen.getByTestId('wiki-html-embed-ai-running')).toHaveTextContent('AI가 고치는 중…')
  })

  it('고른 요소가 없으면 targets 없이 블록 전체로 보내고, 고치는 중 「취소」는 스트림을 끊고 입력으로 돌아간다', async () => {
    const { starts, cancels } = mockAi()
    await mountAi()
    await screen.findByTestId('wiki-html-embed')
    openPanel()
    expect(screen.getByTestId('wiki-html-embed-ai-send')).toBeDisabled()
    fireEvent.change(input(), { target: { value: '색을 파랑으로' } })
    fireEvent.click(screen.getByTestId('wiki-html-embed-ai-send'))
    await waitFor(() => expect(starts).toHaveLength(1))
    expect(starts[0]).not.toHaveProperty('targets')
    // 시작 응답이 와 구독이 붙은 뒤 델타가 받은 글자 수로 보인다.
    await waitFor(() => {
      act(() => emitAiStreamEvent('wiki.ai.delta', { correlationId: 'corr-1', text: '<p>' }))
      expect(screen.getByTestId('wiki-html-embed-ai-running')).toHaveTextContent('자 받음')
    })
    fireEvent.click(screen.getByTestId('wiki-html-embed-ai-stop'))
    await waitFor(() => expect(cancels).toEqual(['corr-1']))
    expect(screen.queryByTestId('wiki-html-embed-ai-running')).not.toBeInTheDocument()
    expect(input().value).toBe('색을 파랑으로')
  })

  it('결과는 지금/바뀐 뒤 격리 미리보기(고르기 스크립트 없음)와 바뀐 코드로 보이고, 「취소」는 블록을 그대로 둔다', async () => {
    mockAi()
    const { ed, ai } = await mountAi()
    await screen.findByTestId('wiki-html-embed')
    openPanel()
    fireEvent.change(input(), { target: { value: '4분기로' } })
    fireEvent.keyDown(input(), { key: 'Enter' })
    await waitFor(() => {
      stream('corr-1', '```html\n', NEW_SOURCE, '\n```')
      expect(screen.getByTestId('wiki-html-embed-ai-result')).toBeInTheDocument()
    })
    expect(ai.onResult).toHaveBeenCalled()
    const before = screen.getByTestId('wiki-html-embed-ai-before-frame')
    const after = screen.getByTestId('wiki-html-embed-ai-after-frame')
    expect(within(screen.getByTestId('wiki-html-embed-ai-before')).getByText('지금')).toBeInTheDocument()
    expect(within(screen.getByTestId('wiki-html-embed-ai-after')).getByText('바뀐 뒤')).toBeInTheDocument()
    for (const f of [before, after]) {
      expect(f.getAttribute('sandbox')).toContain('allow-scripts')
      expect(f.getAttribute('sandbox')).not.toContain('allow-same-origin')
      expect(f.getAttribute('srcdoc')).not.toContain('data-wp-html-picker')
    }
    expect(before.getAttribute('srcdoc')).toContain(SOURCE)
    // 울타리를 벗긴 소스.
    expect(after.getAttribute('srcdoc')).toContain(NEW_SOURCE)
    expect(after.getAttribute('srcdoc')).not.toContain('```')

    const toggle = screen.getByTestId('wiki-html-embed-ai-code-toggle')
    expect(toggle).toHaveTextContent('바뀐 코드 보기 ▾')
    expect(toggle).toHaveTextContent('+2 −3')
    fireEvent.click(toggle)
    const diff = screen.getByTestId('wiki-html-embed-ai-diff')
    expect(within(diff).getAllByText(/^\+ /).map((l) => l.textContent)).toEqual(['+ <canvas id="c2"></canvas>', '+ <script>draw("4분기")</script>'])
    expect(diff.querySelectorAll('[data-kind="removed"]')).toHaveLength(3)

    fireEvent.click(screen.getByTestId('wiki-html-embed-ai-discard'))
    expect(screen.queryByTestId('wiki-html-embed-ai-result')).not.toBeInTheDocument()
    expect(embedSources(ed)).toEqual([SOURCE])
    expect(ai.commit).not.toHaveBeenCalled()
    expect(input().value).toBe('4분기로')
  })

  it('「적용」은 다듬은 결과로 소스를 한 거래에 바꾸고(AI 넣기 길), 칸을 닫아 블록을 통째 선택한다 — 지시는 비운다', async () => {
    mockAi()
    const { ed, ai } = await mountAi()
    await screen.findByTestId('wiki-html-embed')
    openPanel()
    fireEvent.change(input(), { target: { value: '4분기로' } })
    fireEvent.keyDown(input(), { key: 'Enter' })
    await waitFor(() => {
      stream('corr-1', `\n${NEW_SOURCE}\r\n`)
      expect(screen.getByTestId('wiki-html-embed-ai-apply')).toBeInTheDocument()
    })
    let docChanges = 0
    const onTr = ({ transaction }: { transaction: { docChanged: boolean } }) => {
      if (transaction.docChanged) docChanges++
    }
    ed.on('transaction', onTr)
    fireEvent.click(screen.getByTestId('wiki-html-embed-ai-apply'))
    await waitFor(() => expect(embedSources(ed)).toEqual([NEW_SOURCE]))
    ed.off('transaction', onTr)
    expect(docChanges).toBe(1)
    expect(ai.commit).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('wiki-html-embed-ai')).not.toBeInTheDocument()
    expect(ed.state.selection).toBeInstanceOf(NodeSelection)
    openPanel()
    expect(input().value).toBe('')
  })

  it('「다시 요청」은 고친 지시로 다시 보낸다 — 오류 이벤트는 칸에 알린다', async () => {
    const { starts } = mockAi()
    await mountAi()
    await screen.findByTestId('wiki-html-embed')
    openPanel()
    fireEvent.change(input(), { target: { value: '꺾은선으로' } })
    fireEvent.keyDown(input(), { key: 'Enter' })
    await waitFor(() => {
      stream('corr-1', NEW_SOURCE)
      expect(screen.getByTestId('wiki-html-embed-ai-retry')).toBeInTheDocument()
    })
    fireEvent.change(input(), { target: { value: '꺾은선으로, 점 표시' } })
    fireEvent.click(screen.getByTestId('wiki-html-embed-ai-retry'))
    await waitFor(() => expect(starts).toHaveLength(2))
    expect(starts[1]).toMatchObject({ action: 'fix_html', prompt: '꺾은선으로, 점 표시', selection: SOURCE })
    await waitFor(() => {
      act(() => emitAiStreamEvent('wiki.ai.error', { correlationId: 'corr-2', message: 'AI 비서가 설정되지 않았습니다' }))
      expect(screen.getByTestId('wiki-html-embed-ai-error')).toHaveTextContent('AI 비서가 설정되지 않았습니다')
    })
  })

  it('결과를 보는 동안 소스가 바뀌면 알리고, 「지금」 미리보기는 요청 때 소스 그대로 둔다(다시 만들지 않는다)', async () => {
    mockAi()
    const { ed } = await mountAi()
    await screen.findByTestId('wiki-html-embed')
    openPanel()
    fireEvent.change(input(), { target: { value: '4분기로' } })
    fireEvent.keyDown(input(), { key: 'Enter' })
    await waitFor(() => {
      stream('corr-1', NEW_SOURCE)
      expect(screen.getByTestId('wiki-html-embed-ai-result')).toBeInTheDocument()
    })
    const before = screen.getByTestId('wiki-html-embed-ai-before-frame')
    expect(screen.queryByTestId('wiki-html-embed-ai-stale')).not.toBeInTheDocument()
    // 동료·내 편집처럼 블록 소스에 글자가 들어온다.
    act(() => {
      ed.commands.insertContentAt(embedTextPos(ed), '<!-- x -->')
    })
    expect(screen.getByTestId('wiki-html-embed-ai-stale')).toBeInTheDocument()
    expect(screen.getByTestId('wiki-html-embed-ai-before-frame')).toBe(before)
    expect(before.getAttribute('srcdoc')).toContain(SOURCE)
    expect(before.getAttribute('srcdoc')).not.toContain('<!-- x -->')
  })

  it('빈 결과는 적용하지 않고 다시 요청하라고 알린다', async () => {
    mockAi()
    await mountAi()
    await screen.findByTestId('wiki-html-embed')
    openPanel()
    fireEvent.change(input(), { target: { value: 'x' } })
    fireEvent.keyDown(input(), { key: 'Enter' })
    await waitFor(() => {
      stream('corr-1', '```html\n```')
      expect(screen.getByTestId('wiki-html-embed-ai-error')).toHaveTextContent('빈 결과')
    })
    expect(screen.queryByTestId('wiki-html-embed-ai-apply')).not.toBeInTheDocument()
  })
})
