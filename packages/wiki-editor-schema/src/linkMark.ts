// 노트 링크 마크 — 마크다운 [text](url) 를 문서에 담는다(WP-300).
//
// 왜 필요한가: StarterKit 2.x 에는 Link 가 없어서 markdown-it 이 만든 <a> 를 ProseMirror 가 버렸고,
// 링크가 든 본문(AI·MCP 작성, 마크다운 붙여넣기)을 열었다 저장하면 글자만 남았다. 직렬화는
// tiptap-markdown 내장 link 직렬화기(prosemirror-markdown 기본)가 이름 'link' 로 찾아 쓰므로 이름을 바꾸면 안 된다.
import type { Attributes } from '@tiptap/core'
import Link from '@tiptap/extension-link'
import { defaultMarkdownSerializer } from '@tiptap/pm/markdown'
import type { Mark } from '@tiptap/pm/model'
import MarkdownIt from 'markdown-it'

import { escapeTablePipes, type TableAwareState } from './tablePipe'

// 주소 정규화 전용 markdown-it 인스턴스 — 마크다운 파싱 경로와 같은 normalizeLink(퍼센트 인코딩·호스트 punycode)를 쓴다.
const normalizer = new MarkdownIt()

/**
 * HTML 로 들어온 href 를 마크다운 파싱 경로와 같은 형태로 정규화한다.
 * markdown-it 은 [t](url) 의 주소를 normalizeLink 로 인코딩해 <a href> 를 만들지만, HTML 붙여넣기·raw HTML 의 href 는
 * 그 과정을 거치지 않는다. 그대로 두면 공백 든 주소는 저장 후 링크 문법이 깨져 평문이 되고, | < 비ASCII 는 다시 열 때
 * 인코딩돼 저장할 때마다 본문이 바뀐다. 이미 인코딩된 %XX 는 유지되므로 두 번 적용해도 같다.
 */
function normalizeHref(href: string | null): string | null {
  return href == null ? null : normalizer.normalizeLink(href.trim())
}

const baseLinkSerializer = defaultMarkdownSerializer.marks.link

/**
 * - 문서 속성은 href·title 만 둔다. 마크다운이 싣지 못하는 target/rel/class 를 저장하면 HTML 붙여넣기로 들어온
 *   링크(target="_self" 등)와 저장 후 재파싱한 링크가 달라져, AI 적용(updateYFragment)마다 링크 마크가 다시
 *   쓰이고 병합 기준이 흔들린다(이미지 alt 정규화 WP-283 과 같은 이유). target/rel 은 렌더할 때만 붙인다(HTMLAttributes).
 * - title 은 마크다운 [t](u "title") 이 싣는 값이라 보존한다(기본 Link 엔 속성이 없어 조용히 사라진다).
 * - autolink·linkOnPaste·붙여넣기 규칙은 끈다 — 맨 URL 을 치거나 붙여넣으면 링크 마크가 붙어 저장 마크다운이
 *   `https://…` 에서 `<https://…>` 로 바뀐다. 이번 수정 범위(기존 링크 보존) 밖의 동작 변경이다.
 * - openOnClick 은 끈다 — 기본 클릭 핸들러는 noopener 없이 window.open 하고, 편집 중 링크 글자를 누를 때마다 새 탭이 뜬다.
 *   편집 모드 열기는 웹이 Ctrl/⌘+클릭으로 따로 처리하고, 보기 전용은 렌더된 <a target=_blank rel=noopener> 가 그대로 동작한다.
 * - 직렬화는 prosemirror-markdown 기본과 같되, 표 셀 안에선 주소·title 의 | 를 이스케이프한다(셀 쪼개짐 방지).
 * - javascript: 등 위험한 주소는 Link 의 isAllowedUri 가 파싱(링크 버림)·렌더(href 비움) 양쪽에서 막는다.
 */
export const WikiLink = Link.configure({
  openOnClick: false,
  autolink: false,
  linkOnPaste: false,
}).extend({
  addAttributes() {
    return {
      href: { ...(this.parent?.() as Attributes | undefined)?.href, parseHTML: (el: HTMLElement) => normalizeHref(el.getAttribute('href')) },
      title: { default: null, parseHTML: (el: HTMLElement) => el.getAttribute('title') },
    }
  },
  addStorage() {
    return {
      markdown: {
        serialize: {
          ...baseLinkSerializer,
          // 기본 close 와 같은 출력 — 표 셀 안이면 주소·title 의 | 만 추가로 이스케이프한다.
          close(state: TableAwareState, mark: Mark) {
            const { inAutolink } = state
            state.inAutolink = undefined
            if (inAutolink) return '>'
            const href = escapeTablePipes(state, (mark.attrs.href as string).replace(/[()"]/g, '\\$&'))
            const title = mark.attrs.title as string | null
            const titlePart = title ? ` "${escapeTablePipes(state, title.replace(/"/g, '\\"'))}"` : ''
            return `](${href}${titlePart})`
          },
        },
        parse: {
          // markdown-it 이 처리한다.
        },
      },
    }
  },
  addPasteRules() {
    return []
  },
})
