// 노트 HTML 블록(WP-1242) — 스크립트가 필요한 HTML(차트·React 로 그린 아티팩트)을 노트 안 한 블록으로 두는 노드.
//
// 저장 형식(Markdown 펜스 코드 블록, 정보 문자열 html-embed):
//   ```html-embed
//   <canvas id="c"></canvas>
//   <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
//   ```
// 안 글자는 코드 블록처럼 Yjs 텍스트라 동시 편집이 글자 단위로 병합된다. 화면(웹)은 이 글자를 격리 iframe(sandbox, allow-same-origin 없음)
// 으로 그린다 — 스키마는 그리는 방법을 모르고, 서버·클립보드용 렌더는 일반 코드 블록처럼 <pre><code> 로 낸다(실행되지 않는다).
import { Node } from '@tiptap/core'
import type { MarkdownSerializerState } from '@tiptap/pm/markdown'
import type { Node as PMNode } from '@tiptap/pm/model'

/** 노드 이름 — 웹 NodeView·판 비교·붙여넣기가 같은 이름을 쓰게 한곳에 둔다. */
export const WIKI_HTML_EMBED = 'wikiHtmlEmbed'

/** Markdown 펜스 정보 문자열 — 이 말이 붙은 펜스만 HTML 블록이다(```html 은 지금처럼 일반 코드 블록). */
export const HTML_EMBED_INFO = 'html-embed'

/** markdown-it 이 펜스 정보 문자열로 붙이는 class — tiptap-markdown 의 codeBlock 이 langPrefix 를 'language-' 로 둔다. */
const EMBED_CODE_CLASS = `language-${HTML_EMBED_INFO}`

/**
 * 소스를 감쌀 펜스 — 소스 안에서 가장 긴 백틱 연속보다 하나 길게(최소 3개).
 * 왜: 소스에 ``` 가 들어 있으면(마크다운을 그리는 스크립트·템플릿 문자열) 같은 길이 펜스는 그 줄에서 블록이 닫혀 뒤가 본문으로 샌다.
 * tiptap-markdown 의 codeBlock 직렬화기는 늘 ``` 라 이 처리를 하지 않는다(prosemirror-markdown 의 code_block 과 같은 방식으로 직접 한다).
 */
export function htmlEmbedFence(source: string): string {
  let longest = 0
  for (const run of source.match(/`+/g) ?? []) longest = Math.max(longest, run.length)
  return '`'.repeat(Math.max(3, longest + 1))
}

/**
 * HTML 블록 노드 `wikiHtmlEmbed` — 내용은 글자뿐(text*), 마크 없음, code(입력 규칙·서식 단축키가 안에서 돌지 않는다), defining.
 * - attrs 없음: 그리는 높이 등은 화면이 iframe 보고에서 정한다(문서에 남기면 접속자마다 다른 값이 병합 충돌한다).
 * - parseHTML: markdown-it 이 낸 `<pre><code class="language-html-embed">` 만 잡는다. 기본 우선순위(50)인 codeBlock 보다 먼저 보도록
 *   priority 를 올린다. 공백·빈 줄을 그대로 두려고 preserveWhitespace 'full'.
 * - 직렬화: 펜스 + 정보 문자열 + 소스 + 줄바꿈 + 펜스. 소스 뒤에 늘 줄바꿈 하나를 더 써서(prosemirror-markdown code_block 과 같다)
 *   tiptap-markdown 이 파싱 때 떼는 마지막 \n 과 짝을 맞춘다 — 소스 끝 빈 줄까지 왕복에서 그대로다.
 */
export const WikiHtmlEmbedSchema = Node.create({
  name: WIKI_HTML_EMBED,
  group: 'block',
  content: 'text*',
  marks: '',
  code: true,
  defining: true,

  parseHTML() {
    return [
      {
        tag: 'pre',
        priority: 60,
        preserveWhitespace: 'full',
        // 안쪽 <code> 에 정보 문자열 class 가 있을 때만 — 없으면 false 로 넘겨 codeBlock 규칙이 받는다.
        getAttrs: (el: HTMLElement) =>
          Array.from(el.children).some((c) => c.tagName === 'CODE' && c.classList.contains(EMBED_CODE_CLASS)) ? null : false,
        contentElement: 'code',
      },
    ]
  },

  renderHTML() {
    // 스키마 전용 렌더(서버·클립보드·NodeView 없는 화면) — 실행되지 않는 코드 블록 모양. 다시 읽으면 parseHTML 이 이 노드로 받는다.
    return ['pre', { 'data-wiki-html-embed': '' }, ['code', { class: EMBED_CODE_CLASS }, 0]]
  },

  addStorage() {
    return {
      markdown: {
        // state.text(…, false) — 이스케이프하지 않고 줄마다 목록·인용 들여쓰기(delim)를 붙인다(코드 블록 직렬화와 같은 방식).
        serialize(state: MarkdownSerializerState, node: PMNode) {
          const source = node.textContent
          const fence = htmlEmbedFence(source)
          state.write(`${fence}${HTML_EMBED_INFO}\n`)
          state.text(source, false)
          state.write('\n')
          state.write(fence)
          state.closeBlock(node)
        },
        parse: {
          // markdown-it 펜스 → <pre><code class="language-html-embed"> → parseHTML. 마지막 \n 은 codeBlock 의 updateDOM 이 뗀다.
        },
      },
    }
  },
})
