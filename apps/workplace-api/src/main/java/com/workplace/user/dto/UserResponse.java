package com.workplace.user.dto;

import com.fasterxml.jackson.annotation.JsonFormat;
import com.workplace.global.dto.UserSummary;
import java.time.LocalDateTime;

public record UserResponse(
    Long id,
    String username,
    String email,
    String name,
    boolean isActive,
    @JsonFormat(pattern = "yyyy-MM-dd'T'HH:mm:ss") LocalDateTime createdAt,
    // Phase 5a — HUMAN | AGENT (마지막 위치 추가, 호출자 모두 갱신)
    String kind) {

  /** 응답·이력용 사용자 요약. */
  public UserSummary toSummary() {
    return new UserSummary(id, username, name, kind);
  }

  /** 활성 HUMAN 계정인지 — 테넌트 소유자처럼 실제 로그인해 운영할 사람이 필요한 자리에 지정 가능한지(WP-337). */
  public boolean isActiveHuman() {
    return UserKind.HUMAN.equals(kind) && isActive;
  }
}
