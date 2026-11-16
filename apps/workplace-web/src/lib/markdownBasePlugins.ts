// 앱 공용 markdown 문법(WP-1633) — CommonMark + GFM + 한국어 강조 규칙. AI 답(MarkdownMessage)·도움말(HelpMarkdown)·
// 도움말 파서(help/mdast)가 같은 목록을 써서 규칙이 어긋나지 않게 한다.
// CommonMark 는 닫는 `**`·`~~` 앞이 문장부호이고 뒤가 글자(한국어 조사)면 닫는 기호로 보지 않아 `**설정(A)**을` 이 기호째 보였다 —
// 한중일 글자 옆에서만 규칙을 넓히는 cjk-friendly 확장을 remark-gfm 뒤에 둔다(취소선 해석을 넘겨받는다). 영문 규칙은 그대로다.
import { gfmStrikethroughCjkFriendly } from 'micromark-extension-cjk-friendly-gfm-strikethrough'
import remarkCjkFriendly from 'remark-cjk-friendly/parseOnly'
import remarkGfm from 'remark-gfm'
import type { PluggableList } from 'unified'

/**
 * GFM 취소선의 한국어 규칙 — remark-cjk-friendly-gfm-strikethrough/parseOnly 와 같은 일을 한다.
 * 그 패키지는 2주 안 된 mdast-util-to-markdown 을 끌어와 확장만 직접 쓴다.
 */
function remarkCjkStrikethrough(this: { data: () => { micromarkExtensions?: unknown[] } }) {
  const data = this.data()
  ;(data.micromarkExtensions ??= []).push(gfmStrikethroughCjkFriendly())
}

/** 앱 공용 remark 플러그인 목록 — 순서가 의미 있다(remark-gfm 다음에 한국어 규칙). */
export const markdownBasePlugins: PluggableList = [remarkGfm, remarkCjkFriendly, remarkCjkStrikethrough]
