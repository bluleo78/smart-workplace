// WP-1305 — 선택 서식 도구 막대. 실제 노트 스키마 편집기에 막대를 붙여 버튼·메뉴가 문서(저장 마크다운)를 바꾸는지,
// 「✦ AI ▾」 메뉴의 다섯 동작이 전과 같은 onAction 을 부르는지, 링크·상자·이슈 버튼이 남는지, 보이지 않아야 할 때 안 보이는지 본다.
// 떠 있는 표면(tiptap BubbleMenu·tippy 배치)은 jsdom 이 그리지 못하므로 표면만 갈아 끼운다 — shouldShow 판정은 그대로 불러
// 참일 때만 내용을 그린다(배치·겹침은 E2E wiki-ai.spec.ts 몫).
import { docToMarkdown, wikiSchemaExtensions } from '@smart-workplace/wiki-editor-schema'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Editor } from '@tiptap/core'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import { type ReactNode, useEffect, useReducer } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { WikiAiBubbleToolbar } from './WikiAiBubbleToolbar'
import { FORMAT_COLORS, markColorValue, textColorValue, WikiTextFormatKeys } from './wikiTextFormat'

vi.mock('@/components/editor/EditorFloatingToolbar', () => ({
  // 표면 대역 — 진짜와 같은 shouldShow 로 보일지 정하고, 보이면 같은 testId·role 로 내용을 그린다.
  EditorFloatingToolbar: ({
    editor,
    shouldShow,
    testId,
    ariaLabel,
    suppressed,
    children,
  }: {
    editor: Editor
    shouldShow: (p: { editor: Editor; state: Editor['state'] }) => boolean
    testId: string
    ariaLabel: string
    suppressed?: boolean
    children: ReactNode
  }) =>
    shouldShow({ editor, state: editor.state }) ? (
      <div data-testid={testId} role="group" aria-label={ariaLabel} hidden={suppressed}>
        {children}
      </div>
    ) : null,
  EditorToolbarDivider: () => <span aria-hidden="true" />,
}))

let editor: Editor | null = null
afterEach(() => {
  editor?.destroy()
  editor = null
})

/** 편집기가 바뀔 때마다 막대를 다시 그린다 — 앱의 useEditor 가 거래마다 다시 그리는 것과 같게. */
function Harness(props: Omit<Parameters<typeof WikiAiBubbleToolbar>[0], 'editor'> & { editor: Editor }) {
  const [, rerender] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    props.editor.on('transaction', rerender)
    return () => {
      props.editor.off('transaction', rerender)
    }
  }, [props.editor])
  return <WikiAiBubbleToolbar {...props} />
}

function open(md: string) {
  editor = new Editor({ element: document.createElement('div'), extensions: [...wikiSchemaExtensions(), WikiTextFormatKeys], content: md })
  return editor
}

/** 글자 블록 안 첫 등장 글자를 고른다. */
function select(ed: Editor, text: string) {
  let from = -1
  ed.state.doc.descendants((n, pos) => {
    if (from >= 0) return false
    if (!n.isTextblock) return true
    const i = n.textContent.indexOf(text)
    if (i >= 0) from = pos + 1 + i
    return false
  })
  act(() => {
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, from, from + text.length)))
  })
}

function setup(md: string, text: string, props: Partial<Omit<Parameters<typeof WikiAiBubbleToolbar>[0], 'editor'>> = {}) {
  const ed = open(md)
  select(ed, text)
  const onAction = vi.fn()
  const onLink = vi.fn()
  const onCreateIssue = vi.fn()
  render(<Harness editor={ed} disabled={false} onAction={onAction} onLink={onLink} onCreateIssue={onCreateIssue} {...props} />)
  return { ed, onAction, onLink, onCreateIssue, user: userEvent.setup() }
}

const md = (ed: Editor) => docToMarkdown(ed.state.doc)
const RED = textColorValue(FORMAT_COLORS.find((c) => c.key === 'red')!)
const YELLOW = markColorValue(FORMAT_COLORS.find((c) => c.key === 'yellow')!)

describe('WikiAiBubbleToolbar — 글자 모양', () => {
  it('굵게·기울임·밑줄·취소선 버튼이 마크를 켜고 끄며 눌림 상태가 선택을 따른다', async () => {
    const { ed, user } = setup('가나다', '나')
    const underline = screen.getByRole('button', { name: '밑줄' })
    expect(underline).toHaveAttribute('aria-pressed', 'false')
    await user.click(underline)
    expect(md(ed)).toBe('가<span style="text-decoration: underline">나</span>다')
    expect(screen.getByRole('button', { name: '밑줄' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: '굵게' }))
    await user.click(screen.getByRole('button', { name: '취소선' }))
    expect(md(ed)).toBe('가<span style="text-decoration: underline">**~~나~~**</span>다')
    expect(screen.getByRole('button', { name: '굵게' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: '밑줄' }))
    await user.click(screen.getByRole('button', { name: '취소선' }))
    await user.click(screen.getByRole('button', { name: '기울임' }))
    expect(md(ed)).toBe('가***나***다')
    expect(screen.getByRole('button', { name: '기울임' })).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('WikiAiBubbleToolbar — 크기·색·정렬 메뉴', () => {
  it('크기 메뉴가 본문·제목1~3 으로 바꾸고 트리거에 지금 크기를 보인다', async () => {
    const { ed, user } = setup('글', '글')
    expect(screen.getByTestId('wiki-format-tb-size')).toHaveTextContent('본문')
    await user.click(screen.getByTestId('wiki-format-tb-size'))
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['본문', '제목1', '제목2', '제목3'])
    await user.click(screen.getByRole('menuitem', { name: '제목3' }))
    expect(md(ed)).toBe('### 글')
    expect(screen.getByTestId('wiki-format-tb-size')).toHaveTextContent('제목3')
    await user.click(screen.getByTestId('wiki-format-tb-size'))
    await user.click(screen.getByRole('menuitem', { name: '본문' }))
    expect(md(ed)).toBe('글')
  })

  it('글자색·배경색 메뉴는 기본 + 7색이고, 고르면 서식 span 하나에 모이며 「기본」이 지운다', async () => {
    const { ed, user } = setup('가나다', '나')
    await user.click(screen.getByRole('button', { name: '글자색' }))
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['기본', ...FORMAT_COLORS.map((c) => `가${c.label}`)])
    await user.click(screen.getByTestId('wiki-format-color-red'))
    await user.click(screen.getByRole('button', { name: '배경색' }))
    await user.click(screen.getByTestId('wiki-format-highlight-yellow'))
    expect(md(ed)).toBe(`가<span style="color: ${RED}; background-color: ${YELLOW}">나</span>다`)
    // 지금 색에 체크(✓ 가 보이는 항목) — 다시 열어 「기본」으로 글자색만 지운다.
    await user.click(screen.getByRole('button', { name: '글자색' }))
    expect(screen.getByTestId('wiki-format-color-red').querySelector('svg')).toHaveClass('opacity-100')
    await user.click(screen.getByTestId('wiki-format-color-default'))
    expect(md(ed)).toBe(`가<span style="background-color: ${YELLOW}">나</span>다`)
  })

  it('정렬 메뉴가 왼쪽·가운데·오른쪽을 바꾸고, 표 안에서는 정렬 메뉴를 두지 않는다', async () => {
    const { ed, user } = setup('글', '글')
    expect(screen.getByTestId('wiki-format-tb-align')).toHaveAccessibleName('정렬: 왼쪽 정렬')
    await user.click(screen.getByTestId('wiki-format-tb-align'))
    await user.click(screen.getByRole('menuitem', { name: '가운데 정렬' }))
    expect(md(ed)).toBe(['<div align="center">', '', '글', '', '</div>'].join('\n'))
    expect(screen.getByTestId('wiki-format-tb-align')).toHaveAccessibleName('정렬: 가운데 정렬')
    await user.click(screen.getByTestId('wiki-format-tb-align'))
    await user.click(screen.getByRole('menuitem', { name: '왼쪽 정렬' }))
    expect(md(ed)).toBe('글')

    select(ed, '글')
    act(() => {
      ed.commands.setContent(['| a | b |', '| --- | --- |', '| 셀 | 2 |'].join('\n'))
    })
    select(ed, '셀')
    expect(screen.queryByTestId('wiki-format-tb-align')).toBeNull()
  })

  it('목록 항목 안에서는 정렬 메뉴를 두지 않는다 — 감싸개가 촘촘한 목록을 느슨하게 만들지 않게(canAlignIn)', () => {
    setup(['- 하나', '- 둘'].join('\n'), '하나')
    expect(screen.getByTestId('wiki-ai-toolbar')).toBeInTheDocument()
    expect(screen.queryByTestId('wiki-format-tb-align')).toBeNull()
  })
})

describe('WikiAiBubbleToolbar — ✦ AI 메뉴·링크·상자·이슈', () => {
  it('✦ AI 메뉴에 다섯 동작이 있고 같은 onAction 을 부른다(톤·번역은 하위 메뉴 프리셋)', async () => {
    const { user, onAction } = setup('가나다', '나')
    // 막대에는 AI 변형 버튼이 바로 놓이지 않는다 — 메뉴 안으로 옮겼다.
    expect(screen.queryByRole('button', { name: '다듬기' })).toBeNull()
    await user.click(screen.getByTestId('wiki-ai-tb-menu'))
    const menu = screen.getByTestId('wiki-ai-menu')
    expect([...menu.querySelectorAll('[role="menuitem"]')].map((m) => m.textContent)).toEqual(['톤', '번역', '확장', '축약', '다듬기'])
    await user.click(screen.getByTestId('wiki-ai-tb-polish'))
    expect(onAction).toHaveBeenLastCalledWith('polish')

    for (const [key, expected] of [
      ['expand', 'expand'],
      ['condense', 'condense'],
    ] as const) {
      await user.click(screen.getByTestId('wiki-ai-tb-menu'))
      await user.click(screen.getByTestId(`wiki-ai-tb-${key}`))
      expect(onAction).toHaveBeenLastCalledWith(expected)
    }

    // 하위 메뉴는 키보드로 연다(jsdom 은 호버로 연 하위 메뉴가 포인터 이동에 닫힌다 — web CLAUDE.md).
    await user.click(screen.getByTestId('wiki-ai-tb-menu'))
    screen.getByTestId('wiki-ai-tb-rewrite_tone').focus()
    await user.keyboard('{ArrowRight}')
    await user.click(await screen.findByTestId('wiki-ai-tone-격식체'))
    expect(onAction).toHaveBeenLastCalledWith('rewrite_tone', '격식체')

    await user.click(screen.getByTestId('wiki-ai-tb-menu'))
    screen.getByTestId('wiki-ai-tb-translate').focus()
    await user.keyboard('{ArrowRight}')
    await user.click(await screen.findByTestId('wiki-ai-lang-영어'))
    expect(onAction).toHaveBeenLastCalledWith('translate', '영어')
    expect(onAction).toHaveBeenCalledTimes(5)
  })

  it('공유 화면(aiHidden)은 AI 메뉴만 빼고 서식·링크는 남긴다', () => {
    setup('가나다', '나', { aiHidden: true })
    expect(screen.queryByTestId('wiki-ai-tb-menu')).toBeNull()
    expect(screen.getByRole('button', { name: '굵게' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '링크' })).toBeInTheDocument()
  })

  it('링크·상자로 감싸기·이슈로 만들기 버튼이 그대로 동작한다', async () => {
    const { ed, user, onLink, onCreateIssue } = setup('가나다', '나')
    await user.click(screen.getByRole('button', { name: '링크' }))
    expect(onLink).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: '이슈로 만들기' }))
    expect(onCreateIssue).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: '상자로 감싸기' }))
    expect(ed.state.doc.firstChild!.type.name).toBe('wikiHtmlBox')
  })

  it('권한 없음·생성 중(disabled)이면 그리지 않는다', () => {
    setup('가나다', '나', { disabled: true })
    expect(screen.queryByTestId('wiki-ai-toolbar')).toBeNull()
  })

  it('빈 선택(커서)·이미지 노드 선택에서는 그리지 않고, 글자를 고르면 그린다', () => {
    const ed = open('가나다\n\n![그림](https://example.com/a.png)')
    render(<Harness editor={ed} disabled={false} onAction={vi.fn()} />)
    expect(screen.queryByTestId('wiki-ai-toolbar')).toBeNull()
    let imagePos = -1
    ed.state.doc.descendants((n, pos) => {
      if (n.type.name === 'image') imagePos = pos
    })
    act(() => {
      ed.view.dispatch(ed.state.tr.setSelection(NodeSelection.create(ed.state.doc, imagePos)))
    })
    expect(screen.queryByTestId('wiki-ai-toolbar')).toBeNull()
    select(ed, '나')
    expect(screen.getByTestId('wiki-ai-toolbar')).toBeInTheDocument()
  })
})
