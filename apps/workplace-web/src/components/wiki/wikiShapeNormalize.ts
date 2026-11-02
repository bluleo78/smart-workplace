import { isFormatSpanMark, isWikiShapeNode, WIKI_HTML_BOX, WIKI_HTML_SPAN, WIKI_STYLE } from '@smart-workplace/wiki-editor-schema'
import { type Attrs, Fragment, type Mark, type Node as PMNode, Slice } from '@tiptap/pm/model'

/**
 * 조각(Fragment·Slice)의 HTML 모양 정리기 하나(WP-1306) — 붙여넣기 「글만」(stripShapeFromSlice)·상자 「글만 남기기」(stripShapeFromFragment)·
 * 노트 밖 붙여넣기 「모양 유지」(wikiPasteForeign 의 foreignShapeSlice)가 같은 나무 걷기를 쓰고, 달라지는 것(상자 남기기/풀기·글 마크·정렬)만
 * 정책(ShapePolicy)으로 넘긴다. 걷기·열린 깊이 계산이 두 벌로 나뉘어 어긋나지 않게 한곳에 둔다.
 *
 * wikiPasteShape(붙여넣기 확장)·wikiPasteChip(칩)·wikiPasteForeign 이 모두 쓰므로 따로 모듈로 둔다 — 그 셋 사이의 순환 import 를 피한다.
 */

/** 상자 하나의 처리 — 남기면 새 속성으로, 풀면 안쪽 블록만. 안쪽을 걸을 때 쓸 맥락도 함께 정한다. */
export type BoxDecision<C> = { keep: true; attrs: Attrs; inner: C } | { keep: false; inner: C }

/** 정리 정책 — 맥락 C 는 바깥에서 안으로 물려주는 값(노트 밖 정리기의 배경·글자색 등). 필요 없으면 무엇이든 된다. */
export interface ShapePolicy<C> {
  /** 상자(wikiHtmlBox)를 남길지·풀지와 안쪽 맥락. */
  box(node: PMNode, ctx: C): BoxDecision<C>
  /** 상자가 아닌 노드(글자·인라인 노드·블록)에 남길 마크. */
  marks(node: PMNode, ctx: C): readonly Mark[]
  /** 문단·제목 정렬(textAlign)을 지울지 — 「글만」은 지우고, 「모양 유지」는 둔다. */
  clearAlign: boolean
}

/** 걷는 동안 푼 상자를 적어 둔다 — 열린 깊이 계산이 상자 판정을 다시 하지 않고 이 기록을 읽는다(노드마다 판정 한 번). */
type Unwrapped = Set<PMNode>

function walk<C>(fragment: Fragment, policy: ShapePolicy<C>, ctx: C, unwrapped: Unwrapped): Fragment {
  const out: PMNode[] = []
  fragment.forEach((node) => {
    const name = node.type.name
    // 페이지 스타일은 어느 정책이든 버린다(노트 밖 <style> 은 파싱 때 이미 빠지고, 글자로 친 것만 여기 온다).
    if (name === WIKI_STYLE) return
    if (node.isText) {
      out.push(node.mark(policy.marks(node, ctx)))
      return
    }
    if (name === WIKI_HTML_BOX) {
      const box = policy.box(node, ctx)
      const inner = node.content.size ? walk(node.content, policy, box.inner, unwrapped) : node.content
      if (box.keep) {
        out.push(node.type.create(box.attrs, inner, node.marks))
      } else {
        unwrapped.add(node)
        inner.forEach((child) => out.push(child))
      }
      return
    }
    const content = node.content.size ? walk(node.content, policy, ctx, unwrapped) : node.content
    const attrs = policy.clearAlign && node.attrs.textAlign ? { ...node.attrs, textAlign: null } : node.attrs
    // 안쪽이 페이지 스타일뿐이던 블록(표 셀 등)은 비면 스키마가 요구하는 빈 내용(빈 문단)으로 채운다.
    const copy =
      attrs === node.attrs && (content.size || !node.content.size)
        ? node.copy(content)
        : (node.type.createAndFill(attrs, content) ?? node.type.create(attrs, content))
    out.push(copy.mark(policy.marks(node, ctx)))
  })
  // fromArray 가 같은 마크의 이웃 글자를 하나로 잇는다(span 만 다르던 글자들).
  return Fragment.fromArray(out)
}

/** 조각 내용을 정책대로 정리한다. */
export function normalizeShapeFragment<C>(fragment: Fragment, policy: ShapePolicy<C>, ctx: C): Fragment {
  return walk(fragment, policy, ctx, new Set())
}

/** 열린 쪽 경로(첫/끝 자식 사슬)에서 풀린 상자 수 — 그만큼 열린 깊이가 줄어든다. */
function unwrappedOnOpenPath(fragment: Fragment, depth: number, side: 'start' | 'end', unwrapped: Unwrapped): number {
  let count = 0
  let node = side === 'start' ? fragment.firstChild : fragment.lastChild
  for (let d = 0; d < depth && node; d++) {
    if (unwrapped.has(node)) count++
    node = side === 'start' ? node.firstChild : node.lastChild
  }
  return count
}

/**
 * 조각을 정책대로 정리한다 — 열린 깊이(openStart/openEnd)는 열린 경로 위에서 풀린 상자 수만큼 줄인다(붙여넣기가 이어 붙일 자리 계산이
 * 그대로 맞게). 내용이 다 사라지면 빈 조각.
 */
export function normalizeShapeSlice<C>(slice: Slice, policy: ShapePolicy<C>, ctx: C): Slice {
  const unwrapped: Unwrapped = new Set()
  const content = walk(slice.content, policy, ctx, unwrapped)
  if (!content.size) return Slice.empty
  return new Slice(
    content,
    Math.max(0, slice.openStart - unwrappedOnOpenPath(slice.content, slice.openStart, 'start', unwrapped)),
    Math.max(0, slice.openEnd - unwrappedOnOpenPath(slice.content, slice.openEnd, 'end', unwrapped)),
  )
}

/** 조각 안에 조건에 맞는 노드가 하나라도 있는지(찾으면 바로 멈춘다). */
function someNode(fragment: Fragment, test: (node: PMNode) => boolean): boolean {
  let found = false
  fragment.descendants((node) => {
    if (!found) found = test(node)
    return !found
  })
  return found
}

/** 모양(페이지 스타일·상자·인라인 모양)이 있는지 — 없으면 정리할 것이 없어 같은 조각을 돌려준다. */
export const hasShape = (fragment: Fragment) => someNode(fragment, isWikiShapeNode)

/**
 * 「글만」이 뗄 것이 있는지 — 모양이나 문단·제목 정렬. 붙여넣기 칩이 「글만」 결과가 지금과 다를지 판정하는 데도 쓴다
 * (「글만」은 정확히 이것들만 떼므로, 하나도 없으면 결과가 같다).
 */
export const hasStrippableShape = (fragment: Fragment) => someNode(fragment, (node) => isWikiShapeNode(node) || !!node.attrs.textAlign)

/** 「글만」 정책 — 상자는 모두 풀고, 인라인 모양 마크는 떼고(keepFormat 이면 서식 span 은 남긴다), 정렬은 keepFormat 이 아니면 지운다. */
function stripPolicy(keepFormat: boolean): ShapePolicy<null> {
  return {
    box: () => ({ keep: false, inner: null }),
    marks: (node) => node.marks.filter((m) => m.type.name !== WIKI_HTML_SPAN || (keepFormat && isFormatSpanMark(m))),
    clearAlign: !keepFormat,
  }
}

/**
 * 모양 노드·마크를 뺀 조각 내용 — 페이지 스타일은 지우고, 모양 영역은 풀고, 인라인 모양 마크는 떼고, 문단·제목 정렬(WP-1305)도 지운다.
 * 상자 막대의 「글만 남기기」(WP-1303)도 이 풀기를 그대로 쓴다(상자 하나를 담은 조각을 넘긴다).
 * keepFormat — 사용자가 선택 서식 도구로 단 글 서식(밑줄·글자색·배경색의 서식 span 과 문단 정렬, WP-1305)은 남긴다(상자 「글만 남기기」).
 */
export function stripShapeFromFragment(fragment: Fragment, opts: { keepFormat?: boolean } = {}): Fragment {
  return normalizeShapeFragment(fragment, stripPolicy(!!opts.keepFormat), null)
}

/**
 * 조각에서 HTML 모양(페이지 스타일·모양 영역·인라인 모양)과 문단·제목 정렬을 뺀다(순수 함수). 뗄 것이 없으면 같은 조각을 그대로 돌려준다.
 * 열린 깊이는 열린 경로 위에서 풀린 영역 수만큼 줄인다.
 */
export function stripShapeFromSlice(slice: Slice): Slice {
  // 정렬만 지닌 조각(바깥 문서의 가운데 문단)도 거른다.
  if (!hasStrippableShape(slice.content)) return slice
  return normalizeShapeSlice(slice, stripPolicy(false), null)
}
