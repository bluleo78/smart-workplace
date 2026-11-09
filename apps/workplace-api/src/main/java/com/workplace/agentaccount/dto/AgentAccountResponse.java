package com.workplace.agentaccount.dto;

import java.time.Instant;
import java.util.List;

/**
 * AI 계정 메타 응답(WP-1448) — 원문·암호문은 싣지 않는다. 라벨·종류·계정 이메일(로그인형)·마지막 갱신 시각·상태·시각, 그리고 이 계정을 쓰는 AI 목록.
 *
 * @param status ACTIVE(정상)·NEEDS_CHECK(확인 필요)·RELOGIN_REQUIRED(다시 로그인 필요)
 * @param usage 5시간·주간 사용량과 사용량 상태·마지막 사용 시각(WP-1449)
 */
public record AgentAccountResponse(
    long id,
    String provider,
    String label,
    String accountEmail,
    Instant lastRefreshedAt,
    String status,
    Instant createdAt,
    Instant updatedAt,
    List<BoundAgent> agents,
    AccountUsage usage) {

  /** 이 계정을 쓰는 AI 한 명. */
  public record BoundAgent(long userId, String username, String name) {}
}
