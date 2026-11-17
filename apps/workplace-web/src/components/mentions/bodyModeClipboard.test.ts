// 본문 모드 붙여넣기·복사 순수 함수(WP-1656) — 붙여넣은 부분이 클립보드 글자와 같고, 복사한 글자가 원문과 줄 간격이 같아야 한다.
// ProseMirror 기본은 붙여넣을 때 연속 줄바꿈을 하나로 합치고(text.split(/(?:\r\n?|\n)+/)) 복사할 때 문단 사이를 "\n\n" 으로 내보낸다.
import { getSchema } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import HardBreak from '@tiptap/extension-hard-break'
import Mention from '@tiptap/extension-mention'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { describe, expect, it } from 'vitest'

import { OTHER_PROJECT_IMAGE, WP_IMAGE } from './__fixtures__/issueBodySamples'
import { bodyTextToSlice, sliceToBodyText } from './bodyModeClipboard'
import { bodyToDoc } from './mentionSerialize'
import { createRichBodyImage } from './richImageNode'

// 본문 모드 RichInput 과 같은 스키마.
const schema = getSchema([Document, Paragraph, Text, HardBreak, Mention, createRichBodyImage('WP')])
const OPTS = { mentions: [{ id: 12, name: '홍길동', kind: 'HUMAN' as const }], projectKey: 'WP' }

describe('bodyTextToSlice', () => {
  it('줄바꿈(\\n·\\r\\n·\\r) 하나마다 문단 하나 — 빈 줄도 빈 문단, 열린 조각(1,1)', () => {
    const slice = bodyTextToSlice('a\n\nb\r\nc', schema, OPTS)
    expect(slice.openStart).toBe(1)
    expect(slice.openEnd).toBe(1)
    const paras: string[] = []
    slice.content.forEach((n) => {
      expect(n.type.name).toBe('paragraph')
      paras.push(n.textContent)
    })
    expect(paras).toEqual(['a', '', 'b', 'c'])
  })

  it('\\r 만 있는 줄바꿈도 문단을 나눈다', () => {
    expect(bodyTextToSlice('a\rb', schema, OPTS).content.childCount).toBe(2)
  })

  it('이 프로젝트 이미지 마크다운 줄은 image 노드, 다른 프로젝트 이미지는 글자', () => {
    const slice = bodyTextToSlice(`![화면](${WP_IMAGE})\n![남](${OTHER_PROJECT_IMAGE})`, schema, OPTS)
    const first = slice.content.child(0).firstChild
    expect(first?.type.name).toBe('image')
    expect(first?.attrs.src).toBe(WP_IMAGE)
    expect(first?.attrs.alt).toBe('화면')
    const second = slice.content.child(1)
    expect(second.childCount).toBe(1)
    expect(second.firstChild?.isText).toBe(true)
    expect(second.textContent).toBe(`![남](${OTHER_PROJECT_IMAGE})`)
  })

  it('<@id> 토큰은 멘션 노드(이름은 멘션 목록에서)', () => {
    const node = bodyTextToSlice('<@12> 님', schema, OPTS).content.child(0).firstChild
    expect(node?.type.name).toBe('mention')
    expect(node?.attrs.id).toBe(12)
    expect(node?.attrs.label).toBe('홍길동')
  })
})

describe('sliceToBodyText', () => {
  it('붙여넣기 조각을 문단 사이 줄바꿈 하나로 내보낸다(\\r\\n 은 \\n)', () => {
    expect(sliceToBodyText(bodyTextToSlice('a\n\nb\r\nc', schema, OPTS))).toBe('a\n\nb\nc')
  })

  it.each([
    ['표', '| 열 | 값 |\n|---|---|\n| a | 1 |'],
    ['코드 펜스 안 빈 줄', '```ts\nconst a = 1\n\n\nconst b = 2\n```'],
    ['빈 줄 여러 개와 앞뒤 공백·탭', '\n  위\n\n\n\t아래  \n\n'],
    ['이미지·멘션', `앞 <@12> 뒤\n![화면](${WP_IMAGE})\n![남](${OTHER_PROJECT_IMAGE})`],
    ['꺾쇠 글자', '<note> <a@b.c> <b>x</b>'],
  ])('%s — 여러 줄 마크다운이 붙여넣고 복사해도 그대로', (_name, text) => {
    expect(sliceToBodyText(bodyTextToSlice(text, schema, OPTS))).toBe(text)
  })

  it('\\r\\n 원문은 \\n 으로 바뀐 것만 다르다', () => {
    const text = '| a |\r\n|---|\r\n\r\n```\r\nx\r\n```'
    expect(sliceToBodyText(bodyTextToSlice(text, schema, OPTS))).toBe(text.replace(/\r\n/g, '\n'))
  })

  it('한 문단 안에서 고른 글자(인라인 조각)는 그 글자만', () => {
    const doc = schema.nodeFromJSON(bodyToDoc('abc <@12> def', OPTS.mentions, { images: true, imageProjectKey: 'WP' }))
    // 문단 안 1~끝: 문단 깊이에서 자른 조각은 인라인 노드만 담는다(openStart 0).
    const slice = doc.slice(2, doc.child(0).nodeSize - 2)
    expect(sliceToBodyText(slice)).toBe('bc <@12> de')
  })

  it('여러 문단에 걸쳐 고른 글자는 문단 사이 줄바꿈 하나 — 빈 문단도 줄 하나', () => {
    const doc = schema.nodeFromJSON(bodyToDoc('첫 줄\n\n셋째 줄\n넷째', [], { images: true, imageProjectKey: 'WP' }))
    // 「첫 줄」의 「줄」부터 「셋째 줄」의 「셋째」까지.
    const from = 1 + 2
    const to = doc.child(0).nodeSize + doc.child(1).nodeSize + 1 + 2
    expect(sliceToBodyText(doc.slice(from, to))).toBe('줄\n\n셋째')
  })

  it('hardBreak 는 줄바꿈으로', () => {
    const doc = schema.nodeFromJSON({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }, { type: 'hardBreak' }, { type: 'text', text: 'b' }] }],
    })
    expect(sliceToBodyText(doc.slice(0, doc.content.size))).toBe('a\nb')
  })
})
