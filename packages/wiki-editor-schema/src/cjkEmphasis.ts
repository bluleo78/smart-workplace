// 한국어·중국어·일본어(CJK) 친화 강조 규칙(WP-1638).
//
// 왜: CommonMark 의 flanking 규칙은 닫는 `**` 앞이 문장부호이고 뒤가 글자면 닫을 수 없다고 본다.
// 한국어는 조사가 단어에 바로 붙어서 `**설정(A)**을`·`**"허용"**으로`·`` **`VBR`**을 `` 같은 글이 흔한데,
// 이대로는 굵게가 되지 않고 별표가 글자로 남았다. markdown-it-cjk-friendly 는 표시 바로 옆 글자가 CJK 일 때만
// 이 규칙을 완화한다 — 라틴 문자끼리(`**foo(a)**bar`·`a__b__c`)는 CommonMark 그대로다.
//
// 어떻게: 플러그인은 md.inline.State 를 scanDelims 를 고친 하위 클래스로 바꿔 끼운다.
// - 읽기: WikiCjkEmphasis 확장이 tiptap-markdown 파서의 markdown-it 에 단다(웹 편집기·붙여넣기·미리보기·collab 변환기 공통).
// - 쓰기: markSerializerState.ts 의 표시 밀기 판정(scanDelims)용 markdown-it 에도 단다 — 읽기·쓰기 판정이 어긋나면
//   저장 때 `**설정(A**)을` 처럼 표시를 옮겨 버린다.
import { Extension } from '@tiptap/core'
import type MarkdownIt from 'markdown-it'
import cjkFriendly from 'markdown-it-cjk-friendly'

// 규칙을 이미 단 markdown-it 인스턴스. tiptap-markdown 은 parse() 마다 같은 인스턴스에 setup 을 다시 부르는데,
// 플러그인은 부를 때마다 State 하위 클래스를 한 겹 더 씌우므로 가드가 없으면 파싱 횟수만큼 쌓인다
// (collab 서버는 변환기 하나를 계속 재사용한다 — mentionNode.ts 와 같은 방식).
const applied = new WeakSet<MarkdownIt>()

/** markdown-it 인스턴스에 CJK 친화 강조 규칙을 한 번만 단다. */
export function applyCjkFriendly(md: MarkdownIt): MarkdownIt {
  if (applied.has(md)) return md
  applied.add(md)
  md.use(cjkFriendly)
  return md
}

/** tiptap-markdown 파서에 CJK 친화 강조 규칙을 다는 확장 — 스키마는 바꾸지 않는다. */
export const WikiCjkEmphasis = Extension.create({
  name: 'wikiCjkEmphasis',
  addStorage() {
    return {
      markdown: {
        parse: {
          setup(markdownit: MarkdownIt) {
            applyCjkFriendly(markdownit)
          },
        },
      },
    }
  },
})
