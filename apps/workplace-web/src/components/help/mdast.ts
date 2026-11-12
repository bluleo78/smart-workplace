// mdast 공용 도구(WP-1511) — 도움말 요약(manualSummary)·자리표시 플러그인(helpMarkup)·AI 답 표식 해석(helpAnswer)이 함께 쓴다.
// 같은 파서 구성·트리 순회·평문 추출을 파일마다 따로 두면 규칙이 어긋나므로 한 곳에 모았다.
import type { Nodes } from 'mdast'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'

/** 도움말 패널(HelpMarkdown)과 같은 문법(CommonMark + GFM 표)의 파서 — 파싱만 하므로 한 번 만들어 둔다. */
export const markdownParser = unified().use(remarkParse).use(remarkGfm)

/**
 * 문서 순서(앞에서 뒤, 부모 먼저)로 노드를 방문한다 — unist-util-visit 는 web 의 직접 의존성이 아니라 작은 재귀로 돈다.
 * visit 가 true 를 돌려주면 거기서 중단하고 true 를 돌려준다.
 */
export function walkMdast(node: Nodes, visit: (n: Nodes) => boolean | void): boolean {
  if (visit(node) === true) return true
  if ('children' in node) {
    for (const child of node.children as Nodes[]) {
      if (walkMdast(child, visit)) return true
    }
  }
  return false
}

// 자식이 블록인 노드 — 자식 글 사이에 공백을 둔다.
const BLOCK_PARENTS = new Set(['root', 'blockquote', 'list', 'listItem', 'table', 'tableRow'])

/**
 * 노드의 평문 — 글·인라인 코드는 글자 그대로(코드 안 `*` 도 표기가 아니다), 굵게·기울임·링크는 안의 글만, 그림·HTML 은 뺀다.
 * 코드 블록도 뺀다(알림 상자 안 명령 등). 줄바꿈·연속 공백은 호출하는 쪽이 한 칸으로 줄인다.
 */
export function mdastText(node: Nodes): string {
  switch (node.type) {
    case 'text':
    case 'inlineCode':
      return node.value
    case 'break':
      return ' '
    case 'image':
    case 'imageReference':
    case 'html':
    case 'code':
    case 'footnoteReference':
      return ''
    default:
      // 블록 자식(인용 안 문단 여럿·목록 항목)은 공백으로, 글 안 조각(굵게·링크 안 글)은 그대로 잇는다 — 문단 경계에서 앞뒤 글이 붙지 않게.
      return 'children' in node ? node.children.map((c) => mdastText(c as Nodes)).join(BLOCK_PARENTS.has(node.type) ? ' ' : '') : ''
  }
}
