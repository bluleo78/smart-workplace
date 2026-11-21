// @vitest-environment jsdom
// sentPrefixEnd(WP-1923) — 보낸 문서가 지금 문서의 앞부분인지 판정하고 지울 위치를 돌려준다.
import { getSchema } from '@tiptap/core'
import CodeBlock from '@tiptap/extension-code-block'
import Document from '@tiptap/extension-document'
import HardBreak from '@tiptap/extension-hard-break'
import Mention from '@tiptap/extension-mention'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { Node as PMNode } from '@tiptap/pm/model'
import { Transform } from '@tiptap/pm/transform'
import { describe, expect, it } from 'vitest'

import { sentPrefixEnd } from './sentPrefix'

// RichInput 과 같은 노드 구성(멘션 포함)으로 스키마를 만든다.
const schema = getSchema([Document, Paragraph, Text, HardBreak, Mention, CodeBlock])

type Block = Array<string | { mention: string } | 'br'>

/** 문단 목록(글자·멘션 조각 배열)으로 문서를 만든다. */
function doc(...paras: Block[]): PMNode {
  return PMNode.fromJSON(schema, {
    type: 'doc',
    content: paras.map((p) => ({
      type: 'paragraph',
      content: p.map((c) =>
        c === 'br'
          ? { type: 'hardBreak' }
          : typeof c === 'string'
          ? { type: 'text', text: c }
          : { type: 'mention', attrs: { id: c.mention, label: c.mention } },
      ),
    })),
  })
}

/** 지금 문서에서 0~pos 를 지운 뒤의 문서. */
function afterDelete(current: PMNode, pos: number): PMNode {
  const tr = new Transform(current)
  tr.delete(0, pos)
  return tr.doc
}

describe('sentPrefixEnd', () => {
  it('같은 문서면 same', () => {
    expect(sentPrefixEnd(doc(['안녕']), doc(['안녕']))).toBe('same')
  })

  it('같은 문단 끝에 이어 쓰면 보낸 글자만 지워진다', () => {
    const current = doc(['안녕 반가워'])
    const pos = sentPrefixEnd(doc(['안녕']), current)
    expect(typeof pos).toBe('number')
    expect(afterDelete(current, pos as number).eq(doc([' 반가워']))).toBe(true)
  })

  it('새 문단을 더하면 빈 문단 없이 새 문단만 남는다', () => {
    const current = doc(['안녕'], ['다음'])
    const pos = sentPrefixEnd(doc(['안녕']), current)
    expect(typeof pos).toBe('number')
    expect(afterDelete(current, pos as number).eq(doc(['다음']))).toBe(true)
  })

  it('보낸 부분을 고쳤으면 null', () => {
    expect(sentPrefixEnd(doc(['안녕']), doc(['안해']))).toBeNull()
  })

  it('멘션이 있어도 뒤에 이어 쓴 글자만 남는다', () => {
    const current = doc([{ mention: 'kim' }, '하이 더'])
    const pos = sentPrefixEnd(doc([{ mention: 'kim' }, '하이']), current)
    expect(typeof pos).toBe('number')
    expect(afterDelete(current, pos as number).eq(doc([' 더']))).toBe(true)
  })

  it('보낸 글 뒤쪽이 지워졌으면(지금이 더 짧음) null', () => {
    expect(sentPrefixEnd(doc(['안녕 반가워']), doc(['안녕']))).toBeNull()
  })

  it('Shift+Enter(hardBreak) 로 이어 쓰면 줄바꿈까지 지워 빈 줄이 남지 않는다', () => {
    const current = doc(['안녕', 'br', '다음'])
    const pos = sentPrefixEnd(doc(['안녕']), current)
    expect(afterDelete(current, pos as number).eq(doc(['다음']))).toBe(true)
  })

  it('줄바꿈을 두 번 띄워 이어 쓰면 가르는 줄바꿈 하나만 지우고 일부러 띄운 빈 줄은 남긴다', () => {
    const current = doc(['안녕', 'br', 'br', '다음'])
    const pos = sentPrefixEnd(doc(['안녕']), current)
    expect(afterDelete(current, pos as number).eq(doc(['br', '다음']))).toBe(true)
  })

  it('코드 블록 안에서 줄을 바꿔 이어 쓰면 \\n 까지 지운다', () => {
    const code = (text: string) =>
      PMNode.fromJSON(schema, { type: 'doc', content: [{ type: 'codeBlock', content: [{ type: 'text', text }] }] })
    const current = code('a = 1\nb = 2')
    const pos = sentPrefixEnd(code('a = 1'), current)
    expect(afterDelete(current, pos as number).eq(code('b = 2'))).toBe(true)
  })
})
