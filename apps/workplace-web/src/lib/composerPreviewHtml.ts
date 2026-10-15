/**
 * AI 검토 개선본 미리보기(격리 iframe)를 작성 에디터(MailComposer)와 같은 모양으로 그리기 위한 기본 스타일(WP-404).
 *
 * 왜: srcDoc 문서는 앱 CSS 를 상속하지 않아 `<p>` 에 브라우저 기본 1em 여백이 붙는다. 에디터는 Tailwind preflight 로
 * 문단 여백이 0 이고 빈 줄은 빈 `<p></p>` 로만 표현되므로, 미리보기에선 문단 사이가 띄어 보이다가 "적용"하면 붙어 버렸다.
 * 에디터의 문단·목록·인용 규칙(index.css `.ProseMirror`)과 글자 크기(text-sm)·안쪽 여백(px-3 py-2)을 그대로 옮긴다.
 * 색은 넣지 않는다 — 다크 테마 색은 useMailDarkHtml 이 테마 토큰으로 입힌다(iframe 안에선 CSS 변수를 못 쓴다).
 */
export const COMPOSER_PREVIEW_STYLE =
  '<style data-composer-preview>' +
  "body{margin:0;padding:8px 12px;font-size:14px;line-height:20px;font-family:'Inter',ui-sans-serif,system-ui,sans-serif}" +
  'p{margin:0}' +
  // 빈 단락(빈 줄)은 브라우저가 높이 0 으로 접는다 — 에디터(ProseMirror)는 trailing <br> 로 한 줄 높이를 유지한다.
  'p:empty{min-height:20px}' +
  'ul,ol{margin:.5em 0;padding-left:1.5rem}' +
  'li{margin:.25em 0}' +
  'blockquote{margin:0;padding-left:.75rem;border-left:2px solid rgb(128 128 128 / .45);opacity:.75}' +
  'h1,h2,h3,h4{font-weight:600;line-height:1.3;margin:1.5em 0 .5em}' +
  'h1:first-child,h2:first-child,h3:first-child,h4:first-child{margin-top:0}' +
  'h1{font-size:1.75rem}h2{font-size:1.5rem}h3{font-size:1.125rem}h4{font-size:1rem}' +
  'pre{margin:.5em 0;padding:.75rem;border:1px solid rgb(128 128 128 / .45);border-radius:6px;overflow-x:auto}' +
  '</style>'

/** 공백만 든 단락 — 에디터는 빈 단락(한 줄)으로 읽지만 브라우저 `:empty` 엔 안 걸려 미리보기에서 높이 0 으로 접힌다. */
const BLANK_PARAGRAPH = /<p>\s*<\/p>/g

/**
 * 개선본 HTML 앞에 에디터 기본 스타일을 붙인다 — 문서 자신의 스타일보다 앞에 와서 개선본이 직접 꾸민 값이 이긴다.
 * 공백만 든 단락은 빈 단락으로 맞춰 `p:empty` 규칙(한 줄 높이)을 타게 한다.
 */
export function withComposerPreviewStyle(html: string): string {
  return COMPOSER_PREVIEW_STYLE + html.replace(BLANK_PARAGRAPH, '<p></p>')
}
