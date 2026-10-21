package com.workplace.wiki.dto;

/**
 * 공유 설정·기록에 보이는 사람(공유한 사람·지정한 사람·접근 요청자·기록의 행위자) — 웹 {@code WikiSharePerson} 과 같은 모양(WP-579).
 *
 * @param userId 사용자 id. 시스템이 한 일(행위자 없음)은 0
 * @param name 표시 이름
 */
public record WikiSharePerson(long userId, String name) {
  /** 사람이 아닌 시스템이 한 일(정책 끔·멤버십 자동 해제 등)의 행위자 — 웹이 「시스템님이 …」처럼 그대로 이름을 붙인다. */
  public static final WikiSharePerson SYSTEM = new WikiSharePerson(0L, "시스템");
}
