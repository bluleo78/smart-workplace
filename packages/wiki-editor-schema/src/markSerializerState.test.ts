import type { Node as PMNode } from '@tiptap/pm/model'
import { describe, expect, it } from 'vitest'

import { docToMarkdown, getMarkdownSchema, markdownToDoc } from './markdown'

// WP-1318 — 한 글자에 굵게·기울임·취소선을 함께 걸면 닫는 표시가 어긋나(가***~~나~~~~*다) 다시 읽을 때 모양이 바뀌었다.
// 글자 사이에 종류가 다른 표시가 맞붙으면 CommonMark 로 나타낼 수 없어 그 마크들은 HTML 태그로 저장한다.
const schema = getMarkdownSchema()
const text = (t: string, ...marks: string[]) => schema.text(t, marks.map((m) => schema.marks[m].create()))
const para = (...nodes: PMNode[]) => schema.node('doc', null, [schema.node('paragraph', null, nodes)])

describe('overlapping bold/italic/strike (WP-1318)', () => {
  const cases: [string, PMNode, string][] = [
    ['bold+italic+strike between letters', para(text('가'), text('나', 'bold', 'italic', 'strike'), text('다')), '가<strong><em><s>나</s></em></strong>다'],
    ['bold+strike between letters', para(text('가'), text('나', 'bold', 'strike'), text('다')), '가<strong><s>나</s></strong>다'],
    ['italic+strike between letters', para(text('가'), text('나', 'italic', 'strike'), text('다')), '가<em><s>나</s></em>다'],
    ['strike ends inside bold', para(text('가'), text('나', 'bold', 'strike'), text('다', 'bold'), text('라')), '가<strong><s>나</s>다</strong>라'],
    ['strike starts inside bold', para(text('가'), text('나', 'bold'), text('다', 'bold', 'strike'), text('라')), '가<strong>나<s>다</s></strong>라'],
    // 바깥이 공백·문단 끝이면 마크다운으로 나타낼 수 있어 그대로 둔다.
    ['bold+italic+strike between spaces', para(text('가 '), text('나', 'bold', 'italic', 'strike'), text(' 다')), '가 ***~~나~~*** 다'],
    ['bold+italic+strike alone', para(text('나', 'bold', 'italic', 'strike')), '***~~나~~***'],
    // 같은 종류(*)만 맞붙으면 CommonMark 로 된다 — 수정 전과 같다.
    ['bold+italic between letters', para(text('가'), text('나', 'bold', 'italic'), text('다')), '가***나***다'],
  ]

  it.each(cases)('%s: saves readable markdown', (_name, doc, expected) => {
    expect(docToMarkdown(doc)).toBe(expected)
  })

  it.each(cases)('%s: reads back the same marks', (_name, doc) => {
    expect(markdownToDoc(docToMarkdown(doc)).eq(doc)).toBe(true)
  })

  it.each(cases)('%s: is idempotent', (_name, doc) => {
    const once = docToMarkdown(doc)
    expect(docToMarkdown(markdownToDoc(once))).toBe(once)
  })

  // 수정 전에는 닫을 때 맨 위 기록을 꺼내 엉뚱한 마크의 표시를 밀었다 — 연이은 다른 마크는 영향이 없어야 한다.
  it.each([
    [para(text('a', 'bold'), text('b', 'italic')), '**a***b*'],
    [para(text('a', 'bold'), text('b', 'strike'), text('c')), '**a**~~b~~c'],
  ])('neighbouring marks stay markdown (%#)', (doc, expected) => {
    expect(docToMarkdown(doc)).toBe(expected)
    expect(markdownToDoc(expected).eq(doc)).toBe(true)
  })

  // 두 번째 문단·인용·목록 안 — 앞 블록의 빈 줄·줄 머리 접두어(> , - )가 표시 자리보다 늦게 쓰여도 같게 처리돼야 한다.
  const bis = () => text('나', 'bold', 'italic', 'strike')
  const p = (...nodes: PMNode[]) => schema.node('paragraph', null, nodes)
  it.each([
    ['second paragraph', schema.node('doc', null, [p(text('가')), p(bis(), text('다'))]), '가\n\n<strong><em><s>나</s></em></strong>다'],
    ['second paragraph with letter before', schema.node('doc', null, [p(text('가')), p(text('가'), bis(), text('다'))]), '가\n\n가<strong><em><s>나</s></em></strong>다'],
    ['blockquote', schema.node('doc', null, [schema.node('blockquote', null, [p(text('가'), bis(), text('다'))])]), '> 가<strong><em><s>나</s></em></strong>다'],
    [
      'blockquote after hard break',
      schema.node('doc', null, [schema.node('blockquote', null, [p(text('가'), schema.node('hardBreak'), bis(), text('다'))])]),
      '> 가\\\n> <strong><em><s>나</s></em></strong>다',
    ],
    [
      'list item',
      schema.node('doc', null, [schema.node('bulletList', null, [schema.node('listItem', null, [p(text('가'), bis(), text('다'))])])]),
      '- 가<strong><em><s>나</s></em></strong>다',
    ],
  ])('%s: round-trips', (_name, doc, expected) => {
    const md = docToMarkdown(doc)
    expect(md).toBe(expected)
    expect(markdownToDoc(md).eq(doc)).toBe(true)
  })

  // 다른 블록 뒤에 와도 첫 블록과 같게 민다(수정 전에는 자리 계산이 앞 블록의 빈 줄을 가리켰다).
  it('trims a single mark the same in the first and a later paragraph', () => {
    const quoted = () => p(text('"인용"', 'bold'), text('다'))
    const first = docToMarkdown(schema.node('doc', null, [quoted()]))
    const later = docToMarkdown(schema.node('doc', null, [p(text('가')), quoted()]))
    expect(later).toBe(`가\n\n${first}`)
  })
})

// WP-1638 — 읽기를 CJK 친화 규칙으로 바꿨으니 저장 판정도 같은 규칙이어야 한다. 그대로 두면 문장부호로 끝나는 굵게 뒤에
// 조사가 오면 닫는 표시를 안쪽으로 밀어 `**설정(A**)을` 로 저장했다(다시 읽으면 굵게 범위에서 `)` 가 빠진다).
describe('CJK 친화 판정으로 표시를 옮기지 않는다 (WP-1638)', () => {
  it.each([
    [para(text('설정(A)', 'bold'), text('을')), '**설정(A)**을'],
    [para(text('"허용"', 'bold'), text('으로')), '**"허용"**으로'],
    [para(text('가'), text('(나)', 'italic'), text('다')), '가*(나)*다'],
  ])('%#: saves without shifting markers', (doc, expected) => {
    expect(docToMarkdown(doc)).toBe(expected)
    expect(markdownToDoc(expected).eq(doc)).toBe(true)
  })

  // 라틴 글자 사이는 CommonMark 대로 표시를 민다(수정 전과 같음).
  it('still shifts markers between Latin letters', () => {
    expect(docToMarkdown(para(text('foo(a)', 'bold'), text('bar')))).toBe('**foo(a**)bar')
  })
})
