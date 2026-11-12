// 도움말 표식 링크의 스킴과 주소 정리 규칙(WP-1511) — 도움말 본문(HelpMarkdown)과 AI 답(helpAnswer)이 한 곳에서 정의해 쓴다.
// 답 쪽은 여기에 창 열기(dialog:)·매뉴얼 보강(manual-gap:)을 더한다.
import { defaultUrlTransform } from 'react-markdown'

/** 패널 안 절 이동·출처 링크 스킴. */
export const HELP_SCHEME = 'help:'
/** 매뉴얼 그림 스킴. */
export const FIGURE_SCHEME = 'figure:'

/**
 * react-markdown 의 urlTransform 을 만든다. 기본 변환(defaultUrlTransform)은 모르는 스킴을 빈 값으로 바꿔 표식을 지우므로,
 * 주어진 표식 스킴만 그대로 두고 나머지(javascript: 등)는 기본 규칙에 맡겨 안전하게 걸러 낸다.
 * 표식은 「정확히 소문자 접두」일 때만 표식이다 — 대소문자가 섞이거나 앞에 공백이 붙은 것은 일반 주소로 보아 빈 값이 된다
 * (한쪽만 느슨하면 변환은 통과시켰는데 렌더러가 못 알아보는 어긋남이 생긴다).
 */
export function makeUrlTransform(schemes: readonly string[]): (url: string) => string {
  return (url) => (schemes.some((scheme) => url.startsWith(scheme)) ? url : defaultUrlTransform(url))
}
