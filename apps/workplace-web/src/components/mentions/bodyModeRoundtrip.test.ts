// 본문 모드 원문 보존 왕복(WP-1656) — 이슈 본문을 본문 모드 RichInput 으로 열고 그대로 저장하면 원문이 한 바이트도 바뀌지 않아야 한다
// (AI·MCP 가 그 원문을 그대로 다시 읽는다). 문서 JSON 만이 아니라 실제 편집기 스키마(Node.fromJSON)를 한 번 거친 문서로도 본다 —
// 스키마가 텍스트·속성을 바꾸면 화면에서 연 문서가 달라지기 때문.
import type { JSONContent } from '@tiptap/core'
import { getSchema } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import HardBreak from '@tiptap/extension-hard-break'
import Mention from '@tiptap/extension-mention'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { Node as PMNode } from '@tiptap/pm/model'
import { describe, expect, it } from 'vitest'

import { ISSUE_BODY_SAMPLES, OTHER_PROJECT_IMAGE, SYNTHETIC_SAMPLES, WP_IMAGE } from './__fixtures__/issueBodySamples'
import { bodyToDoc, serializeToBody } from './mentionSerialize'
import { createRichBodyImage } from './richImageNode'

const OPTS = { images: true, imageProjectKey: 'WP' }
const ALL = [...ISSUE_BODY_SAMPLES, ...SYNTHETIC_SAMPLES]

// 본문 모드 RichInput 과 같은 스키마(멘션·이미지·hardBreak 포함).
const schema = getSchema([Document, Paragraph, Text, HardBreak, Mention, createRichBodyImage('WP')])

/** 원문 → 편집기 문서(스키마 통과) → 원문. */
function throughEditor(body: string): string {
  const doc = PMNode.fromJSON(schema, bodyToDoc(body, [], OPTS))
  return serializeToBody(doc.toJSON() as JSONContent)
}

/** 문서 안 노드 이름 목록(깊이 우선). */
function nodeTypes(doc: JSONContent): string[] {
  return (doc.content ?? []).flatMap((n) => [n.type ?? '', ...nodeTypes(n)])
}

describe('본문 모드 원문 왕복', () => {
  it('실제 WP 표본이 11건 다 있다', () => {
    expect(ISSUE_BODY_SAMPLES.map((s) => s.key)).toEqual([
      'WP-1024', 'WP-1146', 'WP-1461', 'WP-571', 'WP-594', 'WP-1340', 'WP-1342', 'WP-1081', 'WP-163', 'WP-361', 'WP-1656',
    ])
  })

  it.each(ALL)('$key — 열고 그대로 직렬화하면 원문과 같다', ({ body }) => {
    expect(serializeToBody(bodyToDoc(body, [], OPTS))).toBe(body)
    expect(throughEditor(body)).toBe(body)
  })

  it('이 프로젝트 이미지 줄은 image 노드가 된다', () => {
    const doc = bodyToDoc(`위\n![화면](${WP_IMAGE})\n아래`, [], OPTS)
    expect(doc.content?.[1]).toEqual({ type: 'paragraph', content: [{ type: 'image', attrs: { src: WP_IMAGE, alt: '화면' } }] })
  })

  it('다른 프로젝트 이미지는 image 노드가 되지 않고 글자로 남는다', () => {
    const body = `![남의 것](${OTHER_PROJECT_IMAGE})`
    const doc = bodyToDoc(body, [], OPTS)
    expect(nodeTypes(doc)).not.toContain('image')
    expect(doc.content?.[0]).toEqual({ type: 'paragraph', content: [{ type: 'text', text: body }] })
  })

  it('저장 형식과 다른 모양의 이미지 마크다운(alt 앞뒤 공백·[)은 글자로 남아 원문이 바뀌지 않는다', () => {
    const body = `![ 공백 ](${WP_IMAGE})\n![a[b](${WP_IMAGE})`
    expect(nodeTypes(bodyToDoc(body, [], OPTS))).not.toContain('image')
    expect(throughEditor(body)).toBe(body)
  })

  it('\\r\\n·\\r 줄바꿈도 줄로 나눠 문단에 \\r 이 남지 않는다 — 저장하면 \\n 줄(코드 리뷰 지적)', () => {
    const body = '| a |\r\n|---|\r\n\r\n끝\r마지막'
    const doc = bodyToDoc(body, [], OPTS)
    expect(doc.content?.map((p) => p.content?.[0]?.text ?? '')).toEqual(['| a |', '|---|', '', '끝', '마지막'])
    expect(JSON.stringify(doc)).not.toContain('\\r')
    expect(throughEditor(body)).toBe(body.replace(/\r\n?/g, '\n'))
  })

  it('코멘트 입력창(imageProjectKey 없음)은 지금처럼 \\n 으로만 나눈다', () => {
    expect(bodyToDoc('a\r\nb', [], { images: true }).content?.[0]).toEqual({ type: 'paragraph', content: [{ type: 'text', text: 'a\r' }] })
  })

  it('<@id> 는 다시 써도 같은 숫자일 때만 멘션 — <@007>·안전한 정수를 넘는 id 는 글자로 남는다(코드 리뷰 지적)', () => {
    const body = '<@007> <@99999999999999999999> <@0> <@7>'
    const doc = bodyToDoc(body, [{ id: 7, name: '김개발', kind: 'HUMAN' }], OPTS)
    const inline = doc.content?.[0]?.content ?? []
    expect(inline.filter((n) => n.type === 'mention').map((n) => n.attrs?.id)).toEqual([0, 7])
    expect(throughEditor(body)).toBe(body)
  })

  it('imageProjectKey 가 없으면(코멘트) 어느 프로젝트 이미지든 지금처럼 노드가 된다', () => {
    const doc = bodyToDoc(`![남의 것](${OTHER_PROJECT_IMAGE})`, [], { images: true })
    expect(nodeTypes(doc)).toContain('image')
  })

  it.each(ALL.filter((s) => /[^\n]/.test(s.body)))('$key — 마지막 글자 뒤에 한 글자만 고치면 그 글자만 달라진다', ({ body }) => {
    const doc = bodyToDoc(body, [], OPTS)
    // 마지막 텍스트 노드를 찾는다(문단 역순 → 노드 역순).
    const paras = doc.content ?? []
    let target: JSONContent | undefined
    for (let p = paras.length - 1; p >= 0 && !target; p--) {
      const inline = paras[p].content ?? []
      for (let i = inline.length - 1; i >= 0; i--) {
        if (inline[i].type === 'text') {
          target = inline[i]
          break
        }
      }
    }
    if (!target) return // 이미지·멘션만 있는 본문 — 글자 노드가 없다
    // 고칠 자리를 원문 위치로 찾으려고 표지 글자를 한 번 넣어 직렬화한다(직렬화가 순서대로 이어 붙이므로 표지 위치 = 원문 위치).
    const original = target.text ?? ''
    target.text = `${original}\u0000`
    const at = serializeToBody(doc).indexOf('\u0000')
    target.text = `${original}X`
    const edited = serializeToBody(PMNode.fromJSON(schema, doc).toJSON() as JSONContent)
    expect(edited).toBe(`${body.slice(0, at)}X${body.slice(at)}`)
  })
})
