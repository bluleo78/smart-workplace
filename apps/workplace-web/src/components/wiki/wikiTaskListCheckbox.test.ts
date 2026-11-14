// @vitest-environment jsdom
// 체크리스트 상자(WP-1546) — 편집기에서는 상자를 눌러 체크·해제하고, 읽기 전용 화면(판 미리보기·공개 공유, editable:false)에서는
// 눌러도 문서가 바뀌지 않는다. 노트 본문을 그리는 세 화면이 함께 쓰는 확장 묶음(wikiRenderExtensions)으로 확인한다.
import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'

import { wikiRenderExtensions } from './wikiRenderExtensions'

const CONTENT = {
  type: 'doc',
  content: [
    {
      type: 'taskList',
      content: [
        {
          type: 'taskItem',
          attrs: { checked: false },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: '할 일' }] }],
        },
      ],
    },
  ],
}

let editor: Editor | null = null
afterEach(() => {
  editor?.destroy()
  editor = null
  document.body.innerHTML = ''
})

/** 화면에 붙인 에디터를 띄우고 첫 체크 상자를 돌려준다. */
function mount(editable: boolean): HTMLInputElement {
  const element = document.createElement('div')
  document.body.appendChild(element)
  editor = new Editor({
    element,
    extensions: wikiRenderExtensions(),
    content: CONTENT,
    editable,
  })
  const box = element.querySelector<HTMLInputElement>('ul[data-type="taskList"] > li > label > input[type="checkbox"]')
  expect(box).not.toBeNull()
  return box!
}

/** 첫 항목의 checked 속성(문서 기준). */
function firstChecked(): unknown {
  let checked: unknown
  editor!.state.doc.descendants((n) => {
    if (n.type.name === 'taskItem' && checked === undefined) checked = n.attrs.checked
  })
  return checked
}

describe('체크리스트 상자 (WP-1546)', () => {
  it('편집기에서는 상자를 누르면 항목이 체크된다', () => {
    const box = mount(true)
    box.click()
    expect(firstChecked()).toBe(true)
    expect(editor!.getHTML()).toContain('data-checked="true"')
  })

  it('읽기 전용 화면에서는 상자를 눌러도 문서가 바뀌지 않고 상자도 되돌아간다', () => {
    const box = mount(false)
    box.click()
    expect(firstChecked()).toBe(false)
    expect(box.checked).toBe(false)
  })
})
