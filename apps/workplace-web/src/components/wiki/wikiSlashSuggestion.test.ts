// @vitest-environment jsdom
import { wikiSchemaExtensions } from '@smart-workplace/wiki-editor-schema'
import { Editor } from '@tiptap/core'
import { describe, expect, it } from 'vitest'

import { applyBlockCommand, filterSlashItems } from './wikiSlashSuggestion'

// 슬래시 메뉴 항목 거르기 — 공유 링크 화면(WP-579)은 AI 항목 없이 서식·삽입만.
describe('filterSlashItems', () => {
  const keys = (q: string, opts: { inTable: boolean; aiEnabled: boolean }) => filterSlashItems(q, opts).map((i) => i.key)

  it('AI 를 쓸 수 있으면 AI 항목이 함께 있다', () => {
    expect(keys('', { inTable: false, aiEnabled: true })).toEqual(expect.arrayContaining(['table', 'heading1', 'draft', 'continue']))
  })
  it('공유 화면(AI 못 씀)이면 AI 항목만 빠진다', () => {
    const k = keys('', { inTable: false, aiEnabled: false })
    expect(k).toEqual(expect.arrayContaining(['table', 'image', 'heading1', 'horizontalRule']))
    expect(k).not.toContain('draft')
    expect(k).not.toContain('continue')
    // 입력으로 찾아도 AI 호출 항목은 나오지 않는다(삽입 항목 「AI 지시」(WP-1482)는 LLM 을 거치지 않아 남는다).
    expect(keys('AI', { inTable: false, aiEnabled: false })).toEqual(['aiInstruction'])
  })
  it('표 안에서는 표 항목을 뺀다', () => {
    expect(keys('', { inTable: true, aiEnabled: true })).not.toContain('table')
  })
  it('HTML 파일 넣기(WP-1241)는 표 밖에서만 보이고 「HTML」로 찾힌다', () => {
    expect(keys('', { inTable: false, aiEnabled: true })).toContain('htmlImport')
    expect(keys('', { inTable: true, aiEnabled: true })).not.toContain('htmlImport')
    expect(keys('HTML 파일', { inTable: false, aiEnabled: false })).toEqual(['htmlImport'])
    expect(keys('html', { inTable: false, aiEnabled: false })).toEqual(['htmlEmbed', 'htmlImport'])
  })
  it('상자(WP-1303)는 이미지 다음·HTML 블록 앞에 있고 표 안에서는 빠진다', () => {
    const k = keys('', { inTable: false, aiEnabled: false })
    expect(k.slice(0, 5)).toEqual(['table', 'image', 'box', 'aiInstruction', 'htmlEmbed'])
    expect(keys('', { inTable: true, aiEnabled: false })).not.toContain('box')
    expect(keys('상자', { inTable: false, aiEnabled: false })).toEqual(['box'])
  })
  it('AI 지시(WP-1482)는 상자 바로 다음에 있고 표 안에서는 빠지며 AI 꺼짐이어도 보인다', () => {
    for (const aiEnabled of [true, false]) {
      const k = keys('', { inTable: false, aiEnabled })
      expect(k.indexOf('aiInstruction')).toBe(k.indexOf('box') + 1)
      expect(keys('지시', { inTable: false, aiEnabled })).toEqual(['aiInstruction'])
    }
    expect(keys('', { inTable: true, aiEnabled: true })).not.toContain('aiInstruction')
    expect(filterSlashItems('', { inTable: false, aiEnabled: true }).find((i) => i.key === 'aiInstruction')).toMatchObject({
      label: 'AI 지시',
      kind: 'insert',
    })
  })
})

// 체크리스트(WP-1546) — 「/」 메뉴 블록 항목. 번호 목록 다음에 있고, 고르면 지금 문단이 체크리스트가 된다.
describe('체크리스트 슬래시 항목 (WP-1546)', () => {
  it('「체크리스트」 항목이 번호 목록 바로 다음에 블록 항목으로 있고 「체크」로 찾힌다', () => {
    const items = filterSlashItems('', { inTable: false, aiEnabled: false })
    const k = items.map((i) => i.key)
    expect(k.indexOf('taskList')).toBe(k.indexOf('orderedList') + 1)
    expect(items.find((i) => i.key === 'taskList')).toMatchObject({ label: '체크리스트', kind: 'block' })
    expect(filterSlashItems('체크', { inTable: false, aiEnabled: false }).map((i) => i.key)).toEqual(['taskList'])
  })

  it('표 안에서는 체크리스트 항목을 뺀다(셀에 넣으면 표 전체가 HTML 표로 저장된다)', () => {
    expect(filterSlashItems('', { inTable: true, aiEnabled: true }).map((i) => i.key)).not.toContain('taskList')
  })

  it('고르면 지금 문단이 체크 안 된 체크리스트 항목이 된다', () => {
    const editor = new Editor({ extensions: wikiSchemaExtensions(), content: '<p>할 일</p>' })
    editor.commands.setTextSelection(2)
    applyBlockCommand(editor.chain(), 'taskList')
    const json = editor.getJSON()
    expect(json.content?.[0]).toMatchObject({
      type: 'taskList',
      content: [{ type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '할 일' }] }] }],
    })
    editor.destroy()
  })
})
