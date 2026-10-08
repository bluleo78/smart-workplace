import type { AnyExtension, Extensions } from '@tiptap/core'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import { TableRow } from '@tiptap/extension-table-row'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from 'tiptap-markdown'

import { WikiCode } from './codeMark'
import { WikiImageSchema } from './imageNode'
import { WikiLink } from './linkMark'
import { WikiMarkdownText } from './markdownText'
import { WikiMention } from './mentionNode'
import { WikiTable } from './tableNode'

/**
 * 노트 문서 스키마를 정하는 확장 묶음 — 웹 에디터와 동기화 서버가 같은 것을 써야
 * 마크다운 파싱·직렬화와 Yjs 노드 구조가 일치한다.
 * - 기본 history 는 항상 끈다 — 웹은 Collaboration(Yjs undo, 내 편집만 되돌림)을 쓰고 서버 변환기엔 실행 취소가 없다.
 * - image/mention 은 웹이 NodeView 를 붙인 버전을 주입하는 자리(스키마는 동일해야 한다).
 * - 순서는 기존 WikiEditor 와 같게 유지(Markdown 확장이 Text 직렬화기를 덮지 않도록 Text 다음).
 */
export function wikiSchemaExtensions(
  opts: { image?: AnyExtension; mention?: AnyExtension } = {},
): Extensions {
  return [
    // text 노드만 교체 — 표 셀 안의 | 를 이스케이프한다(#755). markdownText.ts 참조.
    // code 도 교체 — 링크로 감싼 인라인 코드([`code`](url))를 허용한다(WP-300). codeMark.ts 참조.
    StarterKit.configure({ text: false, history: false, code: false }),
    WikiMarkdownText,
    WikiCode,
    // 붙여넣기 자동 변환(#753) — 기본값 false 라 터미널·.md 파일에서 복사한 '## 제목' 이
    // 평문으로 들어갔다. transformCopiedText 는 켜지 않는다: 켜면 에디터 내부 복사→붙여넣기가
    // 마크다운 텍스트로 왕복하면서 멘션 칩이 <#page:12> 토큰 평문으로 퇴화한다.
    // html 옵션은 기본값 true 를 유지해야 한다 — 기존 페이지에 raw HTML 로 직렬화돼 저장된
    // 표(#742 폴백 경로)를 파싱하는 것이 이 옵션이라, 끄면 로드가 깨진다.
    Markdown.configure({ transformPastedText: true }),
    opts.mention ?? WikiMention,
    // 이미지(#750) — 미등록 시 markdown-it 이 파싱한 이미지를 ProseMirror 가 버려서
    // 이미지가 든 페이지를 열었다 저장하면 영구 삭제됐다(AI/MCP 위키 도구가 본문을 직접 쓴다).
    // 노드 이름 'image' 유지 + inline:true 는 라운드트립 무손실의 필수 조건 — imageNode.ts 참조.
    opts.image ?? WikiImageSchema,
    // 링크(WP-300) — 미등록 시 마크다운 [text](url) 의 링크가 파싱에서 버려져 저장하면 글자만 남았다. linkMark.ts 참조.
    WikiLink,
    // 표(#742) — StarterKit 에 없어서 마크다운 표가 문단으로 합쳐져 깨졌다. AI 생성물(/ai 요약·초안)이
    // 표를 자주 만들기 때문에 체감 결함이 컸다. tiptap-markdown 이 table 직렬화기를 내장하고 있어
    // 저장 → 재로드 라운드트립이 성립한다(GFM 으로 표현 못 하는 병합셀 등은 자체 폴백).
    // resizable 은 끈다 — 열 너비를 픽셀로 문서에 심으면 마크다운 직렬화에서 버려져 무의미하다.
    // renderWrapper 기본값이 false 라 div.tableWrapper 가 아예 렌더되지 않았고, 그 래퍼에
    // 걸어둔 가로 스크롤 CSS 가 죽은 코드였다(#754). 켜야 넓은 표가 스크롤된다.
    // 직렬화기는 텍스트 없는 셀(멘션·이미지만)을 살리도록 대체했다(WP-299) — tableNode.ts 참조.
    WikiTable.configure({ resizable: false, renderWrapper: true }),
    TableRow,
    TableHeader,
    TableCell,
  ]
}
