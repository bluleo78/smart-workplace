import { Editor } from '@tiptap/core'
import type MarkdownIt from 'markdown-it'
import { describe, expect, it } from 'vitest'

import { wikiSchemaExtensions } from './extensions'

// WP-1638 — CJK 친화 규칙은 md.inline.State 를 하위 클래스로 바꿔 끼운다. tiptap-markdown 은 parse() 마다
// 같은 markdown-it 에 setup 을 다시 부르므로, 가드가 없으면 하위 클래스가 파싱 횟수만큼 겹겹이 쌓인다.
describe('CJK 친화 강조 규칙 등록 (WP-1638)', () => {
  /** State 클래스의 상속 사슬에서 CJK 친화 클래스가 몇 겹인지. */
  function cjkLayers(md: MarkdownIt): number {
    let n = 0
    for (let c: unknown = md.inline.State; typeof c === 'function' && c !== Function.prototype; c = Object.getPrototypeOf(c)) {
      if ((c as { name: string }).name === 'CjkFriendlyState') n++
    }
    return n
  }

  it('registers the rule only once across parses', () => {
    const ed = new Editor({ extensions: wikiSchemaExtensions() })
    for (let i = 0; i < 3; i++) ed.commands.setContent('**설정(A)**을', false)
    const md = (ed.storage as { markdown: { parser: { md: MarkdownIt } } }).markdown.parser.md
    expect(cjkLayers(md)).toBe(1)
    // 마지막 파싱 결과도 굵게다.
    expect(ed.state.doc.firstChild!.firstChild!.marks.map((m) => m.type.name)).toEqual(['bold'])
    ed.destroy()
  })
})
