import { WIKI_HTML_EMBED } from '@smart-workplace/wiki-editor-schema'
import { Extension } from '@tiptap/core'
import { DOMSerializer, Fragment, type Node as PMNode, type Schema, Slice } from '@tiptap/pm/model'
import { Plugin } from '@tiptap/pm/state'

import { stopUndoCaptureIn } from './wikiCollabPosition'
import { type PasteChipMemory, pasteChipPlugin } from './wikiPasteChipPlugin'
import { foreignShapeSlice, prepareForeignHtml } from './wikiPasteForeign'
import { hasStrippableShape, stripShapeFromSlice } from './wikiShapeNormalize'

/**
 * 붙여넣기의 HTML 모양 거르기(WP-1240·WP-1306) — 노트끼리 복사는 모양째 옮기고, 노트 밖 HTML 은 「모양 유지」 정리기로 걸러 들이며,
 * 글자 붙여넣기는 모양 없이 들인다.
 *
 * 왜: Google Docs·Word·웹 페이지 HTML 은 `span style="font-family:Arial;font-size:11pt"` 같은 서식으로 가득해, 그대로 두면
 * 붙여넣을 때마다 인라인 모양 마크(wikiHtmlSpan)·모양 영역(wikiHtmlBox)이 생기고 노트에 범위 가두기(contain)까지 켜진다.
 * 그래서 노트 밖 HTML 은 상자(배경·테두리·그림자 있는 컨테이너)와 서식 span(밑줄·글자색·배경색)만 남기도록 거른다(wikiPasteForeign).
 * 글자 붙여넣기도 걸러야 한다 — tiptap-markdown(transformPastedText)이 text/plain 을 html:true 마크다운으로 읽으므로
 * `<style data-wp-style>`·`<div class>` 를 친 글자가 그대로 페이지 스타일·모양 영역이 된다.
 *
 * 어떻게: HTML 문자열이 아니라 파싱이 끝난 조각(Slice)에서 거른다(transformPasted) — HTML·글자·끌어다 놓기 붙여넣기가 모두 지나는
 * 한 곳이라 경로마다 따로 막을 필요가 없다. 「글만」(stripShapeFromSlice)은 페이지 스타일(wikiStyle)을 지우고, 모양 영역(wikiHtmlBox)은 풀어
 * 안쪽 블록만 남기고, 인라인 모양(wikiHtmlSpan)은 마크만 뗀다. 굵게·기울임(style 의 font-weight 등으로 읽힌 마크)·표 셀 정렬 같은
 * 다른 노드·마크는 그대로다. 붙인 뒤 칩(wikiPasteChipPlugin)으로 모양 유지 ↔ 글만을 바꾼다.
 *
 * 노트끼리 복사 판정: 노트 편집기가 복사·끌기 때 클립보드 HTML 에 표지(NOTE_COPY_ATTR)를 단다(clipboardSerializer).
 * ProseMirror 의 data-pm-slice 는 ProseMirror 기반 앱이면 어디서나 붙으므로 판정에 쓰지 않는다. 같은 편집기 안 끌어다 놓기는
 * 클립보드를 거치지 않으므로(view.dragging 의 조각을 그대로 쓴다) 노트 안 이동으로 본다.
 * HTML 문서 전체를 모양째 들여오는 명시 경로(파일·문서 소스 붙여넣기)는 WP-1241(wikiHtmlImportInsert)이 따로 둔다.
 */

/** 노트 편집기에서 복사한 클립보드 HTML 표지 — 첫 최상위 요소에 단다. 붙여넣을 때 이 표지가 있어야 모양을 옮긴다. */
export const NOTE_COPY_ATTR = 'data-wp-note-copy'

/** 클립보드 HTML 이 노트 편집기에서 복사한 것인지 — 요소에 붙은 표지만 본다(글자로 적힌 'data-wp-note-copy' 는 아니다). */
export function isNoteCopyHtml(html: string): boolean {
  if (!html.includes(NOTE_COPY_ATTR)) return false
  const body = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html').body
  return !!body.querySelector(`[${NOTE_COPY_ATTR}]`)
}

/**
 * 복사용 직렬화기 — 스키마 기본 직렬화 결과의 첫 최상위 요소에 노트 복사 표지를 단다. 최상위가 글자뿐이면(드묾) 표지를 달 곳이 없어
 * 바깥 붙여넣기로 다뤄진다(모양만 빠진다 — 안전한 쪽).
 */
export function noteClipboardSerializer(schema: Schema): DOMSerializer {
  const base = DOMSerializer.fromSchema(schema)
  return new (class extends DOMSerializer {
    serializeFragment(...args: Parameters<DOMSerializer['serializeFragment']>) {
      const frag = super.serializeFragment(...args)
      for (let child = frag.firstChild; child; child = child.nextSibling) {
        if (child.nodeType === 1) {
          ;(child as HTMLElement).setAttribute(NOTE_COPY_ATTR, '')
          break
        }
      }
      return frag
    }
  })(base.nodes, base.marks)
}

// 「글만」 정리기는 붙여넣기 칩(wikiPasteChipPlugin)·노트 밖 정리기(wikiPasteForeign)와 걷기를 함께 쓰려고 wikiShapeNormalize 로 옮겼다 —
// 상자 「글만 남기기」(wikiBox)·테스트가 이 모듈에서 읽던 이름을 그대로 쓰게 다시 내보낸다.
export { stripShapeFromFragment, stripShapeFromSlice } from './wikiShapeNormalize'

/** 노트 밖 붙여넣기에서 HTML 블록이 바뀌는 일반 코드 블록의 언어 — 소스 글자는 그대로 보인다. */
const PASTED_EMBED_LANGUAGE = 'html'

/** 조각 안 HTML 블록(wikiHtmlEmbed)을 같은 글자의 ```html 코드 블록으로 — 바뀐 것이 없으면 같은 조각. */
function embedsToCodeFragment(fragment: Fragment, schema: Schema): Fragment {
  let changed = false
  const out: PMNode[] = []
  fragment.forEach((node) => {
    if (node.type.name === WIKI_HTML_EMBED) {
      changed = true
      out.push(schema.nodes.codeBlock.create({ language: PASTED_EMBED_LANGUAGE }, node.content))
      return
    }
    if (node.isLeaf || !node.content.size) {
      out.push(node)
      return
    }
    const content = embedsToCodeFragment(node.content, schema)
    if (content !== node.content) changed = true
    out.push(content === node.content ? node : node.copy(content))
  })
  return changed ? Fragment.fromArray(out) : fragment
}

/**
 * 노트 밖에서 온 붙여넣기의 HTML 블록을 실행되지 않는 ```html 코드 블록으로 바꾼다(WP-1242, 순수 함수).
 * 왜: 웹 페이지·다른 앱에서 복사한 글이나 ```html-embed 를 친 글자가 붙여넣기만으로 스크립트가 도는 블록이 되지 않게 — 실행 블록은
 * 슬래시 메뉴로 일부러 넣거나 노트끼리 복사(노트 복사 표지)할 때만 생긴다. 지우지 않고 글자를 남겨 사용자가 소스를 잃지 않는다.
 * 모양 노드 판정(isWikiShapeNode)과는 따로 둔다 — 그 판정은 화면 범위 가두기(wikiHtmlScope)도 쓰는데, HTML 블록은 iframe 이라 범위와 무관하다.
 * 열린 깊이는 그대로다 — 블록과 코드 블록은 같은 깊이의 글자 블록이다.
 */
export function embedsToCodeBlocks(slice: Slice, schema: Schema): Slice {
  if (!schema.nodes[WIKI_HTML_EMBED] || !schema.nodes.codeBlock) return slice
  const content = embedsToCodeFragment(slice.content, schema)
  return content === slice.content ? slice : new Slice(content, slice.openStart, slice.openEnd)
}

/**
 * 붙여넣기 모양 거르기 확장 — 노트 본문 편집기(wikiEditorExtensions)와 판 미리보기(복사 원본)에 넣는다.
 * - clipboardSerializer: 복사·끌기 HTML 에 노트 복사 표지를 단다.
 * - transformPastedHTML: 이번 붙여넣기 HTML 이 노트 복사인지 기억하고, 노트 밖 HTML 이면 모양 유지 정리기가 읽을 수 있게 손질한다
 *   (`<u>`·`<font color>`·문단 글자색 → span, prepareForeignHtml).
 * - transformPasted:
 *   - 노트끼리 복사·같은 편집기 안 끌기 → 그대로(모양째).
 *   - 글자 붙여넣기(plain) → 모양·정렬을 빼고(stripShapeFromSlice) HTML 블록을 ```html 코드 블록으로(WP-1242). 칩 없음.
 *   - 노트 밖 HTML(웹 페이지·Google Docs·Word 복사, 끌어다 놓기) → 「모양 유지」가 기본(WP-1306): 카드·색 배경은 상자, 색 글자·밑줄은 서식 span,
 *     정렬은 그대로 두고 글꼴·크기·여백 등은 거른다(foreignShapeSlice). 「글만」 결과(지금의 거르기)와 다르면 붙인 자리에 칩을 띄운다(wikiPasteChipPlugin).
 *   HTML 문서 소스 붙여넣기(WP-1241)는 handlePaste 가 가져가 이 결과를 쓰지 않는다 — 칩도 뜨지 않는다(칩 판정은 붙여넣기 거래에만 쓰인다).
 * - 붙여넣기 직전에 실행 취소 묶음을 끊는다 — 바로 앞 글자 입력과 묶이지 않아 ⌘Z 한 번에 붙여넣기만 사라진다.
 */
export const WikiPasteShape = Extension.create<{ chip: boolean }>({
  name: 'wikiPasteShape',
  addOptions() {
    // chip — 붙여넣기 칩을 둘지. 보기 전용 판 미리보기는 복사 표지만 필요하고 붙여넣을 일이 없어 끈다.
    return { chip: true }
  },
  addProseMirrorPlugins() {
    // transformPastedHTML → (파싱) → transformPasted 가 한 붙여넣기 안에서 이어 불린다 — 그 사이에만 쓰는 표시.
    let htmlFromNote = false
    const memory: PasteChipMemory = { offer: false, anchor: null, shapeAnchor: null, restoring: false, capture: false }
    return [
      new Plugin({
        props: {
          clipboardSerializer: noteClipboardSerializer(this.editor.schema),
          transformPastedHTML(html) {
            htmlFromNote = isNoteCopyHtml(html)
            return htmlFromNote ? html : prepareForeignHtml(html)
          },
          transformPasted(slice, view, plain) {
            const internal = !plain && (htmlFromNote || !!view.dragging)
            htmlFromNote = false
            memory.offer = false
            if (internal) return slice
            const schema = view.state.schema
            stopUndoCaptureIn(view.state)
            // 글자 붙여넣기 — 모양·문단 정렬을 떼고, HTML 블록은 실행되지 않는 코드 블록으로(WP-1242). 칩 없음.
            if (plain) return embedsToCodeBlocks(stripShapeFromSlice(slice), schema)
            const kept = embedsToCodeBlocks(foreignShapeSlice(slice), schema)
            // 「글만」은 상자·인라인 모양·정렬만 떼므로, 결과에 그것이 하나라도 남았을 때만 「글만」이 다른 결과다 — 두 번 만들어 견주지 않는다.
            memory.offer = hasStrippableShape(kept.content)
            return kept
          },
        },
      }),
      ...(this.options.chip ? [pasteChipPlugin(memory)] : []),
    ]
  },
})
