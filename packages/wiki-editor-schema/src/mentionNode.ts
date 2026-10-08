// 위키 에디터용 인라인 atom 멘션 노드 `wikiMention`.
// - 문서: attrs 는 mtype·id 만 — 라벨은 문서에 저장하지 않고 웹 NodeView 가 화면에서 조회해 그린다.
// - 저장: tiptap-markdown 직렬화 시 클린 토큰(<@id>·<#page:id>·<#issue:id>)으로 raw write.
// - 로드: markdown-it 인라인 규칙이 토큰을 <span data-mtype data-id> 로 바꾸고 parseHTML 이 노드로 복원.
// 웹 에디터와 동기화 서버가 같은 스키마·파서를 쓰도록 공용 패키지에 둔다(WP-284·WP-294).

import { mergeAttributes, Node } from '@tiptap/core'
import type MarkdownIt from 'markdown-it'

import { tokenFor, type WikiMentionType } from './mentionTokens'

// tiptap-markdown 직렬화 스펙 타입(state.write 만 사용). 0.8.10 은 storage.markdown.serialize 를
// getMarkdownSpec 으로 읽어 { editor, options } 바인딩 후 호출한다.
interface MarkdownSerializerState {
  write(text: string): void
}

// 노드 attrs — mtype/id 가 토큰 직렬화의 원천이자 전부(라벨 없음).
export interface WikiMentionAttrs {
  mtype: WikiMentionType
  id: number
}

// 저장 토큰: <@id> · <#page:id> · <#issue:id> — 현재 위치에서만 매칭(^).
const TOKEN_RE = /^<(?:@(\d+)|#(page|issue):(\d+))>/

// 규칙을 이미 단 markdown-it 인스턴스. tiptap-markdown 은 parse() 마다 같은 인스턴스에 setup 을
// 다시 호출하는데 ruler.before 는 이름 중복을 막지 않아, 가드가 없으면 규칙이 파싱 횟수만큼 쌓인다
// (동기화 서버는 변환기 하나를 계속 재사용하므로 점점 느려진다).
const installed = new WeakSet<MarkdownIt>()

/**
 * markdown-it 인라인 규칙 — 토큰을 칩 HTML(<span data-mtype data-id>)로 바꿔 parseHTML 이 노드로 복원하게 한다.
 * 인라인 규칙은 code_inline·fence·code_block 내용에는 실행되지 않으므로 코드 안 토큰은 글자 그대로 남는다
 * (기존 클라 하이드레이션은 코드블록 안 토큰에서 RangeError, 인라인 코드는 백틱을 잃었다 — WP-283).
 * html_inline 토큰을 쓰므로 tiptap-markdown 의 html:true(기본값) 전제.
 */
function mentionRule(md: MarkdownIt): void {
  if (installed.has(md)) return
  installed.add(md)
  md.inline.ruler.before('html_inline', 'wiki_mention', (state, silent) => {
    if (state.src.charCodeAt(state.pos) !== 0x3c /* < */) return false
    const m = TOKEN_RE.exec(state.src.slice(state.pos))
    if (!m) return false
    if (!silent) {
      const mtype: WikiMentionType = m[1] !== undefined ? 'USER' : m[2] === 'page' ? 'PAGE' : 'ISSUE'
      const id = m[1] ?? m[3]
      const tok = state.push('html_inline', '', 0)
      tok.content = `<span data-mtype="${mtype}" data-id="${id}"></span>`
    }
    state.pos += m[0].length
    return true
  })
}

/**
 * 노트 멘션 칩 노드 스키마 — attrs 는 mtype·id 만(라벨은 문서에 저장하지 않고 화면에서 조회).
 * 라벨을 문서에 두면 페이지 제목이 바뀔 때마다 문서를 고쳐야 하고, AI 적용(updateYFragment) 때
 * 마크다운에 없는 속성이라 칩이 매번 다시 쓰이며 라벨이 지워졌다(WP-283).
 */
export const WikiMention = Node.create({
  name: 'wikiMention',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      // data-mtype="USER|PAGE|ISSUE"
      mtype: {
        default: 'USER',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-mtype'),
        renderHTML: (attrs: { mtype: string }) => ({ 'data-mtype': attrs.mtype }),
      },
      // data-id="<number>"
      id: {
        default: 0,
        parseHTML: (el: HTMLElement) => Number(el.getAttribute('data-id')),
        renderHTML: (attrs: { id: number }) => ({ 'data-id': String(attrs.id) }),
      },
    }
  },

  // 파서 규칙이 만든 <span data-mtype> (및 클립보드 HTML) 를 노드로 복원.
  parseHTML() {
    return [{ tag: 'span[data-mtype]' }]
  },

  // 스키마 전용 렌더(서버·클립보드) — 라벨이 없으므로 토큰을 글자로 둔다. 웹은 NodeView 로 라벨을 그린다.
  renderHTML({ node, HTMLAttributes }) {
    const attrs = node.attrs as WikiMentionAttrs
    return ['span', mergeAttributes(HTMLAttributes), tokenFor(attrs.mtype, attrs.id)]
  },

  // tiptap-markdown 직렬화·파싱 — 저장 본문을 클린 토큰으로 유지하는 핵심.
  // state.write 는 이스케이프 없이 raw write 하므로 토큰의 <,#,@ 가 그대로 보존된다.
  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownSerializerState, node: { attrs: WikiMentionAttrs }) {
          state.write(tokenFor(node.attrs.mtype, node.attrs.id))
        },
        parse: {
          // 칩 뒤 소프트 줄바꿈은 markdownText.ts 의 updateDOM(keepSoftbreakAfterInline)이 지켜낸다(WP-314).
          setup(markdownit: MarkdownIt) {
            markdownit.use(mentionRule)
          },
        },
      },
    }
  },
})
