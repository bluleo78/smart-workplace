// 표 셀 안 파이프(|) 이스케이프 공용 규칙 — 텍스트(#755)·링크·이미지 직렬화기가 함께 쓴다.
import type { MarkdownSerializerState } from '@tiptap/pm/markdown'

/** tiptap-markdown 이 state 에 얹는 표 구간 플래그(표 직렬화기가 셀 렌더 구간에만 true 로 둔다). */
export type TableAwareState = MarkdownSerializerState & { inTable?: boolean; inAutolink?: boolean }

/**
 * 표 셀 안이면 | 를 \| 로 바꾼다 — GFM 은 inline 파싱 전에 행을 | 로 자르므로, 링크 주소·title·이미지 alt 처럼
 * Text 직렬화기를 거치지 않는 조각도 이스케이프하지 않으면 셀이 쪼개진다. 표 밖에선 그대로(저장본 가독성).
 */
export function escapeTablePipes(state: TableAwareState, value: string): string {
  return state.inTable ? value.replace(/\|/g, '\\|') : value
}
