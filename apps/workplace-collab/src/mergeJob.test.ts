import './dom-install'

import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'

import { applyKeepLivePlan, FRAGMENT, normalizeMarkdown } from './markdownCodec'
import { handleJob } from './mergeJob'
import { liveDoc, rootOf, typeIn } from './testing/liveDoc'
import type { LiveMergeResult } from './mergeRunner'

/**
 * 병합 워커 작업(handleJob) — 운영 경로 그대로: 기준본·AI본은 정규화해서(prepare 와 같은 normalizeMarkdown) 넘기고, 현재본은 워커가
 * 실시간 상태에서 공용 직렬화기로 만든다(다시 정규화하지 않음, WP-329). 사람이 공백만 고친 블록은 병합 출력 표기엔 남을 수 있지만
 * 보이는 결과(적용 뒤 실시간 문서)는 keepLive 가 지킨다 — 그래서 여기선 실시간 문서를 본다.
 */

/** 병합 작업 하나를 돌리고 계획을 적용한다(스레드 경계처럼 structuredClone). */
function mergeLive(doc: Y.Doc, base: string, ai: string): LiveMergeResult {
  const reply = handleJob({ id: 1, kind: 'merge', bases: [normalizeMarkdown(base)], ai: normalizeMarkdown(ai), live: Y.encodeStateAsUpdate(doc) })
  if (!reply.ok) throw new Error(reply.error)
  const r = reply.value as LiveMergeResult
  applyKeepLivePlan(doc, structuredClone(r.plan), 'ai')
  return r
}

describe('merge job — 사람이 공백만 고친 블록(WP-329)', () => {
  it('(a) keeps two spaces typed at the end of a list item (before its nested list) when the AI edits elsewhere', () => {
    const base = '- 안건\n  - 하위\n\n끝 문단'
    const doc = liveDoc(base, (f) => typeIn(f, [0, 0, 0], '  '))
    const r = mergeLive(doc, base, base.replace('끝 문단', '끝 문단 AI'))
    expect(r.conflicts).toBe(0)
    // 사람이 친 공백은 실시간 노드에 그대로 남는다(손대지 않은 블록은 keepLive 가 실시간 노드를 쓴다).
    expect(rootOf(doc).child(0).child(0).child(0).textContent).toBe('안건  ')
    expect(rootOf(doc).textContent).not.toContain('\\')
    expect(rootOf(doc).textContent).toContain('끝 문단 AI')
  })

  it('(b) takes the AI text without a conflict when the person only added leading spaces to the block the AI edited', () => {
    const base = '첫 문단입니다\n\n둘째 문단'
    const doc = liveDoc(base, (f) => typeIn(f, [0], '  ', 0))
    const r = mergeLive(doc, base, 'AI 첫 문단입니다\n\n둘째 문단')
    expect(r.conflicts).toBe(0)
    expect(rootOf(doc).child(0).textContent).toBe('AI 첫 문단입니다')
  })

  it('(c) leaves the live blocks untouched when the person typed only whitespace and the AI sent the same body', () => {
    const base = '첫 문단\n\n둘째 문단'
    const doc = liveDoc(base, (f) => typeIn(f, [1], '  ', 0))
    const second = doc.getXmlFragment(FRAGMENT).get(1) as Y.XmlElement
    const before = second.toString()
    const r = mergeLive(doc, base, base)
    expect(r.conflicts).toBe(0)
    expect(r.plan.blocks).toEqual([0, 1])
    expect(doc.getXmlFragment(FRAGMENT).get(1)).toBe(second)
    expect(second.toString()).toBe(before)
  })
})

// 줄 안 강제 줄바꿈 표기(Task 8 후속) — 기준본·AI본은 정규화, 현재본은 직렬화기 출력이라 모두 `\` + 줄바꿈 표기다(canonicalBreaks 불필요).
describe('merge job — 강제 줄바꿈 표기(WP-329, 블록 병합 테스트에서 옮김)', () => {
  it('does not duplicate a paragraph whose hard break is written with trailing spaces in the base', () => {
    const base = '가  \n나'
    const doc = liveDoc(base)
    const r = mergeLive(doc, base, '가\n나')
    expect(r.markdown).toBe(normalizeMarkdown('가\n나'))
    expect(rootOf(doc).childCount).toBe(1)
    expect(rootOf(doc).textContent.match(/가/g)).toHaveLength(1)
  })

  it('does not duplicate it next to a person edit in another block', () => {
    const base = '앞 문단\n\n가  \n나'
    const doc = liveDoc(base, (f) => typeIn(f, [0], ' 사람'))
    expect(mergeLive(doc, base, '앞 문단\n\n가\n나').markdown).toBe(normalizeMarkdown('앞 문단 사람\n\n가\n나'))
  })

  it('keeps a person edit next to a hard break written in the other notation', () => {
    const base = '첫 줄 내용입니다  \n둘째 줄 내용입니다'
    const doc = liveDoc(base, (f) => typeIn(f, [0], ' 사람'))
    const r = mergeLive(doc, base, '첫 줄 내용입니다 AI\\\n둘째 줄 내용입니다')
    expect(r).toMatchObject({ markdown: '첫 줄 내용입니다 AI\\\n둘째 줄 내용입니다 사람', conflicts: 0 })
  })

  it('takes the AI soft break over a real hard break inside a list item and a blockquote', () => {
    for (const [base, ai] of [
      ['- 가  \n  나\n\n끝', '- 가\n  나\n\n끝'],
      ['> 가  \n> 나', '> 가\n> 나'],
    ]) {
      expect(mergeLive(liveDoc(base), base, ai).markdown).toBe(normalizeMarkdown(ai))
    }
  })

  it('keeps the AI edit when one block has both a real hard break and plain trailing spaces', () => {
    const base = '- 가  \n  나  \n  - 하위'
    const r = mergeLive(liveDoc(base), base, '- 가\\\n  나 AI\n  - 하위')
    expect(r).toMatchObject({ markdown: '- 가\\\n  나 AI\n  - 하위', conflicts: 0 })
  })
})
