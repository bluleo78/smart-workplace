// RichInput 컴포넌트 테스트 두 가지. (1) 본문 모드(WP-1656) — 이슈 본문 편집칸으로 쓸 때의 키·이미지 크기·원문 알림·업로드 알림·붙여넣기·실행 취소와,
// 본문 모드가 아닌 코멘트 입력창이 그대로인지(썸네일·Enter 전송)를 본다. 실제 키 입력·클립보드·레이아웃은 E2E(@input·@layout)가 본다.
// (2) 보내기 버튼 전송 중 표시(WP-1860) — onSubmit Promise 대기 중 스피너·aria-busy, 끝나면(성공·실패) 걷힘, 단순 비활성엔 스피너 없음(디자인 시스템 06 §A-3).
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import type { Editor, JSONContent } from '@tiptap/core'
import { closeHistory } from '@tiptap/pm/history'
import { createRef } from 'react'
import { toast } from 'sonner'
import { describe, expect, it, onTestFinished, vi } from 'vitest'

import { editorOf } from '@/test/kits/richEditor'
import { renderWithProviders } from '@/test/renderWithProviders'

import { OTHER_PROJECT_IMAGE, WP_IMAGE } from './__fixtures__/issueBodySamples'
import { bodyToDoc } from './mentionSerialize'
import { RichInput, type RichInputHandle } from './RichInput'
import { COMPOSITION_POLL_MS, COMPOSITION_SETTLE_MS } from './waitCompositionIdle'

// 인증 이미지 요청은 끊고 고정 blob 주소를 준다 — 이미지가 다 받아진 상태의 <img> 클래스를 보려고.
vi.mock('@/hooks/queries/useApiBlobUrl', () => ({
  useApiBlobUrl: (path: string | null | undefined) => ({ url: path ? 'blob:fixed' : null, isError: false, blob: null }),
}))

const INPUT = 'body-input'

type Props = Partial<Parameters<typeof RichInput>[0]>

/** 본문 모드 RichInput 을 띄운다 — 업로드 함수는 기본으로 끝나지 않는 Promise(필요한 테스트가 바꾼다). */
function renderBody(props: Props = {}) {
  const handlers = {
    onSubmit: vi.fn(),
    onCancel: vi.fn(),
    onBodyChange: vi.fn(),
    onUploadingChange: vi.fn(),
  }
  const ref = createRef<RichInputHandle>()
  const view = renderWithProviders(
    <RichInput
      members={[]}
      ariaLabel="이슈 본문"
      inputTestId={INPUT}
      submitTestId="body-submit"
      cancelTestId="body-cancel"
      bodyMode={{ projectKey: 'WP' }}
      imageUpload={() => new Promise(() => {})}
      ref={ref}
      {...handlers}
      {...props}
    />,
  )
  return { ...handlers, ref, el: screen.getByTestId(INPUT), unmount: view.unmount }
}

/** 마지막 호출 인자. */
function lastArg<T>(fn: { mock: { calls: T[][] } }): T | undefined {
  return fn.mock.calls.at(-1)?.[0]
}

describe('RichInput 본문 모드', () => {
  it('Enter 는 onSubmit·onCancel 을 부르지 않는다(줄바꿈)', () => {
    const { el, onSubmit, onCancel } = renderBody({ initialBody: '한 줄' })
    fireEvent.keyDown(el, { key: 'Enter' })
    expect(onSubmit).not.toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()
  })

  it.each([
    ['Meta+Enter', { metaKey: true }],
    ['Control+Enter', { ctrlKey: true }],
  ])('%s 는 다듬지 않은 원문(끝 줄바꿈 포함)으로 onSubmit', (_name, mods) => {
    const { el, onSubmit } = renderBody({ initialBody: '  앞 공백\n끝 줄바꿈\n\n' })
    fireEvent.keyDown(el, { key: 'Enter', ...mods })
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith('  앞 공백\n끝 줄바꿈\n\n')
  })

  it('바뀐 것이 없어도 onCancel 로 줄이지 않고 onSubmit 을 부른다(바깥이 판단)', () => {
    const { el, onSubmit, onCancel } = renderBody({ initialBody: 'a' })
    fireEvent.keyDown(el, { key: 'Enter', ctrlKey: true })
    expect(onSubmit).toHaveBeenCalledWith('a')
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('Esc 는 onCancel', () => {
    const { el, onCancel } = renderBody({ initialBody: 'a' })
    fireEvent.keyDown(el, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('편집칸만 그린다 — 버튼 줄·전송·취소·이미지 버튼이 없다', () => {
    renderBody({ initialBody: 'a', maxLength: 10 })
    expect(screen.queryByTestId('body-submit')).toBeNull()
    expect(screen.queryByTestId('body-cancel')).toBeNull()
    expect(screen.queryByTestId(`${INPUT}-image`)).toBeNull()
    expect(screen.queryByTestId('char-count')).toBeNull()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  it('frame bare 면 테두리·안쪽 여백·최소 160px 없이 3줄 높이(min-h-[4.5rem])·text-base', () => {
    const { el } = renderBody({ bodyMode: { projectKey: 'WP', frame: 'bare' } })
    const cls = el.className.split(/\s+/)
    expect(cls).toContain('min-h-[4.5rem]')
    expect(cls).toContain('text-base')
    expect(cls).not.toContain('border')
    expect(cls).not.toContain('min-h-40')
    expect(cls).not.toContain('px-3')
  })

  it('frame 을 주지 않으면 지금 모양(min-h-40·border)', () => {
    const { el } = renderBody()
    const cls = el.className.split(/\s+/)
    expect(cls).toContain('min-h-40')
    expect(cls).toContain('border-input')
    expect(cls).toContain('px-3')
  })

  it('이 프로젝트 이미지 줄은 보기 화면과 같은 크기 클래스의 이미지(썸네일 아님)', async () => {
    renderBody({ initialBody: `위\n![화면](${WP_IMAGE})\n아래` })
    const node = await screen.findByTestId('rich-image')
    const img = await waitFor(() => {
      const found = node.querySelector('img')
      if (!found) throw new Error('이미지가 아직 없다')
      return found
    })
    expect(img).toHaveClass('block', 'h-auto', 'max-h-[480px]', 'max-w-full')
    expect(img).not.toHaveClass('h-14')
    expect(img).toHaveAttribute('alt', '화면')
  })

  it('다른 프로젝트 이미지 줄은 글자로 남는다', () => {
    const { el } = renderBody({ initialBody: `![남의 것](${OTHER_PROJECT_IMAGE})` })
    expect(screen.queryByTestId('rich-image')).toBeNull()
    expect(el).toHaveTextContent(`![남의 것](${OTHER_PROJECT_IMAGE})`)
  })

  it('내용을 바꾸면 onBodyChange 가 다듬지 않은 원문으로 불린다', () => {
    const { el, onBodyChange } = renderBody({ initialBody: 'a' })
    act(() => {
      editorOf(el).commands.setContent(bodyToDoc('  새 본문\n\n', []), true)
    })
    expect(lastArg(onBodyChange)).toBe('  새 본문\n\n')
  })

  it('원문이 그대로인 문서 변경(멘션 이름표만 바뀜)에는 onBodyChange 를 다시 부르지 않는다', () => {
    const { el, onBodyChange } = renderBody({ initialBody: '담당 <@7>', initialMentions: [{ id: 7, name: '김개발', kind: 'HUMAN' }] })
    const editor = editorOf(el)
    act(() => {
      editor.commands.insertContentAt(editor.state.doc.content.size - 1, '.')
    })
    expect(onBodyChange).toHaveBeenCalledTimes(1)
    expect(lastArg(onBodyChange)).toBe('담당 <@7>.')
    act(() => {
      let at = -1
      editor.state.doc.descendants((n, pos) => {
        if (n.type.name === 'mention') at = pos
      })
      const mention = editor.state.doc.nodeAt(at)!
      editor.view.dispatch(editor.state.tr.setNodeMarkup(at, undefined, { ...mention.attrs, label: '다른 이름' }))
    })
    expect(onBodyChange).toHaveBeenCalledTimes(1)
  })

  it('insertImages 는 업로드 중 onUploadingChange(true), 끝나면 false 와 원문에 ![이름](url)', async () => {
    let finish: (v: { url: string; name: string }) => void = () => {}
    const imageUpload = vi.fn(() => new Promise<{ url: string; name: string }>((resolve) => (finish = resolve)))
    const { ref, onUploadingChange, onBodyChange, onSubmit, el } = renderBody({ initialBody: '위', imageUpload })
    const png = new File(['x'], 'shot.png', { type: 'image/png' })

    act(() => ref.current?.insertImages([png]))
    expect(imageUpload).toHaveBeenCalledWith(png)
    expect(lastArg(onUploadingChange)).toBe(true)
    // 업로드 중엔 Cmd/Ctrl+Enter 도 막힌다 — 자리표시가 빈 이미지로 저장되지 않게.
    fireEvent.keyDown(el, { key: 'Enter', ctrlKey: true })
    expect(onSubmit).not.toHaveBeenCalled()

    await act(async () => finish({ url: '/api/v1/projects/WP/issue-images/9', name: 'shot.png' }))
    expect(lastArg(onUploadingChange)).toBe(false)
    expect(lastArg(onBodyChange)).toContain('![shot.png](/api/v1/projects/WP/issue-images/9)')
  })

  it('일반 글자 붙여넣기는 HTML 이 함께 와도 글자만, 줄마다 문단 — 커서 앞뒤 글자에 이어진다', () => {
    const { el, onBodyChange } = renderBody({ initialBody: 'ab' })
    const editor = editorOf(el)
    act(() => {
      editor.commands.setTextSelection(2) // 「a」 와 「b」 사이
    })
    const text = '첫\n\n| 표 |\r\n|---|\n마지막'
    const clipboardData = {
      getData: (type: string) => (type === 'text/plain' ? text : type === 'text/html' ? '<p><b>첫</b></p><p>마지막</p>' : ''),
      types: ['text/plain', 'text/html'],
      files: [] as unknown as FileList,
      items: [] as unknown as DataTransferItemList,
    }
    act(() => {
      fireEvent.paste(el, { clipboardData })
    })
    expect(lastArg(onBodyChange)).toBe('a첫\n\n| 표 |\n|---|\n마지막b')
    expect(editor.getJSON().content?.[0]).toEqual({ type: 'paragraph', content: [{ type: 'text', text: 'a첫' }] })
  })

  it('Ctrl+Z 는 실행 취소, Ctrl+Shift+Z 는 다시 하기', () => {
    const { el, onBodyChange } = renderBody({ initialBody: 'a' })
    const editor = editorOf(el)
    act(() => {
      editor.commands.insertContentAt(2, 'b')
    })
    expect(lastArg(onBodyChange)).toBe('ab')
    act(() => {
      fireEvent.keyDown(el, { key: 'z', keyCode: 90, ctrlKey: true })
    })
    expect(lastArg(onBodyChange)).toBe('a')
    act(() => {
      // Shift 를 누르면 key 는 대문자 Z — 브라우저처럼 keyCode(90)를 실어야 keymap 이 z 바인딩으로 찾는다.
      fireEvent.keyDown(el, { key: 'Z', keyCode: 90, ctrlKey: true, shiftKey: true })
    })
    expect(lastArg(onBodyChange)).toBe('ab')
  })

  it('업로드가 끝난 뒤 실행 취소는 이미지 넣기를 되돌린다 — 「업로드 중」 자리표시로 돌아가지 않는다', async () => {
    let finish: (v: { url: string; name: string }) => void = () => {}
    const imageUpload = vi.fn(() => new Promise<{ url: string; name: string }>((resolve) => (finish = resolve)))
    const { ref, el, onUploadingChange, onBodyChange } = renderBody({ initialBody: '위', imageUpload })
    act(() => ref.current?.insertImages([new File(['x'], 'shot.png', { type: 'image/png' })]))
    await act(async () => finish({ url: '/api/v1/projects/WP/issue-images/9', name: 'shot.png' }))
    act(() => {
      fireEvent.keyDown(el, { key: 'z', keyCode: 90, ctrlKey: true })
    })
    expect(lastArg(onUploadingChange)).toBe(false)
    expect(lastArg(onBodyChange)).not.toContain('issue-images')
    expect(screen.queryByTestId('rich-image')).toBeNull()
  })

  it('지운 업로드 자리표시를 실행 취소로 되살려도 끝난 업로드 결과로 다시 채워 업로드 중으로 남지 않는다', async () => {
    let finish: (v: { url: string; name: string }) => void = () => {}
    const imageUpload = vi.fn(() => new Promise<{ url: string; name: string }>((resolve) => (finish = resolve)))
    const { ref, el, onUploadingChange, onBodyChange } = renderBody({ initialBody: '위', imageUpload })
    const editor = editorOf(el)
    act(() => ref.current?.insertImages([new File(['x'], 'shot.png', { type: 'image/png' })]))
    // 업로드 중 자리표시를 지운다(따로 되돌릴 수 있게 실행 취소 묶음을 끊는다).
    act(() => {
      let at = -1
      editor.state.doc.descendants((n, pos) => {
        if (n.type.name === 'image') at = pos
      })
      editor.view.dispatch(closeHistory(editor.state.tr.delete(at, at + 1)))
    })
    expect(lastArg(onUploadingChange)).toBe(false)
    await act(async () => finish({ url: '/api/v1/projects/WP/issue-images/9', name: 'shot.png' }))
    act(() => {
      fireEvent.keyDown(el, { key: 'z', keyCode: 90, ctrlKey: true })
    })
    expect(lastArg(onUploadingChange)).toBe(false)
    expect(lastArg(onBodyChange)).toContain('![shot.png](/api/v1/projects/WP/issue-images/9)')
  })
})

/**
 * 마지막 글자 하나를 브라우저 타이핑처럼 넣는다 — ProseMirror 가 handleTextInput(입력 규칙 플러그인이 받는 자리)을 먼저 부르고,
 * 아무도 처리하지 않으면 그 글자를 그대로 넣는다(jsdom 은 contenteditable 입력을 처리하지 못해 직접 흉내 낸다).
 */
function typeChar(editor: Editor, ch: string) {
  act(() => {
    const { view } = editor
    const { from, to } = view.state.selection
    // 다섯째 인자는 기본 처리 트랜잭션을 만드는 함수(prosemirror-view 와 같은 모양).
    const insert = () => view.state.tr.insertText(ch, from, to)
    const handled = view.someProp('handleTextInput', (f) => f(view, from, to, ch, insert))
    if (!handled) view.dispatch(insert())
  })
}

/** 문서 안 image 노드 수. */
function imageCount(editor: Editor): number {
  let n = 0
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'image') n += 1
  })
  return n
}

// 멘션 자동완성(WP-1656 최종 검토) — 본문에는 @Override·@media·@types/node 처럼 멤버가 아닌 @단어가 흔하다.
// 맞는 멤버가 없으면(팝업이 비어 보이지 않음) Enter·Esc·Cmd/Ctrl+Enter 는 평소처럼 줄바꿈·취소·저장이다. 맞는 멤버가 있으면 팝업이 먼저다.
describe('RichInput 본문 모드 — @단어와 멘션 팝업', () => {
  const MEMBER = { userId: 7, username: 'kim', name: '김개발', kind: 'HUMAN' as const }

  /** 편집칸 끝에 text 를 넣고 멘션 자동완성(비동기 시작)이 자리 잡을 때까지 기다린다. */
  async function typeAtEnd(editor: Editor, text: string) {
    await act(async () => {
      editor.commands.focus('end')
      editor.commands.insertContent(text)
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30))
    })
  }

  it.each(['@Override', '@types/node'])('맞는 멤버가 없는 %s 뒤 Enter 는 줄을 바꾼다', async (word) => {
    const { el, onCancel, onSubmit } = renderBody({ initialBody: '첫 줄' })
    const editor = editorOf(el)
    await typeAtEnd(editor, ` ${word}`)
    act(() => {
      fireEvent.keyDown(el, { key: 'Enter' })
    })
    expect(editor.getJSON().content).toHaveLength(2)
    expect(onCancel).not.toHaveBeenCalled()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('맞는 멤버가 없는 @단어 뒤 Esc 는 onCancel, Ctrl+Enter 는 그 원문으로 onSubmit', async () => {
    const { el, onCancel, onSubmit } = renderBody({ initialBody: '첫 줄' })
    await typeAtEnd(editorOf(el), ' @Transactional')
    act(() => {
      fireEvent.keyDown(el, { key: 'Enter', ctrlKey: true })
    })
    expect(onSubmit).toHaveBeenCalledWith('첫 줄 @Transactional')
    act(() => {
      fireEvent.keyDown(el, { key: 'Escape' })
    })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('맞는 멤버가 있으면 Enter 는 그 멤버를 고른다(줄바꿈 아님)', async () => {
    const { el, onBodyChange } = renderBody({ initialBody: '첫 줄', members: [MEMBER] })
    const editor = editorOf(el)
    await typeAtEnd(editor, ' @김')
    expect(screen.getByTestId('chat-mention-popover')).toBeInTheDocument()
    act(() => {
      fireEvent.keyDown(el, { key: 'Enter' })
    })
    expect(editor.getJSON().content).toHaveLength(1)
    expect(lastArg(onBodyChange)).toContain('<@7>')
  })

  it('조합 확정 Enter(검색어가 막 후보가 생기는 값이 된 직후)는 줄바꿈하지 않고, 목록이 따라오면 Enter 로 후보를 고른다 (WP-2124)', async () => {
    const { el, onBodyChange } = renderBody({ initialBody: '첫 줄', members: [MEMBER] })
    const editor = editorOf(el)
    // 조합 중 글자 'ㄱ' — 맞는 멤버가 없어 후보가 안 보인다(live=false).
    await typeAtEnd(editor, ' @ㄱ')
    expect(screen.queryByTestId('chat-mention-popover')).toBeNull()
    // 조합 확정 Enter 흉내: 글자 바꾸기와 Enter 를 await 없이 한 act 안에서 보내 onUpdate(live 갱신) 전에 Enter 가 닿게 한다.
    await act(async () => {
      const to = editor.state.selection.from
      editor.chain().insertContentAt({ from: to - 1, to }, '김').run()
      fireEvent.keyDown(el, { key: 'Enter' })
    })
    expect(editor.getJSON().content).toHaveLength(1) // 줄바꿈이 아니다
    // 목록이 따라오면 다음 Enter 가 그 후보를 고른다.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30))
    })
    await act(async () => {
      fireEvent.keyDown(el, { key: 'Enter' })
    })
    expect(editor.getJSON().content).toHaveLength(1)
    expect(JSON.stringify(editor.getJSON())).toContain('mention')
    expect(lastArg(onBodyChange)).toContain('<@7>')
  })

  it('검색어가 막 후보가 생기는 값이 된 직후(목록 갱신 전) Esc 는 본문 편집을 취소하지 않고 팝업만 닫는다 (WP-2124 리뷰 후속)', async () => {
    const { el, onCancel } = renderBody({ initialBody: '첫 줄', members: [MEMBER] })
    const editor = editorOf(el)
    // 'ㄱ' — 맞는 멤버가 없어 목록(live)은 비어 있다.
    await typeAtEnd(editor, ' @ㄱ')
    expect(screen.queryByTestId('chat-mention-popover')).toBeNull()
    // 검색어가 '김'(후보 있음)이 된 직후, 목록이 따라오기 전에 Esc — live 로 판정하면 취소로 간다.
    await act(async () => {
      const to = editor.state.selection.from
      editor.chain().insertContentAt({ from: to - 1, to }, '김').run()
      fireEvent.keyDown(el, { key: 'Escape' })
    })
    expect(onCancel).not.toHaveBeenCalled()
    // 팝업은 닫힌 채(dismissed)라 목록이 따라와도 다음 Enter 는 후보를 고르지 않고 줄바꿈한다.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30))
    })
    await act(async () => {
      fireEvent.keyDown(el, { key: 'Enter' })
    })
    expect(editor.getJSON().content).toHaveLength(2)
    expect(JSON.stringify(editor.getJSON())).not.toContain('mention')
  })

  it('보이던 후보가 맞지 않게 된 직후(목록 갱신 전) Esc 도 본문 편집을 취소하지 않고 팝업만 닫는다 (WP-2124 리뷰 후속)', async () => {
    const { el, onCancel } = renderBody({ initialBody: '첫 줄', members: [MEMBER] })
    const editor = editorOf(el)
    await typeAtEnd(editor, ' @김')
    expect(screen.getByTestId('chat-mention-popover')).toBeInTheDocument()
    // 검색어가 맞는 멤버가 없는 값이 된 직후, 목록이 따라오기 전에 Esc — 화면엔 앞 후보가 남아 있다.
    await act(async () => {
      editor.commands.insertContent('zzz')
      fireEvent.keyDown(el, { key: 'Escape' })
    })
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('멤버가 목록을 그린 뒤에 와도(같은 검색어, 빈 목록) Enter 는 삼켜지지 않고 줄바꿈한다 (WP-2124 리뷰)', async () => {
    // 멤버 조회가 끝나기 전에 본문을 열어 @ki 를 친다 — 목록은 빈 채로 그려진다.
    const props = {
      members: [],
      ariaLabel: '이슈 본문',
      inputTestId: INPUT,
      submitTestId: 'body-submit',
      bodyMode: { projectKey: 'WP' },
      onSubmit: vi.fn(),
      initialBody: '첫 줄',
    }
    const view = renderWithProviders(<RichInput {...props} />)
    const el = screen.getByTestId(INPUT)
    const editor = editorOf(el)
    await typeAtEnd(editor, ' @ki')
    expect(screen.queryByTestId('chat-mention-popover')).toBeNull()
    // 멤버가 도착한다(검색어는 그대로라 목록은 다시 그려지지 않는다).
    view.rerender(<RichInput {...props} members={[MEMBER]} />)
    await act(async () => {
      fireEvent.keyDown(el, { key: 'Enter' })
    })
    // 삼키면 아무 일도 없다 — 본문 모드 Enter 는 줄바꿈이어야 한다.
    expect(editor.getJSON().content).toHaveLength(2)
  })

  it('맞는 멤버 후보가 보여도 Ctrl/⌘+Enter 는 멘션을 고르지 않고 지금 원문으로 저장한다', async () => {
    const { el, onSubmit, onBodyChange } = renderBody({ initialBody: '첫 줄', members: [MEMBER] })
    await typeAtEnd(editorOf(el), ' @ki')
    expect(screen.getByTestId('chat-mention-popover')).toBeInTheDocument()
    act(() => {
      fireEvent.keyDown(el, { key: 'Enter', ctrlKey: true })
    })
    expect(onSubmit).toHaveBeenCalledWith('첫 줄 @ki')
    expect(lastArg(onBodyChange)).not.toContain('<@7>')
    act(() => {
      fireEvent.keyDown(el, { key: 'Enter', metaKey: true })
    })
    expect(onSubmit).toHaveBeenCalledTimes(2)
    expect(onSubmit).toHaveBeenLastCalledWith('첫 줄 @ki')
  })

  it('맞는 멤버가 있는 팝업에서 Esc 는 팝업만 닫고(취소 아님), 다음 Enter 는 줄바꿈·다음 Esc 는 취소다', async () => {
    const { el, onCancel } = renderBody({ initialBody: '첫 줄', members: [MEMBER] })
    const editor = editorOf(el)
    await typeAtEnd(editor, ' @김')
    act(() => {
      fireEvent.keyDown(el, { key: 'Escape' })
    })
    expect(onCancel).not.toHaveBeenCalled()
    act(() => {
      fireEvent.keyDown(el, { key: 'Enter' })
    })
    expect(editor.getJSON().content).toHaveLength(2)
    act(() => {
      fireEvent.keyDown(el, { key: 'Escape' })
    })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('팝업이 뜨기 전(onStart 전)에 온 Esc 도 본문 편집을 취소하지 않고, 팝업은 닫힌 채 시작한다 (WP-2124 반려)', async () => {
    const { el, onCancel } = renderBody({ initialBody: '첫 줄', members: [MEMBER] })
    const editor = editorOf(el)
    // @김 입력과 Esc 를 await 없이 잇달아 보내 — suggestion 의 onStart(팝업 띄우기)가 돌기 전에 Esc 가 닿는다.
    // (mentionPopupOpenForEsc 만 보면 hide 가 없어 팝업이 없다고 보고 onCancel 이 불려 실패한다.)
    await act(async () => {
      editor.commands.focus('end')
      editor.commands.insertContent(' @김')
      fireEvent.keyDown(el, { key: 'Escape' })
    })
    expect(onCancel).not.toHaveBeenCalled()
    // 그 Esc 는 팝업을 닫은 것이다 — onStart 뒤에도 후보 목록이 뜨지 않는다.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30))
    })
    expect(screen.queryByRole('listbox')).toBeNull()
    // 다음 Esc 는 본문 편집을 취소한다(열린 팝업의 Esc 뒤 두 번째 Esc 와 같은 순서).
    act(() => {
      fireEvent.keyDown(el, { key: 'Escape' })
    })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  // 바깥 모달(개인 작업 상세)이 글 칸 Esc 를 문서 캡처 단계에서 막아도(preventDefault) 편집칸 Esc 는 동작한다 —
  // 팝업이 있으면 팝업만 닫고, 없으면 onCancel.
  describe('바깥이 막은 Esc', () => {
    /** 문서 캡처 단계에서 Esc 를 막는다 — Radix 모달의 onEscapeKeyDown preventDefault 와 같은 자리. */
    function blockEscapeAtDocument() {
      const block = (e: KeyboardEvent) => {
        if (e.key === 'Escape') e.preventDefault()
      }
      document.addEventListener('keydown', block, true)
      onTestFinished(() => document.removeEventListener('keydown', block, true))
    }

    it('팝업이 없으면 onCancel', () => {
      blockEscapeAtDocument()
      const { el, onCancel } = renderBody({ initialBody: '첫 줄' })
      act(() => {
        fireEvent.keyDown(el, { key: 'Escape' })
      })
      expect(onCancel).toHaveBeenCalledTimes(1)
    })

    it('맞는 멤버 팝업이 열려 있으면 팝업만 닫고 취소하지 않는다, 다음 Esc 는 취소', async () => {
      blockEscapeAtDocument()
      const { el, onCancel } = renderBody({ initialBody: '첫 줄', members: [MEMBER] })
      await typeAtEnd(editorOf(el), ' @김')
      act(() => {
        fireEvent.keyDown(el, { key: 'Escape' })
      })
      expect(onCancel).not.toHaveBeenCalled()
      act(() => {
        fireEvent.keyDown(el, { key: 'Escape' })
      })
      expect(onCancel).toHaveBeenCalledTimes(1)
    })

    it('팝업이 뜨기 전(onStart 전)에 온 막힌 Esc 도 취소하지 않고 팝업을 닫힌 채 시작한다, 다음 Esc 는 취소 (WP-2124 반려)', async () => {
      blockEscapeAtDocument()
      const { el, onCancel } = renderBody({ initialBody: '첫 줄', members: [MEMBER] })
      const editor = editorOf(el)
      await act(async () => {
        editor.commands.focus('end')
        editor.commands.insertContent(' @김')
        fireEvent.keyDown(el, { key: 'Escape' })
      })
      expect(onCancel).not.toHaveBeenCalled()
      await act(async () => {
        await new Promise((r) => setTimeout(r, 30))
      })
      expect(screen.queryByRole('listbox')).toBeNull()
      act(() => {
        fireEvent.keyDown(el, { key: 'Escape' })
      })
      expect(onCancel).toHaveBeenCalledTimes(1)
    })

    it('맞는 멤버가 없는 @단어 뒤에서도 onCancel', async () => {
      blockEscapeAtDocument()
      const { el, onCancel } = renderBody({ initialBody: '첫 줄' })
      await typeAtEnd(editorOf(el), ' @할일')
      act(() => {
        fireEvent.keyDown(el, { key: 'Escape' })
      })
      expect(onCancel).toHaveBeenCalledTimes(1)
    })
  })
})

// 업로드 실패(WP-1656) — 옛 Textarea 처럼 자리표시와 함께 넣은 줄 나눔까지 걷어 원문을 넣기 전 그대로 돌린다(줄 가운데·끝 모두).
describe('RichInput 본문 모드 — 업로드 실패는 넣기 전 원문으로', () => {
  /** 업로드가 실패하는 본문 모드 편집칸을 띄우고, 커서를 원문 offset 자리(첫 줄 기준)에 둔다. */
  function renderFailing(initialBody: string, offset: number) {
    let fail: (e: Error) => void = () => {}
    const imageUpload = vi.fn(() => new Promise<{ url: string; name: string }>((_, reject) => (fail = reject)))
    const r = renderBody({ initialBody, imageUpload })
    const editor = editorOf(r.el)
    act(() => {
      editor.commands.setTextSelection(1 + offset)
    })
    return { ...r, editor, fail: (e = new Error('500')) => fail(e) }
  }
  const png = () => new File(['x'], 'shot.png', { type: 'image/png' })

  it.each([
    ['줄 가운데', '재현 화면\n다음 줄', 2],
    ['줄 끝(문서 끝)', '재현 화면', 5],
    ['줄 끝(다음 줄 있음)', '재현 화면\n다음 줄', 5],
    ['줄 처음', '재현 화면\n다음 줄', 0],
    ['빈 줄', '위\n\n아래', 3],
    ['빈 문서', '', 0],
  ])('%s 에 넣은 이미지 업로드가 실패하면 원문이 넣기 전 그대로다', async (_name, body, offset) => {
    const { ref, editor, fail, onBodyChange } = renderFailing(body, offset)
    act(() => ref.current?.insertImages([png()]))
    expect(imageCount(editor)).toBe(1)
    await act(async () => fail())
    expect(imageCount(editor)).toBe(0)
    expect(lastArg(onBodyChange)).toBe(body)
  })

  it('편집칸이 있으면 업로드 실패를 토스트로 알린다', async () => {
    const toastError = vi.spyOn(toast, 'error')
    onTestFinished(() => toastError.mockRestore())
    const { ref, fail } = renderFailing('재현 화면', 5)
    act(() => ref.current?.insertImages([png()]))
    await act(async () => fail())
    expect(toastError).toHaveBeenCalledWith('이미지를 올리지 못했습니다')
  })

  // WP-1657 리뷰: 창을 버려 편집칸이 사라진 뒤 끝난 실패는 알릴 곳(입력칸)이 없으니 토스트도 띄우지 않는다.
  it('업로드 중 편집칸이 사라진 뒤 실패하면 토스트를 띄우지 않는다', async () => {
    const toastError = vi.spyOn(toast, 'error')
    onTestFinished(() => toastError.mockRestore())
    const { ref, fail, unmount, editor } = renderFailing('재현 화면', 5)
    act(() => ref.current?.insertImages([png()]))
    unmount()
    // TipTap 은 언마운트 뒤 타이머 한 번 지나 편집기를 없앤다 — 실제 업로드는 그보다 늦게 끝난다.
    await waitFor(() => expect(editor.isDestroyed).toBe(true))
    await act(async () => fail())
    expect(toastError).not.toHaveBeenCalled()
  })

  // 리뷰(PR #1413): 넣을 때 만든 빈 줄에 친 글자는 앞 줄에 붙이지 않는다 — 자리표시 줄만 걷고 친 줄은 그대로 둔다.
  it('실패 전에 이미지 다음 줄에 친 글자는 그 줄에 남는다(앞 줄에 붙지 않는다)', async () => {
    const { ref, editor, fail, onBodyChange } = renderFailing('재현 화면', 5)
    act(() => ref.current?.insertImages([png()]))
    act(() => {
      editor.commands.insertContent('이어 씀')
    })
    await act(async () => fail())
    expect(imageCount(editor)).toBe(0)
    expect(lastArg(onBodyChange)).toBe('재현 화면\n이어 씀')
  })

  it('함께 넣은 이미지 중 하나만 실패하면 그 이미지만 빠지고 다른 이미지는 남는다', async () => {
    const results: Array<{ resolve: (v: { url: string; name: string }) => void; reject: (e: Error) => void }> = []
    const imageUpload = vi.fn(() => new Promise<{ url: string; name: string }>((resolve, reject) => results.push({ resolve, reject })))
    const { ref, el, onBodyChange } = renderBody({ initialBody: '위', imageUpload })
    act(() => ref.current?.insertImages([png(), png()]))
    await act(async () => results[0].reject(new Error('500')))
    await act(async () => results[1].resolve({ url: '/api/v1/projects/WP/issue-images/9', name: 'b.png' }))
    expect(imageCount(editorOf(el))).toBe(1)
    const body = lastArg(onBodyChange) as string
    expect(body).toContain('위')
    expect(body.match(/!\[/g)).toHaveLength(1)
    expect(body).toContain('![b.png](/api/v1/projects/WP/issue-images/9)')
  })
})

// 함께 넣은 이미지 중 일부만 실패(WP-1656 코드 리뷰) — 실패한 것의 줄만 걷고, 남은 것은 「그것만 넣은 것」과 같은 원문이 된다.
// 자리표시가 「줄을 나눴는가」를 직접 들고 있어(splitTail) 마지막으로 실패한 자리표시가 나눈 줄을 다시 잇는다 — 나눈 뒤쪽 줄이 그대로일 때만.
describe('RichInput 본문 모드 — 함께 넣은 이미지의 일부 실패', () => {
  const png = (name: string) => new File(['x'], name, { type: 'image/png' })
  const url = (id: number) => `/api/v1/projects/WP/issue-images/${id}`
  type Pending = { resolve: (v: { url: string; name: string }) => void; reject: (e: Error) => void }

  /** 원문 body 의 offset 자리(첫 줄 기준)에 files 를 함께 넣는다. 업로드는 테스트가 하나씩 끝낸다(pending[i]). */
  function insertAt(body: string, offset: number, files: File[]) {
    const pending: Pending[] = []
    const imageUpload = vi.fn(() => new Promise<{ url: string; name: string }>((resolve, reject) => pending.push({ resolve, reject })))
    const r = renderBody({ initialBody: body, imageUpload })
    const editor = editorOf(r.el)
    act(() => {
      editor.commands.setTextSelection(1 + offset)
    })
    act(() => r.ref.current?.insertImages(files))
    return { ...r, editor, pending }
  }

  /** 같은 자리에 b.png 하나만 넣어 성공했을 때의 원문 — 비교 기준(그 편집칸은 닫는다). */
  async function onlyB(body: string, offset: number): Promise<string> {
    const { pending, onBodyChange, unmount } = insertAt(body, offset, [png('b.png')])
    await act(async () => pending[0].resolve({ url: url(2), name: 'b.png' }))
    const result = lastArg(onBodyChange) as string
    unmount()
    return result
  }

  it.each([
    ['A 실패 → B 성공', 'A' as const],
    ['B 성공 → A 실패', 'B' as const],
  ])('줄 가운데에 A·B 를 함께 넣고 %s 이면 원문은 B 만 넣은 것과 같다', async (_name, first) => {
    const expected = await onlyB('재현 화면\n다음 줄', 2)
    const { pending, onBodyChange, editor } = insertAt('재현 화면\n다음 줄', 2, [png('a.png'), png('b.png')])
    const failA = async () => act(async () => pending[0].reject(new Error('500')))
    const succeedB = async () => act(async () => pending[1].resolve({ url: url(2), name: 'b.png' }))
    if (first === 'A') {
      await failA()
      await succeedB()
    } else {
      await succeedB()
      await failA()
    }
    expect(imageCount(editor)).toBe(1)
    expect(lastArg(onBodyChange)).toBe(expected)
    expect(expected).toBe(`재현\n![b.png](${url(2)})\n 화면\n다음 줄`)
  })

  it('줄 가운데에 A·B 를 함께 넣고 B 가 실패하면 A 만 넣은 원문이다', async () => {
    const { pending, onBodyChange } = insertAt('재현 화면', 2, [png('a.png'), png('b.png')])
    await act(async () => pending[1].reject(new Error('500')))
    await act(async () => pending[0].resolve({ url: url(1), name: 'a.png' }))
    expect(lastArg(onBodyChange)).toBe(`재현\n![a.png](${url(1)})\n 화면`)
  })

  it.each([
    ['A → B', [0, 1]],
    ['B → A', [1, 0]],
  ])('줄 가운데에 함께 넣은 A·B 가 모두 실패하면(%s) 넣기 전 원문이다', async (_name, order) => {
    const { pending, onBodyChange, editor } = insertAt('재현 화면\n다음 줄', 2, [png('a.png'), png('b.png')])
    for (const i of order) await act(async () => pending[i].reject(new Error('500')))
    expect(imageCount(editor)).toBe(0)
    expect(lastArg(onBodyChange)).toBe('재현 화면\n다음 줄')
  })

  // 리뷰(PR #1413): 나눈 뒤쪽 줄을 고쳤으면 실패해도 잇지 않는다 — 이으면 고친 줄이 앞 줄에 붙어 원문이 바뀐다.
  it('줄 가운데에 넣고 나눈 뒤쪽 줄을 고친 뒤 실패하면 자리표시 줄만 지운다', async () => {
    const { pending, onBodyChange, editor } = insertAt('재현 화면', 2, [png('a.png')])
    act(() => {
      editor.commands.insertContent('!')
    })
    await act(async () => pending[0].reject(new Error('500')))
    expect(imageCount(editor)).toBe(0)
    expect(lastArg(onBodyChange)).toBe('재현\n! 화면')
  })

  it('함께 넣은 A·B 중 A 가 실패한 뒤 나눈 뒤쪽 줄에 글자를 치고 B 도 실패하면 두 줄이 붙지 않는다', async () => {
    const { pending, onBodyChange, editor } = insertAt('abc', 3, [png('a.png'), png('b.png')])
    await act(async () => pending[0].reject(new Error('500')))
    act(() => {
      editor.commands.insertContent('xyz')
    })
    await act(async () => pending[1].reject(new Error('500')))
    expect(imageCount(editor)).toBe(0)
    expect(lastArg(onBodyChange)).toBe('abc\nxyz')
  })

  // PR #1413 2차 검토: A 가 나눈 뒤쪽 줄을 나중에 따로 넣은 B 가 또 나눠도, 글자를 치지 않았으면 A 가 실패할 때 줄을 잇는다.
  describe('따로 넣은 B 가 A 의 뒤쪽 줄을 다시 나눔', () => {
    /** `abc def` 의 `abc|` 에 A, 그 뒤쪽 줄 ` d|ef` 에 B 를 따로 넣는다. pending[0] = A, pending[1] = B. */
    function insertTwice() {
      const r = insertAt('abc def', 3, [png('a.png')])
      // A 를 넣은 뒤 커서는 뒤쪽 줄 ` def` 처음 — 두 글자(` d`) 뒤로 옮겨 B 를 넣는다.
      act(() => {
        r.editor.commands.setTextSelection(r.editor.state.selection.from + 2)
      })
      act(() => r.ref.current?.insertImages([png('b.png')]))
      return r
    }

    it.each([
      ['A → B', [0, 1]],
      ['B → A', [1, 0]],
    ])('둘 다 실패하면(%s) 넣기 전 원문이다', async (_name, order) => {
      const { pending, onBodyChange, editor } = insertTwice()
      for (const i of order) await act(async () => pending[i].reject(new Error('500')))
      expect(imageCount(editor)).toBe(0)
      expect(lastArg(onBodyChange)).toBe('abc def')
    })

    it('A 만 실패하고 B 는 성공하면 B 만 넣은 원문이다', async () => {
      const { pending, onBodyChange } = insertTwice()
      await act(async () => pending[0].reject(new Error('500')))
      await act(async () => pending[1].resolve({ url: url(2), name: 'b.png' }))
      expect(lastArg(onBodyChange)).toBe(`abc d\n![b.png](${url(2)})\nef`)
    })

    it('B 가 성공한 뒤 A 가 실패해도 B 만 넣은 원문이다', async () => {
      const { pending, onBodyChange } = insertTwice()
      await act(async () => pending[1].resolve({ url: url(2), name: 'b.png' }))
      await act(async () => pending[0].reject(new Error('500')))
      expect(lastArg(onBodyChange)).toBe(`abc d\n![b.png](${url(2)})\nef`)
    })

    it('B 뒤에 C 가 B 의 앞 조각(` d`)을 또 나눠도, 셋 다 실패하면(어느 순서든) 넣기 전 원문이다', async () => {
      for (const order of [
        [0, 1, 2],
        [2, 1, 0],
        [1, 0, 2],
      ]) {
        const { pending, onBodyChange, editor, ref, unmount } = insertTwice()
        // ` d` 줄의 공백 뒤(` |d`)에 C 를 넣는다.
        act(() => {
          let at = -1
          editor.state.doc.forEach((line, offset) => {
            if (line.textContent === ' d') at = offset + 2
          })
          editor.commands.setTextSelection(at)
        })
        act(() => ref.current?.insertImages([png('c.png')]))
        for (const i of order) await act(async () => pending[i].reject(new Error('500')))
        expect(imageCount(editor)).toBe(0)
        expect(lastArg(onBodyChange)).toBe('abc def')
        unmount()
      }
    })

    it('B 를 넣은 뒤 B 의 앞 조각을 고치고 A 가 실패하면 잇지 않는다', async () => {
      const { pending, onBodyChange, editor } = insertTwice()
      // B 를 넣은 뒤 커서는 `ef` 줄 처음 — A 의 뒤쪽 줄 ` d` 끝으로 옮겨 글자를 친다.
      act(() => {
        let at = -1
        editor.state.doc.forEach((line, offset) => {
          if (line.textContent === ' d') at = offset + 1 + line.content.size
        })
        editor.chain().setTextSelection(at).insertContent('X').run()
      })
      await act(async () => pending[0].reject(new Error('500')))
      await act(async () => pending[1].reject(new Error('500')))
      expect(lastArg(onBodyChange)).toBe('abc\n dXef')
    })
  })

  // PR #1413 3차 검토: 줄을 나눈 이미지 묶음 뒤의 줄이 그 묶음이 떼어 온 조각이 아니면(문서 끝에서 넣은 뒤 새로 친 캡션 등) 이어 붙여 보지 않는다.
  it('문서 끝에 넣어 성공한 이미지 아래에 캡션을 친 뒤, 앞 줄 가운데에 넣은 이미지가 실패하면 그 줄은 다시 이어진다', async () => {
    const { pending, onBodyChange, editor, ref } = insertAt('abc', 3, [png('a.png')])
    await act(async () => pending[0].resolve({ url: url(1), name: 'a.png' }))
    act(() => {
      editor.commands.insertContent('xyz')
    })
    act(() => {
      editor.commands.setTextSelection(2) // `a|bc`
    })
    act(() => ref.current?.insertImages([png('z.png')]))
    await act(async () => pending[1].reject(new Error('500')))
    expect(lastArg(onBodyChange)).toBe(`abc\n![a.png](${url(1)})\nxyz`)
  })

  it('A 의 뒤쪽 줄 끝(문서 끝)에 따로 넣은 C 아래에 글자를 치고 A 가 실패하면 A 가 나눈 줄은 다시 이어진다', async () => {
    const { pending, onBodyChange, editor, ref } = insertAt('abc def', 3, [png('a.png')])
    act(() => {
      editor.commands.setTextSelection(editor.state.doc.content.size - 1) // ` def|`(문서 끝)
    })
    act(() => ref.current?.insertImages([png('c.png')]))
    act(() => {
      editor.commands.insertContent('xyz')
    })
    await act(async () => pending[1].resolve({ url: url(3), name: 'c.png' }))
    await act(async () => pending[0].reject(new Error('500')))
    expect(lastArg(onBodyChange)).toBe(`abc def\n![c.png](${url(3)})\nxyz`)
  })

  it('지운 자리표시를 실행 취소로 되살렸는데 그 업로드가 실패였으면 나눈 줄까지 걷어 빈 줄이 남지 않는다', async () => {
    const { pending, onBodyChange, editor, el } = insertAt('재현 화면', 2, [png('a.png')])
    // 업로드 중 자리표시(노드만)를 지운다 — 따로 되돌릴 수 있게 실행 취소 묶음을 끊는다.
    act(() => {
      let at = -1
      editor.state.doc.descendants((n, pos) => {
        if (n.type.name === 'image') at = pos
      })
      editor.view.dispatch(closeHistory(editor.state.tr.delete(at, at + 1)))
    })
    await act(async () => pending[0].reject(new Error('500')))
    act(() => {
      fireEvent.keyDown(el, { key: 'z', keyCode: 90, ctrlKey: true })
    })
    expect(imageCount(editor)).toBe(0)
    expect(lastArg(onBodyChange)).toBe('재현 화면')
  })
})

// 본문 모드 원문 읽기(WP-1656 코드 리뷰) — \r\n 줄바꿈과 다시 쓰면 바뀌는 멘션 id 는 고친 뒤 저장해도 엉뚱하게 바뀌지 않는다.
describe('RichInput 본문 모드 — \\r\\n 원문·멘션 id', () => {
  it('\\r\\n·\\r 원문은 줄마다 깨끗한 문단이고, 한 줄을 고치면 \\n 줄 + 고친 글자다(공백이 끼지 않는다)', () => {
    const { el, onBodyChange } = renderBody({ initialBody: '첫 줄\r\n둘째\r셋째' })
    const editor = editorOf(el)
    expect(editor.getJSON().content?.map((p) => p.content?.[0]?.text)).toEqual(['첫 줄', '둘째', '셋째'])
    act(() => {
      editor.commands.insertContentAt(4, '!') // 「첫 줄」 끝
    })
    expect(lastArg(onBodyChange)).toBe('첫 줄!\n둘째\n셋째')
  })

  it('<@007>·안전한 정수를 넘는 <@id> 는 글자로 남아 다른 곳을 고쳐도 그대로다', () => {
    const body = '담당 <@007> 와 <@99999999999999999999>, 그리고 <@7>'
    const { el, onBodyChange } = renderBody({ initialBody: body })
    const editor = editorOf(el)
    act(() => {
      editor.commands.insertContentAt(editor.state.doc.content.size - 1, '.')
    })
    expect(lastArg(onBodyChange)).toBe(`${body}.`)
    const mentions = (editor.getJSON().content?.[0]?.content ?? []).filter((n) => n.type === 'mention')
    expect(mentions.map((n) => n.attrs?.id)).toEqual([7])
  })
})

describe('RichInput 본문 모드 — 직접 친 이미지 마크다운은 글자 그대로(입력 규칙 없음)', () => {
  it.each([
    '![x](https://example.com/a.png)',
    '![x](/api/v1/projects/ZZ/issue-images/1)',
    '![x](/api/v1/projects/WP/issue-images/1 "t")',
    '![ x ](/api/v1/projects/WP/issue-images/1)',
  ])('%s 의 닫는 ) 를 쳐도 이미지 노드가 생기지 않고 원문이 친 글자 그대로다', (typed) => {
    const { el, onBodyChange } = renderBody({ initialBody: typed.slice(0, -1) })
    const editor = editorOf(el)
    act(() => {
      editor.commands.setTextSelection(editor.state.doc.content.size - 1) // 첫 문단 끝
    })
    typeChar(editor, ')')
    expect(imageCount(editor)).toBe(0)
    expect(lastArg(onBodyChange)).toBe(typed)
  })
})

describe('RichInput 코멘트 입력창(본문 모드 아님) — 그대로', () => {
  it('직접 친 이 프로젝트 이미지 마크다운은 지금처럼 입력 규칙으로 이미지 노드가 된다', () => {
    renderWithProviders(
      <RichInput
        members={[]}
        ariaLabel="코멘트 작성"
        inputTestId="comment-input"
        submitTestId="comment-submit"
        imageUpload={() => new Promise(() => {})}
        initialBody="![x](/api/v1/projects/WP/issue-images/1"
        onSubmit={vi.fn()}
      />,
    )
    const editor = editorOf(screen.getByTestId('comment-input'))
    act(() => {
      editor.commands.setTextSelection(editor.state.doc.content.size - 1)
    })
    typeChar(editor, ')')
    expect(imageCount(editor)).toBe(1)
  })

  it('이미지는 h-14 썸네일이고 Enter 가 다듬은 본문으로 전송한다', async () => {
    const onSubmit = vi.fn()
    renderWithProviders(
      <RichInput
        members={[]}
        ariaLabel="코멘트 작성"
        inputTestId="comment-input"
        submitTestId="comment-submit"
        imageUpload={() => new Promise(() => {})}
        initialBody={`글 \n![화면](${OTHER_PROJECT_IMAGE})\n`}
        onSubmit={onSubmit}
      />,
    )
    // 코멘트 입력창은 지금처럼 어느 프로젝트 이슈 이미지든 노드로 받는다.
    const node = await screen.findByTestId('rich-image')
    const img = await waitFor(() => {
      const found = node.querySelector('img')
      if (!found) throw new Error('이미지가 아직 없다')
      return found
    })
    expect(img).toHaveClass('h-14')
    expect(img).not.toHaveClass('max-h-[480px]')
    expect(screen.getByTestId('comment-submit')).toBeInTheDocument()

    fireEvent.keyDown(screen.getByTestId('comment-input'), { key: 'Enter' })
    expect(onSubmit).toHaveBeenCalledWith(`글 \n![화면](${OTHER_PROJECT_IMAGE})`)
  })
})

/** 본문이 채워진 RichInput — onSubmit 은 테스트가 resolve/reject 를 쥐는 Promise 를 돌려준다. */
function setupSubmitting(props: Props = {}) {
  let resolve!: () => void
  let reject!: (e: unknown) => void
  const onSubmit = vi.fn(
    () =>
      new Promise<void>((res, rej) => {
        resolve = res
        reject = rej
      }),
  )
  renderWithProviders(
    <RichInput
      members={[]}
      ariaLabel="입력"
      inputTestId="in"
      submitTestId="send"
      initialBody="안녕"
      clearOnSubmit={false}
      onSubmit={onSubmit}
      {...props}
    />,
  )
  return { onSubmit, resolve: () => resolve(), reject: (e: unknown) => reject(e) }
}

describe('RichInput 보내기 버튼 전송 중 표시', () => {
  it.each([
    ['inlineSubmit', true],
    ['기본', false],
  ])('%s: 전송 중이면 스피너와 aria-busy, 끝나면 걷힌다', async (_name, inlineSubmit) => {
    const { resolve } = setupSubmitting({ inlineSubmit })
    const send = screen.getByTestId('send')
    expect(send).not.toHaveAttribute('aria-busy')
    expect(screen.queryByTestId('send-spinner')).toBeNull()

    fireEvent.click(send)
    expect(send).toHaveAttribute('aria-busy', 'true')
    expect(screen.getAllByTestId('send-spinner')).toHaveLength(1)
    expect(screen.getByTestId('send-spinner').getAttribute('class')).toContain('animate-spin')
    // 접근 이름은 그대로 「보내기」 — 스피너는 장식(aria-hidden).
    // (jsdom 은 Tailwind invisible 을 적용하지 않으므로 이름의 출처인 aria-label 을 명시적으로 확인한다 — 글자 span 이 숨겨져도 이름 유지.)
    expect(send).toHaveAttribute('aria-label', '보내기')
    expect(screen.getByRole('button', { name: '보내기' })).toBe(send)

    await act(async () => resolve())
    expect(send).not.toHaveAttribute('aria-busy')
    expect(screen.queryByTestId('send-spinner')).toBeNull()
  })

  it('실패하면 스피너가 걷히고 다시 누를 수 있다', async () => {
    const { reject } = setupSubmitting()
    const send = screen.getByTestId('send')
    fireEvent.click(send)
    expect(screen.getByTestId('send-spinner')).toBeInTheDocument()

    await act(async () => reject(new Error('fail')))
    expect(send).not.toHaveAttribute('aria-busy')
    expect(screen.queryByTestId('send-spinner')).toBeNull()
    expect(send).toBeEnabled()
  })

  it('비활성만으로는 스피너가 없다', () => {
    setupSubmitting({ submitDisabled: true })
    const send = screen.getByTestId('send')
    expect(send).toBeDisabled()
    expect(send).not.toHaveAttribute('aria-busy')
    expect(screen.queryByTestId('send-spinner')).toBeNull()
  })
})

describe('RichInput clearOnSubmit — 전송 중 입력한 글자 유지(WP-1923)', () => {
  /** 전송 대기 중 편집칸 끝에 글자를 더한다(jsdom 에서 키 입력 대신 TipTap 명령으로 넣는다). */
  function typeAtEnd(content: string | { type: string; content: JSONContent[] }) {
    const editor = editorOf(screen.getByTestId('in'))
    act(() => {
      editor.chain().focus('end').insertContent(content).run()
    })
  }

  it('전송 중 같은 줄 끝에 이어 쓴 글자만 남는다', async () => {
    const { onSubmit, resolve } = setupSubmitting({ clearOnSubmit: true, disableWhenEmpty: true })
    fireEvent.click(screen.getByTestId('send'))
    typeAtEnd(' 반가워')
    await act(async () => resolve())
    expect(screen.getByTestId('in').textContent).toBe(' 반가워')
    // 일부만 지워도 isEmpty/charCount 가 동기화돼 남은 글자가 있으면 보내기가 활성이다.
    expect(screen.getByTestId('send')).toBeEnabled()
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith('안녕')
  })

  it('전송 중 새 줄에 쓴 글자만 남는다', async () => {
    const { onSubmit, resolve } = setupSubmitting({ clearOnSubmit: true })
    fireEvent.click(screen.getByTestId('send'))
    typeAtEnd({ type: 'paragraph', content: [{ type: 'text', text: '다음' }] })
    await act(async () => resolve())
    const editor = editorOf(screen.getByTestId('in'))
    expect(editor.getJSON().content).toHaveLength(1)
    expect(screen.getByTestId('in').textContent).toBe('다음')
    expect(onSubmit).toHaveBeenCalledWith('안녕')
  })

  it('전송 중 아무것도 안 쓰면 비워지고 보내기 버튼이 비활성이다', async () => {
    const { resolve } = setupSubmitting({ clearOnSubmit: true, disableWhenEmpty: true })
    fireEvent.click(screen.getByTestId('send'))
    await act(async () => resolve())
    expect(screen.getByTestId('in').textContent).toBe('')
    expect(screen.getByTestId('send')).toBeDisabled()
  })

  it('전송 중 보낸 부분을 고쳤으면 지우지 않는다', async () => {
    const { resolve } = setupSubmitting({ clearOnSubmit: true })
    fireEvent.click(screen.getByTestId('send'))
    const editor = editorOf(screen.getByTestId('in'))
    act(() => {
      editor.commands.setContent('<p>안해</p>', true)
    })
    await act(async () => resolve())
    expect(screen.getByTestId('in').textContent).toBe('안해')
  })

  it('전송이 실패하면 입력이 그대로다', async () => {
    const { reject } = setupSubmitting({ clearOnSubmit: true })
    fireEvent.click(screen.getByTestId('send'))
    typeAtEnd(' 더')
    await act(async () => reject(new Error('fail')))
    expect(screen.getByTestId('in').textContent).toBe('안녕 더')
  })

  /** 조합 상태를 켜고 끈다(jsdom 에서 ProseMirror 가 compositionstart 로 view.composing 을 켜는지에 기대지 않고 직접 바꾼다). */
  function setComposing(on: boolean) {
    const editor = editorOf(screen.getByTestId('in'))
    Object.defineProperty(editor.view, 'composing', { value: on, configurable: true })
    return editor
  }
  /** compositionend 를 보낸다(조합 상태는 바꾸지 않는다). */
  function dispatchCompositionEnd() {
    editorOf(screen.getByTestId('in')).view.dom.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
  }
  /** 지연 정리(compositionend 뒤 COMPOSITION_SETTLE_MS)가 돌 시간을 준다. */
  const settle = () => act(() => new Promise<void>((r) => setTimeout(r, COMPOSITION_SETTLE_MS + 30)))
  /** 조합 중에 전송 성공이 도착한 상태를 만든다 — 보낸 뒤 tail 을 이어 쓰고(없으면 생략) 조합을 켠 채 resolve. */
  async function submitThenResolveWhileComposing(props: Props = {}, tail?: string) {
    const ctx = setupSubmitting({ clearOnSubmit: true, ...props })
    fireEvent.click(screen.getByTestId('send'))
    if (tail) typeAtEnd(tail)
    setComposing(true)
    await act(async () => ctx.resolve())
    return ctx
  }

  it('한글 조합 중이면 compositionend 전엔 지우지 않고, 끝난 뒤 보낸 부분만 지운다', async () => {
    await submitThenResolveWhileComposing({ disableWhenEmpty: true }, ' 반가워')
    // 조합 중 — 아직 아무것도 지우지 않는다.
    expect(screen.getByTestId('in').textContent).toBe('안녕 반가워')
    setComposing(false)
    dispatchCompositionEnd()
    await settle()
    expect(screen.getByTestId('in').textContent).toBe(' 반가워')
    expect(screen.getByTestId('send')).toBeEnabled()
  })

  it('한글 조합 중 전송이 끝나도 새로 쓴 게 없으면 조합이 끝난 뒤 비워진다', async () => {
    await submitThenResolveWhileComposing({ disableWhenEmpty: true })
    expect(screen.getByTestId('in').textContent).toBe('안녕')
    setComposing(false)
    dispatchCompositionEnd()
    await settle()
    expect(screen.getByTestId('in').textContent).toBe('')
    expect(screen.getByTestId('send')).toBeDisabled()
  })

  it('조합 때문에 정리가 미뤄져도 요청이 끝나면 전송 중 표시가 풀린다', async () => {
    await submitThenResolveWhileComposing({ disableWhenEmpty: true }, ' 더')
    // 이미 보낸 메시지다 — 정리를 기다리는 동안 spinner·aria-busy 를 남기지 않는다(리뷰 후속).
    const send = screen.getByTestId('send')
    expect(send).not.toHaveAttribute('aria-busy')
    expect(send).toBeEnabled()
    expect(screen.getByTestId('in').textContent).toBe('안녕 더')
  })

  it('정리를 기다리는 중 조합을 확정한 Enter 는 버려지지 않고, 보낸 앞부분을 지운 뒤 남은 글만 보낸다', async () => {
    const { onSubmit } = await submitThenResolveWhileComposing({}, ' 더')
    // macOS Chrome: 조합 확정 → compositionend → Enter(13). 50ms 정리 타이머가 돌기 전에 Enter 가 온다.
    setComposing(false)
    dispatchCompositionEnd()
    fireEvent.keyDown(editorOf(screen.getByTestId('in')).view.dom, { key: 'Enter' })
    expect(onSubmit).toHaveBeenCalledTimes(2)
    expect(onSubmit).toHaveBeenLastCalledWith('더')
    // 늦게 도는 정리 타이머가 남은 글을 다시 지우지 않는다.
    await settle()
    expect(screen.getByTestId('in').textContent).toBe(' 더')
  })

  it('정리를 기다리는 중 아직 조합 중에 보내기를 누르면 조합이 끝난 뒤 남은 글만 보낸다', async () => {
    const { onSubmit } = await submitThenResolveWhileComposing({}, ' 더')
    fireEvent.click(screen.getByTestId('send'))
    // 조합 중에는 지우지도 보내지도 않는다(조합이 깨지지 않게).
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('in').textContent).toBe('안녕 더')
    setComposing(false)
    dispatchCompositionEnd()
    await settle()
    // 누른 보내기는 버려지지 않는다 — 보낸 앞부분을 지운 뒤 남은 글만 보낸다.
    expect(onSubmit).toHaveBeenCalledTimes(2)
    expect(onSubmit).toHaveBeenLastCalledWith('더')
  })

  it('조합이 다른 칸으로 옮겨 가며 끝나면 늦은 정리가 입력창으로 초점을 되돌리지 않는다', async () => {
    await submitThenResolveWhileComposing({}, ' 더')
    const editor = editorOf(screen.getByTestId('in'))
    act(() => editor.commands.blur())
    setComposing(false)
    dispatchCompositionEnd()
    await settle()
    expect(screen.getByTestId('in').textContent).toBe(' 더')
    expect(editor.isFocused).toBe(false)
  })

  it('Shift+Enter 로 줄을 바꿔 이어 쓰면 남은 글 앞에 빈 줄이 남지 않는다', async () => {
    const { resolve } = setupSubmitting({ clearOnSubmit: true })
    fireEvent.click(screen.getByTestId('send'))
    const editor = editorOf(screen.getByTestId('in'))
    act(() => {
      editor.chain().focus('end').setHardBreak().insertContent('다음').run()
    })
    await act(async () => resolve())
    expect(editor.getJSON().content?.[0]?.content).toEqual([{ type: 'text', text: '다음' }])
  })

  it('compositionend 직후 다시 조합이 시작되면 마지막 compositionend 까지 지우지 않는다', async () => {
    await submitThenResolveWhileComposing({}, ' 더')
    // 음절 경계: compositionend 뒤 곧바로 새 조합이 시작된다.
    setComposing(false)
    dispatchCompositionEnd()
    setComposing(true)
    await settle()
    expect(screen.getByTestId('in').textContent).toBe('안녕 더')
    setComposing(false)
    dispatchCompositionEnd()
    await settle()
    expect(screen.getByTestId('in').textContent).toBe(' 더')
  })

  it('compositionend 가 오지 않아도 조합이 풀려 있으면 점검 주기에 보낸 부분을 지운다', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'] })
    try {
      await submitThenResolveWhileComposing({ disableWhenEmpty: true }, ' 더')
      // 조합은 풀렸지만 compositionend 는 오지 않았다(Android 조합 타임아웃 등).
      setComposing(false)
      await act(async () => {
        vi.advanceTimersByTime(COMPOSITION_POLL_MS)
      })
      expect(screen.getByTestId('in').textContent).toBe(' 더')
    } finally {
      vi.useRealTimers()
    }
  })

  it('조합을 기다리다 언마운트돼도 오류 없이 끝난다', async () => {
    await submitThenResolveWhileComposing()
    act(() => editorOf(screen.getByTestId('in')).destroy())
    await settle()
  })
})
