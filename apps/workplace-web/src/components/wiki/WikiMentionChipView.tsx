import type { WikiMentionAttrs } from '@smart-workplace/wiki-editor-schema'
import { type NodeViewProps,NodeViewWrapper } from '@tiptap/react'

import { useMentionLabel } from './wikiMentionLabels'

// 칩 스타일 — 디자인 시스템 시맨틱 토큰만(hex/임의색 금지). accent 토큰으로 라이트/다크 테마에 자동 대응.
// cursor-pointer 는 내비 가능한 칩(PAGE/ISSUE)에만 — USER 칩은 클릭 무동작이라 거짓 affordance 를 피한다.
const BASE_CHIP_CLASS = 'rounded bg-accent px-1 font-medium text-accent-foreground'
const NAV_CHIP_CLASS = `${BASE_CHIP_CLASS} cursor-pointer`

/**
 * 노트 멘션 칩 NodeView — 문서엔 mtype·id 만 있으므로 라벨은 WikiMentionLabelsProvider 에서 조회한다.
 * data-mtype·data-id 는 WikiEditor 의 칩 클릭 내비(closest('[data-mtype]'))와 E2E 가 읽으므로 유지한다.
 */
export function WikiMentionChipView({ node }: NodeViewProps) {
  const { mtype, id } = node.attrs as WikiMentionAttrs
  const label = useMentionLabel(mtype, id)
  const isUser = mtype === 'USER'
  return (
    // as="span" 은 DOM 에 그대로 새어 나가지만(tiptap 이 props 를 통째로 펼친다) 지울 수 없다 — 기본값이 'div' 라
    // 빼면 인라인 칩이 <p> 안의 <div> 가 된다.
    <NodeViewWrapper
      as="span"
      data-mtype={mtype}
      data-id={String(id)}
      className={isUser ? BASE_CHIP_CLASS : NAV_CHIP_CLASS}
    >
      {/* USER 는 채팅 칩과 동일하게 "@" 프리픽스 — PAGE/ISSUE 는 참조 링크라 제외(#703). */}
      {isUser ? `@${label}` : label}
    </NodeViewWrapper>
  )
}
