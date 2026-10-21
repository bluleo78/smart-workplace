package com.workplace.wiki.dto;

/**
 * 접근 요청 보내기 결과(WP-579) — {@code POST /wiki/shares/{token}/access-requests}. 받는 화면이 버튼·안내를 고른다.
 *
 * @param status PENDING(새로 보냈거나 이미 대기 중) | DENIED(같은 공유에 24시간 안에 거절됨 — 새 요청·알림을 만들지 않음) |
 *     NOT_NEEDED(요청할 필요 없음 — 이미 지정됨·스페이스 멤버·지정한 사람 링크가 아님)
 */
public record WikiShareAccessRequestResult(String status) {
  public static final WikiShareAccessRequestResult PENDING =
      new WikiShareAccessRequestResult("PENDING");
  public static final WikiShareAccessRequestResult DENIED =
      new WikiShareAccessRequestResult("DENIED");
  public static final WikiShareAccessRequestResult NOT_NEEDED =
      new WikiShareAccessRequestResult("NOT_NEEDED");
}
