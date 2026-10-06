// 노트 AI 결과 삽입(WP-255) — 스트림을 모아 완료 시 한 번에 마크다운으로 파싱·삽입한다.
import type { Editor } from '@tiptap/core'

/**
 * AI 결과 마크다운을 캡처해 둔 범위(from~to)에 한 번에 파싱·삽입한다 — 생성(runAction)·변형(runTransform) 공용.
 * 단일 트랜잭션이라 undo 1회로 되돌아간다.
 *
 * - 스트림 중 문서가 바뀌었을 수 있어 범위를 현재 문서 크기로 클램프한다(from 도 — 대량 삭제 시 예외 방지).
 * - 여러 줄(블록) 결과는 preserveWhitespace=false 로 파싱한다: 기본값('full')은 markdown-it HTML 의 줄바꿈
 *   (`<li>항목\n<ul>`)을 글자로 남겨 하위 목록 위에 빈 줄이 생긴다(WP-255). 코드 블록(pre)은 자체 규칙으로 보존된다.
 * - 한 줄(인라인) 결과는 기본값을 유지한다: false 는 파싱 경계의 앞뒤 공백을 잘라, 굵게 등이 섞인 결과가
 *   문장 중간에서 앞뒤 단어와 붙는다(` 이어서 **굵게**` → `끝이어서`). 여러 줄이어도 맨 앞 공백은 같은 이유로
 *   먼저 텍스트로 넣는다(뒤 공백은 마지막 줄이 별도 블록이 되므로 무관).
 */
export function insertAiMarkdown(editor: Editor, from: number, to: number, markdown: string) {
  const size = editor.state.doc.content.size
  const range = { from: Math.min(from, size), to: Math.min(to, size) }
  const chain = editor.chain().focus()
  if (!markdown.trim().includes('\n')) {
    chain.insertContentAt(range, markdown).run()
    return
  }
  const lead = editor.state.doc.resolve(range.from).parent.inlineContent ? (/^[ \t]+/.exec(markdown)?.[0] ?? '') : ''
  chain
    .command(({ tr }) => {
      if (lead) tr.insertText(lead, range.from, range.to)
      return true
    })
    .insertContentAt(lead ? range.from + lead.length : range, markdown.slice(lead.length), {
      parseOptions: { preserveWhitespace: false },
    })
    .run()
}
