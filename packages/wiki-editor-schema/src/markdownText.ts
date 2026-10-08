// 표 셀 안에서만 파이프(|)를 이스케이프하는 Text 노드 (#755).
//
// 왜 Text 노드인가: 이스케이프는 prosemirror-markdown 의 esc 가 끝난 "뒤"에 붙어야 한다.
// esc 는 백슬래시(\)를 이스케이프 대상에 포함하므로, 먼저 \| 를 만들어두면 esc 가 그 백슬래시를
// 다시 이스케이프해 \\| 가 되고 셀은 그대로 쪼개진다 — 원래 버그보다 나쁘다.
// tiptap-markdown 의 표 직렬화기는 셀 내용을 state.renderInline 으로 넘기고, 최종적으로 텍스트를
// 문자열로 바꾸는 지점은 이 Text 직렬화기 하나뿐이라 여기가 유일한 정확한 훅이다.
//
// 왜 표 안에서만인가: escapeExtraCharacters 로 전역 이스케이프를 걸면 일반 문단의 "a | b" 까지
// "a \| b" 로 저장된다. 저장본(마크다운)은 AI·MCP 노트 도구가 직접 읽고 쓰는 1급 산출물이라
// 불필요한 백슬래시를 남기지 않는다. state.inTable 은 tiptap-markdown 표 직렬화기가 켜고 끄는
// 플래그로, 정확히 셀 내용을 렌더하는 구간에만 true 다.
import { Text } from '@tiptap/extension-text'
import type { Node as PMNode } from '@tiptap/pm/model'

import { escapeTablePipes, type TableAwareState as BaseTableState } from './tablePipe'

/** tiptap-markdown 기본 Text 직렬화기와 동일한 처리 — 이 확장이 기본 동작을 통째로 대체하므로 유지해야 한다. */
function escapeHTML(value: string): string {
  return value.replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * 타입에 노출되지 않은 두 멤버:
 * - esc: MarkdownSerializerState 의 @internal 멤버. 런타임에는 존재하며(prosemirror-markdown 1.13)
 *   state.text(str, true) 가 내부적으로 부르는 것과 같은 함수다. 이스케이프 순서를 직접 통제해야
 *   해서 명시적으로 호출한다.
 * - inTable: tiptap-markdown 이 state 에 얹는 플래그(표 직렬화기가 셀 렌더 구간에만 true 로 둔다).
 * - inAutolink: 링크 직렬화기가 <url> 꺾쇠 자동 링크를 쓰는 동안 켜는 플래그(prosemirror-markdown).
 */
type TableAwareState = BaseTableState & {
  esc(str: string, startOfLine?: boolean): string
}

export const WikiMarkdownText = Text.extend({
  addStorage() {
    return {
      markdown: {
        serialize(state: TableAwareState, node: PMNode) {
          const text = escapeHTML(node.text ?? '')
          // 꺾쇠 자동 링크(<url>) 안에선 마크다운 이스케이프를 하지 않는다 — 꺾쇠 안의 백슬래시는 주소 글자가 되어
          // 저장할 때마다 주소가 바뀐다(prosemirror-markdown 기본 text 직렬화기의 !state.inAutolink 와 같은 처리).
          if (state.inAutolink) {
            state.text(escapeTablePipes(state, text), false)
            return
          }
          if (!state.inTable) {
            state.text(text)
            return
          }
          // 셀 안에서는 esc → 파이프 이스케이프 순서로 직접 처리하고 재이스케이프를 끈다.
          // 셀 내용 앞에는 항상 "| " 가 먼저 쓰이므로 startOfLine 은 false 가 맞다.
          state.text(escapeTablePipes(state, state.esc(text, false)), false)
        },
        parse: {
          // markdown-it 이 처리한다.
        },
      },
    }
  },
})
