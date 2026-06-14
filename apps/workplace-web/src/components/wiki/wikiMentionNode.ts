// 위키 에디터용 인라인 atom 멘션 노드 `wikiMention`.
// - 화면: data-* 속성을 가진 <span> 칩(라벨 표시). 시맨틱 토큰만 사용(hex 금지).
// - 저장: tiptap-markdown 직렬화 시 클린 토큰(<@id>·<#page:id>·<#issue:id>)으로 raw write.
// - 로드: Markdown(html:true) passthrough 된 <span data-mtype> 를 parseHTML 로 노드 복원.
// 에디터 통합(extensions 배열 추가·로드 전처리·@ suggestion)은 Task 8 범위.

import { mergeAttributes, Node } from '@tiptap/core'

import type { WikiMentionType } from '../../types/wiki'
import { tokenFor } from './wikiMentionSerialize'

// tiptap-markdown 직렬화 스펙 타입(state.write 만 사용). 0.8.10 은 storage.markdown.serialize 를
// getMarkdownSpec 으로 읽어 { editor, options } 바인딩 후 호출한다.
interface MarkdownSerializerState {
  write(text: string): void
}

// 노드 attrs — mtype/id 가 토큰 직렬화의 원천, label 은 칩 표시용.
export interface WikiMentionAttrs {
  mtype: WikiMentionType
  id: number
  label: string
}

// 칩 스타일 — 디자인 시스템 시맨틱 토큰만(hex/임의색 금지). chat .chat-mention 의 하드코딩 색 대신
// accent 토큰을 재사용해 라이트/다크 테마에 자동 대응.
// 칩 기본 스타일. cursor-pointer 는 내비 가능한 칩(PAGE/ISSUE)에만 부여 — USER 칩은 클릭 무동작이라
// 거짓 affordance 를 피하려 기본 클래스만 쓴다(mtype 분기는 renderHTML 에서).
const BASE_CHIP_CLASS = 'rounded bg-accent px-1 font-medium text-accent-foreground'
const NAV_CHIP_CLASS = `${BASE_CHIP_CLASS} cursor-pointer`

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
        parseHTML: (el) => el.getAttribute('data-mtype'),
        renderHTML: (attrs) => ({ 'data-mtype': attrs.mtype }),
      },
      // data-id="<number>"
      id: {
        default: 0,
        parseHTML: (el) => Number(el.getAttribute('data-id')),
        renderHTML: (attrs) => ({ 'data-id': String(attrs.id) }),
      },
      // data-label="<표시 라벨>"
      label: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-label') ?? el.textContent ?? '',
        renderHTML: (attrs) => ({ 'data-label': attrs.label }),
      },
    }
  },

  // Markdown(html:true) passthrough 로 들어온 <span data-mtype> 를 노드로 복원.
  parseHTML() {
    return [{ tag: 'span[data-mtype]' }]
  },

  // 칩 렌더 — data-* + 칩 클래스, 자식은 라벨 텍스트. USER 는 무동작이라 cursor-pointer 제외.
  renderHTML({ node, HTMLAttributes }) {
    const cls = (node.attrs.mtype as string) === 'USER' ? BASE_CHIP_CLASS : NAV_CHIP_CLASS
    return ['span', mergeAttributes(HTMLAttributes, { class: cls }), node.attrs.label as string]
  },

  // tiptap-markdown 직렬화 — 저장 본문을 클린 토큰으로 유지하는 핵심.
  // state.write 는 이스케이프 없이 raw write 하므로 토큰의 <,#,@ 가 그대로 보존된다.
  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownSerializerState, node: { attrs: WikiMentionAttrs }) {
          state.write(tokenFor(node.attrs.mtype, node.attrs.id))
        },
        // 인라인 atom 이므로 파싱은 parseHTML(span passthrough) 경로를 사용. 별도 markdown parse 없음.
        parse: {},
      },
    }
  },
})
