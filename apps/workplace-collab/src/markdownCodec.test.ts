import './dom-install'

import { docToMarkdown, markdownToDoc } from '@smart-workplace/wiki-editor-schema'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'

import { FRAGMENT, markdownToYUpdate, replaceWithMarkdown, yDocToMarkdown } from './markdownCodec'

/** md → Y.Doc → md 한 바퀴. */
function viaYjs(md: string): string {
  const doc = new Y.Doc()
  Y.applyUpdate(doc, markdownToYUpdate(md))
  return yDocToMarkdown(doc)
}

/** Y 조각 안 특정 노드 이름의 개수(멘션 칩 중복 검사용). */
function countNodes(doc: Y.Doc, nodeName: string): number {
  let n = 0
  const walk = (el: Y.XmlElement | Y.XmlFragment) => {
    for (const child of el.toArray()) {
      if (child instanceof Y.XmlElement) {
        if (child.nodeName === nodeName) n += 1
        walk(child)
      }
    }
  }
  walk(doc.getXmlFragment(FRAGMENT))
  return n
}

// 서버측 md ↔ Yjs 변환 — 이관(최초 로드)·파생 body·외부 본문 반영의 기반.
describe('markdownCodec', () => {
  it('builds a Y.Doc from markdown and serializes it back unchanged', () => {
    // 표 직렬화는 끝에 개행을 남긴다(tiptap-markdown 표 직렬화기) — 기존 저장본과 같은 형태.
    const md = '# 제목\n\n본문 <@5>\n\n| a |\n| --- |\n| 1 |\n'
    expect(viaYjs(md)).toBe(md)
  })

  it('parses mention tokens once without duplicate chips', () => {
    const md = '본문 <@5> 과 <#page:12> 그리고 <#issue:7>'
    const doc = new Y.Doc()
    Y.applyUpdate(doc, markdownToYUpdate(md))
    expect(countNodes(doc, 'wikiMention')).toBe(3)
    expect(yDocToMarkdown(doc)).toBe(md)
  })

  it('replace touches only changed blocks so an unrelated concurrent edit survives', () => {
    const base = '첫 문단\n\n둘째 문단'
    const server = new Y.Doc()
    Y.applyUpdate(server, markdownToYUpdate(base))
    const client = new Y.Doc()
    Y.applyUpdate(client, Y.encodeStateAsUpdate(server))
    // 클라이언트가 둘째 문단을 고치는 동안 서버가 첫 문단을 교체
    const frag = client.getXmlFragment(FRAGMENT)
    const second = frag.get(1) as Y.XmlElement
    ;(second.get(0) as Y.XmlText).insert(0, '수정된 ')
    replaceWithMarkdown(server, '바뀐 첫 문단\n\n둘째 문단', { actor: 'test' })
    Y.applyUpdate(server, Y.encodeStateAsUpdate(client))
    Y.applyUpdate(client, Y.encodeStateAsUpdate(server))
    expect(yDocToMarkdown(server)).toBe('바뀐 첫 문단\n\n수정된 둘째 문단')
    expect(yDocToMarkdown(client)).toBe(yDocToMarkdown(server))
  })

  it('passes the transaction origin through to update listeners', () => {
    const doc = new Y.Doc()
    Y.applyUpdate(doc, markdownToYUpdate('a'))
    const origins: unknown[] = []
    doc.on('update', (_u: Uint8Array, origin: unknown) => origins.push(origin))
    const origin = { actor: 'ai' }
    replaceWithMarkdown(doc, 'b', origin)
    expect(origins).toEqual([origin])
  })

  // 골든 — Yjs 를 한 번 거쳐도 기존 웹 경로(ProseMirror 직렬화)와 같은 마크다운이 나와야 한다(스펙 §10).
  // 기준은 "PM 한 바퀴" 결과: Y 경유가 그 위에 추가 손실을 만들지 않음을 본다. 정규화 없는 입력은 원문과도 같아야 한다.
  describe('golden round-trip through Yjs', () => {
    const cases: Array<[string, string, { exact?: boolean }]> = [
      ['E2E 픽스처 본문', '# 온보딩\n신규 입사자를 위한 안내 문서입니다.', {}],
      ['제목·목록·코드·한글', '# 회의록\n\n- 항목 1\n- 항목 2\n\n```ts\nconst a = 1\n```\n\n한글 문단입니다.', { exact: true }],
      ['순서 목록·인용·강조', '1. 하나\n2. 둘\n\n> 인용문\n\n**굵게** *기울임* ~~취소~~ `코드`', { exact: true }],
      ['GFM 표(셀 안 파이프 이스케이프)', '| a | b |\n| --- | --- |\n| 1 | 2 \\| 3 |\n', { exact: true }],
      ['이미지', '![설명](/api/v1/wiki/attachments/1)\n\n![](/api/v1/wiki/attachments/2)', {}],
      ['멘션 3종', '담당 <@5> · 문서 <#page:12> · 이슈 <#issue:7>', { exact: true }],
      ['코드 안 멘션 토큰은 글자 그대로', '`<@5>` 와\n\n```\n<#page:1>\n```', { exact: true }],
      ['병합 셀 표(raw HTML 폴백)', '<table><tbody><tr><td colspan="2">병합</td></tr><tr><td>a</td><td>b</td></tr></tbody></table>', {}],
      ['하드 브레이크·수평선', '첫 줄  \n둘째 줄\n\n---\n\n끝', {}],
    ]

    it.each(cases)('%s', (_name, md, { exact }) => {
      const viaPm = docToMarkdown(markdownToDoc(md))
      const once = viaYjs(md)
      expect(once).toBe(viaPm)
      // 저장 → 재로드 → 재저장이 안정적이어야 이관 후 매 저장마다 본문이 흔들리지 않는다.
      expect(viaYjs(once)).toBe(once)
      if (exact) expect(once).toBe(md)
    })
  })
})
