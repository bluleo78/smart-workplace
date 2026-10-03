package com.workplace.mail.dto;

import java.util.Map;

/**
 * WP-186 사이드바 안 읽은 수 — classificationActive=false 면 웹이 분류 하위 항목을 숨기고 받은편지함을 전체로 본다. byCategory.업무 는
 * 미분류 포함.
 */
public record MailUnreadCounts(
    boolean classificationActive, long inbox, Map<String, Long> byCategory, long needsReply) {

  /** WP-186 모바일 탭 배지 — 내 모든 활성 계정의 업무 보기 안 읽은 수 합(분류 꺼진 계정은 받은편지함 안 읽은 수). */
  public record Summary(long workUnread) {}
}
