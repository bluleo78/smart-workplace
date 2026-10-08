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
import type { Editor } from '@tiptap/core'
import type { Node as PMNode, Schema } from '@tiptap/pm/model'

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

// 스키마별 "인라인 요소" 셀렉터 캐시 — 변환기는 재사용되므로 parse() 마다 다시 만들지 않는다.
const inlineSelectorCache = new WeakMap<Schema, string>()

/**
 * 마크와 인라인 노드(hardBreak 제외)의 parseDOM 태그로 셀렉터를 만든다.
 * 스키마에서 뽑으므로 굵게·기울임·취소선·코드·링크·이미지·멘션 칩(span[data-mtype])이 자동으로 포함되고,
 * 블록 태그(</p>\n<p>, raw HTML 표의 </tr>\n<tr>)는 빠진다 — 그 사이 개행은 normalizeDOM 이 계속 지워야 한다.
 */
function inlineSelector(schema: Schema): string {
  let selector = inlineSelectorCache.get(schema)
  if (selector === undefined) {
    const specs = [
      ...Object.values(schema.marks).map((m) => m.spec.parseDOM),
      ...Object.values(schema.nodes)
        .filter((n) => n.isInline && !n.isText && !n.spec.linebreakReplacement)
        .map((n) => n.spec.parseDOM),
    ]
    selector = specs
      .flatMap((rules) => rules ?? [])
      .map((rule) => ('tag' in rule ? rule.tag : undefined))
      .filter((tag): tag is string => !!tag)
      .join(',')
    inlineSelectorCache.set(schema, selector)
  }
  return selector
}

/**
 * 인라인 요소 바로 뒤 소프트 줄바꿈을 normalizeDOM 에서 지켜낸다 (WP-314).
 *
 * 왜: markdown-it 은 문단 안 소프트 줄바꿈을 '\n' 으로 렌더하는데, tiptap-markdown normalizeDOM 이
 * <pre> 밖 "요소 바로 뒤" 텍스트 노드의 선행 \n 을 하나 지운다(블록 태그 사이 개행을 지우려는 처리).
 * 그래서 '**a**\nb' 가 <strong>a</strong>b 로 붙어 '**a**b' 로 저장됐다(굵게·기울임·취소선·코드·링크·이미지·멘션 칩 모두).
 *
 * 어떻게: normalizeDOM 직전(updateDOM)에 인라인 요소 뒤 선행 \n 을 하나 더 붙여, 지워진 뒤에도 \n 하나가
 * 남게 한다 — 결과가 "요소가 없던 일반 텍스트"와 똑같아진다.
 * - 로드(setContent): ProseMirror 공백 접기로 ' ' — 'a\nb' → 'a b' 와 같은 처리라 기존 노트 직렬화는 바이트 동일.
 * - 붙여넣기(preserveWhitespace): hardBreak — 일반 텍스트 붙여넣기와 같다.
 *   \n 을 공백으로 바꾸면 여러 줄 붙여넣기가 한 줄로 접히므로 \n 그대로 남겨야 한다.
 * <br> 뒤 개행은 이미 줄바꿈이므로 건드리지 않는다(셀렉터에 hardBreak 제외).
 *
 * 예외 — 요소와 요소 사이에 \n 만 있을 때('**a**\n**b**'): 남은 "\n" 하나뿐인 텍스트 노드는 로드 경로에서
 * tiptap core removeWhitespaces(/^(\n\s\s|\n)$/)가 통째로 지워 두 굵게가 '**ab**' 로 합쳐진다.
 * 그래서 이때는 ' \n' 으로 바꾼다 — normalizeDOM·removeWhitespaces 둘 다 건드리지 않고,
 * 로드에선 ' ' 로 접히며, 붙여넣기에선 hardBreak(앞 줄 끝에 보이지 않는 공백 하나)가 된다.
 * 공백뿐인 텍스트 뒤가 비었거나(닫는 태그) 인라인 요소가 아니면(다음 블록) 줄바꿈이 아니므로 건드리지 않는다 —
 * '<p><strong>a</strong>\n</p>' 를 붙여넣을 때 빈 hardBreak·공백이 생기지 않게 main 과 같은 처리를 유지한다.
 */
function keepSoftbreakAfterInline(schema: Schema, element: HTMLElement): void {
  const selector = inlineSelector(schema)
  if (!selector) return
  element.querySelectorAll(selector).forEach((el) => {
    const next = el.nextSibling
    const text = next?.nodeType === 3 /* TEXT_NODE */ ? (next.textContent ?? '') : ''
    if (!next || !text.startsWith('\n') || el.closest('pre')) return
    if (/^\s*$/.test(text)) {
      // 공백뿐 — 뒤에 인라인 요소가 이어질 때만 줄바꿈이다.
      const after = next.nextSibling
      // Element 전역이 없는 서버 DOM 도 있어 instanceof 대신 nodeType 으로 판정한다.
      if (after?.nodeType !== 1 /* ELEMENT_NODE */ || !(after as Element).matches(selector)) return
      next.textContent = text === '\n' ? ' \n' : `\n${text}`
      return
    }
    next.textContent = `\n${text}`
  })
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
          // 텍스트 자체는 markdown-it 이 처리한다. 인라인 요소 뒤 소프트 줄바꿈만 지켜낸다(WP-314).
          updateDOM(this: { editor: Editor }, element: HTMLElement) {
            keepSoftbreakAfterInline(this.editor.schema, element)
          },
        },
      },
    }
  },
})
