// WP-1546 — 체크리스트 블록(GFM 작업 목록). `- [ ] 할 일` / `- [x] 끝난 일` 이 taskList·taskItem 노드로 읽히고
// 같은 마크다운으로 다시 저장돼야 한다. 노드가 없던 때는 `[ ]` 가 글자로 남아 `\[ \]` 로 이스케이프됐다(MCP 로 쓴 체크리스트가 깨짐).
import { describe, expect, it } from 'vitest'

import { docToMarkdown, getMarkdownSchema, markdownToDoc } from './markdown'

/** 마크다운 → 문서 → 마크다운 한 바퀴. */
const roundtrip = (md: string) => docToMarkdown(markdownToDoc(md))

/** 문서 안 taskItem 들의 (checked, 글자) 목록 — 구조 판정용. */
function taskItems(md: string): Array<{ checked: boolean; text: string }> {
  const out: Array<{ checked: boolean; text: string }> = []
  markdownToDoc(md).descendants((n) => {
    if (n.type.name === 'taskItem')
      out.push({
        checked: n.attrs.checked as boolean,
        text: n.firstChild?.textContent ?? '',
      })
  })
  return out
}

describe('체크리스트 왕복 (WP-1546)', () => {
  it('체크·미체크 항목이 taskList/taskItem 으로 읽힌다', () => {
    const doc = markdownToDoc('- [ ] a\n- [x] b').toJSON()
    expect(doc.content[0].type).toBe('taskList')
    expect(doc.content[0].content.map((i: { type: string; attrs: { checked: boolean } }) => [i.type, i.attrs.checked])).toEqual([
      ['taskItem', false],
      ['taskItem', true],
    ])
  })

  it('원문 그대로 저장된다(이스케이프 없음)', () => {
    const md = '- [ ] a\n- [x] b'
    const once = roundtrip(md)
    expect(once).toBe(md)
    expect(once).not.toContain('\\[')
    expect(roundtrip(once)).toBe(once)
  })

  it('중첩 체크리스트가 왕복한다', () => {
    const md = '- [ ] a\n  - [x] b'
    expect(roundtrip(md)).toBe(md)
    expect(taskItems(md)).toEqual([
      { checked: false, text: 'a' },
      { checked: true, text: 'b' },
    ])
  })

  it('앞뒤 문단·불릿 목록과 섞여도 각각 유지된다', () => {
    const md = '앞 문단\n\n- 불릿 하나\n- 불릿 둘\n\n* [ ] 할 일\n* [x] 끝난 일\n\n뒤 문단'
    const doc = markdownToDoc(md).toJSON()
    expect(doc.content.map((n: { type: string }) => n.type)).toEqual(['paragraph', 'bulletList', 'taskList', 'paragraph'])
    const once = roundtrip(md)
    expect(
      markdownToDoc(once)
        .toJSON()
        .content.map((n: { type: string }) => n.type),
    ).toEqual(['paragraph', 'bulletList', 'taskList', 'paragraph'])
    expect(roundtrip(once)).toBe(once)
  })

  it('항목 안 굵게·링크·멘션 서식이 유지된다', () => {
    const md = '- [ ] **굵게** [문서](https://example.com) <@42>'
    const once = roundtrip(md)
    expect(once).toBe(md)
    let hasMention = false
    markdownToDoc(md).descendants((n) => {
      if (n.type.name === 'wikiMention') hasMention = true
    })
    expect(hasMention).toBe(true)
  })

  it('빈 항목도 체크리스트로 왕복한다', () => {
    const once = roundtrip('- [ ] ')
    expect(markdownToDoc(once).toJSON().content[0].type).toBe('taskList')
    expect(once).not.toContain('\\[')
    expect(roundtrip(once)).toBe(once)
  })

  it('대문자 [X] 는 체크된 것으로 읽고 [x] 로 저장한다', () => {
    expect(taskItems('- [X] done')).toEqual([{ checked: true, text: 'done' }])
    expect(roundtrip('- [X] done')).toBe('- [x] done')
  })

  it('이미 이스케이프돼 저장된 \\[ \\] 는 글자로 남는다(데이터 이전 없음)', () => {
    const md = '- \\[ \\] old'
    expect(markdownToDoc(md).toJSON().content[0].type).toBe('bulletList')
    expect(roundtrip(md)).toBe(md)
  })

  // 빈 항목 판정은 마크다운 원문으로 한다 — DOM 에서는 `- \\[ \\]` 와 `- [ ]` 가 같은 글자 `[ ]` 라, DOM 으로 옮기면 옛 본문이 상자로 바뀐다.
  it('내용 없이 이스케이프된 \\[ \\] 만 있는 옛 항목도 글자 불릿으로 남는다', () => {
    const md = '- \\[ \\]'
    expect(markdownToDoc(md).toJSON().content[0].type).toBe('bulletList')
    expect(roundtrip(md)).toBe(md)
  })

  it('상자(wikiHtmlBox) 안 체크리스트가 왕복한다', () => {
    const md = '<div class="card">\n\n- [ ] a\n- [x] b\n\n</div>'
    const doc = markdownToDoc(md).toJSON()
    expect(doc.content[0].type).toBe('wikiHtmlBox')
    expect(doc.content[0].content[0].type).toBe('taskList')
    expect(roundtrip(md)).toBe(md)
  })

  // 한 목록 안에 체크 항목과 일반 항목이 섞이면 markdown-it-task-lists 는 목록 전체를 작업 목록으로 표시하고 일반 항목만 표시하지 않는다.
  // 그대로 두면 ProseMirror 가 taskList 안에 둘 수 없는 일반 항목을 끼우려고 빈 체크 항목을 지어내 저장할 때마다 늘었다.
  it.each([
    ['일반 다음 체크', '- a\n- [ ] b', ['bulletList', 'taskList']],
    ['체크 다음 일반', '- [ ] a\n- b', ['taskList', 'bulletList']],
    ['일반·체크·일반', '- a\n- [x] b\n- c', ['bulletList', 'taskList', 'bulletList']],
  ])('섞인 목록(%s)은 빈 항목을 지어내지 않고 연속 구간으로 나뉜다', (_, md, types) => {
    const doc = markdownToDoc(md)
    expect(doc.toJSON().content.map((n: { type: string }) => n.type)).toEqual(types)
    expect(doc.textContent).toBe(md.replace(/- (\[.\] )?/g, '').replace(/\n/g, ''))
    let empty = 0
    doc.descendants((n) => {
      if (n.type.name === 'taskItem' && n.textContent === '') empty++
    })
    expect(empty).toBe(0)
    const once = roundtrip(md)
    expect(roundtrip(once)).toBe(once)
    expect(
      markdownToDoc(once)
        .toJSON()
        .content.map((n: { type: string }) => n.type),
    ).toEqual(types)
  })

  it('불릿 목록 바로 뒤 체크리스트(같은 - 표시로 저장)도 다시 열면 그대로다', () => {
    const doc = getMarkdownSchema().nodeFromJSON({
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: '불릿' }],
                },
              ],
            },
          ],
        },
        {
          type: 'taskList',
          content: [
            {
              type: 'taskItem',
              attrs: { checked: true },
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: '할 일' }],
                },
              ],
            },
          ],
        },
      ],
    })
    const once = docToMarkdown(doc)
    expect(
      markdownToDoc(once)
        .toJSON()
        .content.map((n: { type: string }) => n.type),
    ).toEqual(['bulletList', 'taskList'])
    expect(taskItems(once)).toEqual([{ checked: true, text: '할 일' }])
    expect(roundtrip(once)).toBe(once)
  })

  it('번호 목록의 체크 항목은 번호 없이 체크리스트로 읽는다(빈 번호 항목을 지어내지 않는다)', () => {
    const doc = markdownToDoc('1. [ ] x\n2. [x] y')
    expect(doc.toJSON().content.map((n: { type: string }) => n.type)).toEqual(['taskList'])
    expect(taskItems('1. [ ] x\n2. [x] y')).toEqual([
      { checked: false, text: 'x' },
      { checked: true, text: 'y' },
    ])
    expect(roundtrip('1. [ ] x\n2. [x] y')).toBe('- [ ] x\n- [x] y')
  })

  it('빈 항목이 다른 항목 사이에 있어도 체크리스트로 왕복한다', () => {
    const doc = getMarkdownSchema().nodeFromJSON({
      type: 'doc',
      content: [
        {
          type: 'taskList',
          content: [
            {
              type: 'taskItem',
              attrs: { checked: false },
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }],
            },
            {
              type: 'taskItem',
              attrs: { checked: true },
              content: [{ type: 'paragraph' }],
            },
            {
              type: 'taskItem',
              attrs: { checked: false },
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'c' }] }],
            },
          ],
        },
      ],
    })
    const once = docToMarkdown(doc)
    expect(once).not.toContain('\\[')
    expect(markdownToDoc(once).toJSON()).toEqual(doc.toJSON())
    expect(roundtrip(once)).toBe(once)
  })

  it('하위 체크리스트를 둔 빈 항목도 중첩 그대로 왕복한다', () => {
    const p = (text?: string) => ({
      type: 'paragraph',
      content: text ? [{ type: 'text', text }] : undefined,
    })
    const doc = getMarkdownSchema().nodeFromJSON({
      type: 'doc',
      content: [
        {
          type: 'taskList',
          content: [
            {
              type: 'taskItem',
              attrs: { checked: false },
              content: [
                p(),
                {
                  type: 'taskList',
                  content: [
                    {
                      type: 'taskItem',
                      attrs: { checked: true },
                      content: [p('하위')],
                    },
                  ],
                },
              ],
            },
            {
              type: 'taskItem',
              attrs: { checked: false },
              content: [p('다음')],
            },
          ],
        },
      ],
    })
    const once = docToMarkdown(doc)
    expect(once).toBe('- [ ] \n  - [x] 하위\n- [ ] 다음')
    expect(markdownToDoc(once).toJSON()).toEqual(doc.toJSON())
  })

  it('표 셀 안 체크리스트는 HTML 표로 저장돼 체크 상태와 표가 유지된다', () => {
    const doc = getMarkdownSchema().nodeFromJSON({
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableHeader',
                  content: [
                    {
                      type: 'paragraph',
                      content: [{ type: 'text', text: 'h' }],
                    },
                  ],
                },
              ],
            },
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableCell',
                  content: [
                    {
                      type: 'taskList',
                      content: [
                        {
                          type: 'taskItem',
                          attrs: { checked: true },
                          content: [
                            {
                              type: 'paragraph',
                              content: [{ type: 'text', text: 'c' }],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    })
    const once = docToMarkdown(doc)
    expect(once).not.toContain('\\[')
    const back = markdownToDoc(once)
    expect(back.childCount).toBe(1)
    expect(back.firstChild?.type.name).toBe('table')
    expect(taskItems(once)).toEqual([{ checked: true, text: 'c' }])
    expect(back.textContent).toBe('hc')
    expect(roundtrip(once)).toBe(once)
  })
})
