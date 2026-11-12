// src/link-rule.ts — 본문을 쓰는 도구 설명에 붙이는 링크 규칙 한 마디(WP-1523).
// AI 가 본문에 없는 화면 주소를 지어냈다 — 이슈 키는 이슈 본문·코멘트·채팅에서 자동 링크가 되고, 그 밖의 링크는 도구가 돌려준 url 만 쓰게 한다.
// instructions(workplace-mcp)·웹 AI Chat 프롬프트의 같은 규칙을 정의 크기 상한(tool-naming.test.ts) 안에서 가장 짧게 줄인 것이다.

/** 이슈 키가 자동 링크가 되는 곳(이슈 본문·코멘트·이슈 챗·채널 메시지)을 쓰는 도구 설명 끝에 붙인다. */
export const LINK_RULE_AUTOLINK = ' Issue keys auto-link; other links only from tool urls.';

/** 노트(키가 자동 링크가 되지 않는다)를 쓰는 도구 설명 끝에 붙인다. */
export const LINK_RULE_WIKI = ' Links only from tool urls (keys do not auto-link).';
