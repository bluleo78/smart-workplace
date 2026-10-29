/**
 * 보이는 글자 판정 (WP-1107).
 *
 * 공백·제로폭 문자·결합 부호·한글 채움(\u3164)·점자 빈칸처럼 화면에 아무것도 그려지지 않는 글자만 있으면 비어 있는 것으로 본다.
 * 서버 `PersonNames.hasVisibleChar` 와 같은 범위라, 화면에서 통과한 제목이 서버에서 「제목을 입력해 주세요」로 막히지 않는다.
 */
const VISIBLE = /[^\s\p{Z}\p{Cf}\p{Cc}\p{Mn}\p{Me}\u115F\u1160\u3164\uFFA0\u2800]/u

/** 화면에 보이는 글자가 하나라도 있는가. */
export function hasVisibleText(text: string): boolean {
  return VISIBLE.test(text)
}
