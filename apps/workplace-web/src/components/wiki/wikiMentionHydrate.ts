// 로드 라운드트립 — 본문 마크다운에 리터럴 텍스트로 생존한 멘션 토큰(<@id>·<#page:id>·<#issue:id>)을
// 에디터 마운트 직후 ProseMirror 트랜잭션으로 스캔해 wikiMention 노드(칩)로 치환한다.
// html:true 부작용(위키 본문 raw HTML 허용) 없이 동작하도록 텍스트 노드 워크 방식을 쓴다.
//
// 위치 드리프트 회피: 모든 매치를 먼저 수집한 뒤 문서 뒤→앞(내림차순 pos)으로 한 트랜잭션에 치환한다.
// 라벨은 useWikiMentions 해소 결과(type+id 매칭)에서 채우되, 없으면 토큰 기반 placeholder 를 쓴다.

import type { Editor } from '@tiptap/react'

import type { WikiMentionRef } from '../../types/wiki'
import type { WikiMentionAttrs } from './wikiMentionNode'
import { parseWikiSegments, tokenFor } from './wikiMentionSerialize'

// 한 텍스트 노드 안에서 찾은 멘션 한 건 — 문서 절대 위치 + 노드 attrs.
interface MentionMatch {
  from: number
  to: number
  attrs: WikiMentionAttrs
}

// type+id → 라벨 해소 맵 키.
function refKey(type: string, id: number): string {
  return `${type}:${id}`
}

/**
 * 에디터 본문의 멘션 토큰을 wikiMention 노드로 치환한다.
 * @param editor 대상 에디터
 * @param mentions useWikiMentions 결과(라벨 해소용). 미도착이면 [] — placeholder 라벨 사용.
 * @returns 치환이 1건 이상 일어났으면 true(호출처에서 자동저장 가드 등에 활용).
 */
export function hydrateWikiMentions(editor: Editor, mentions: WikiMentionRef[]): boolean {
  // type+id → label 빠른 조회.
  const labelMap = new Map<string, string>()
  for (const m of mentions) labelMap.set(refKey(m.type, m.id), m.label)

  const matches: MentionMatch[] = []
  const { doc } = editor.state

  // 모든 텍스트 노드를 순회하며 토큰을 수집(절대 위치 계산).
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return
    const text = node.text
    const segments = parseWikiSegments(text)
    // 멘션이 하나도 없으면 스킵.
    if (!segments.some((s) => s.type === 'mention')) return
    // 세그먼트를 다시 순회하며 각 멘션 토큰의 노드-내 오프셋을 누적 길이로 추적.
    let offset = 0
    for (const seg of segments) {
      if (seg.type === 'text') {
        offset += seg.value.length
        continue
      }
      const token = tokenFor(seg.mtype, seg.id)
      const from = pos + offset
      const to = from + token.length
      const label = labelMap.get(refKey(seg.mtype, seg.id)) ?? token
      matches.push({ from, to, attrs: { mtype: seg.mtype, id: seg.id, label } })
      offset += token.length
    }
  })

  if (matches.length === 0) return false

  // 뒤→앞으로 치환해야 앞쪽 치환이 뒤쪽 위치를 어긋나게 하지 않는다.
  matches.sort((a, b) => b.from - a.from)

  const { schema } = editor.state
  const mentionType = schema.nodes.wikiMention
  if (!mentionType) return false

  let tr = editor.state.tr
  for (const mt of matches) {
    tr = tr.replaceWith(mt.from, mt.to, mentionType.create(mt.attrs))
  }
  // addToHistory=false — 라운드트립 치환은 사용자 편집이 아니므로 undo 스택/히스토리에 넣지 않는다.
  tr.setMeta('addToHistory', false)
  // 자동저장 가드용 메타 — WikiEditor 의 update 핸들러가 이 메타를 보고 저장을 건너뛴다.
  tr.setMeta('wikiMentionHydrate', true)
  editor.view.dispatch(tr)
  return true
}
