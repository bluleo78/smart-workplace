package com.workplace.wiki.dto;

/**
 * 노트 페이지 종류(WP-1307) — DB {@code wiki_page.kind} 값과 같다.
 *
 * <ul>
 *   <li>NOTE: 지금의 노트. 본문은 마크다운이고 동기화 서버(Yjs)로 함께 고친다.
 *   <li>HTML: 원본 HTML 을 그대로 보관·표시하는 「HTML 문서」. 동기화 서버 대상이 아니고 저장할 때마다 판을 남긴다.
 * </ul>
 */
public enum WikiPageKind {
  NOTE,
  HTML;

  /** DB 값 → 종류. 알 수 없는 값·null 은 NOTE(기존 페이지와 같은 동작)로 본다. */
  public static WikiPageKind of(String value) {
    return "HTML".equals(value) ? HTML : NOTE;
  }
}
