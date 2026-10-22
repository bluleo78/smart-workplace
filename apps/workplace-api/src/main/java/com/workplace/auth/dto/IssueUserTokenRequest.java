package com.workplace.auth.dto;

import com.workplace.global.time.SupportedDateTime;
import com.workplace.global.util.SingleLineTitles;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.time.Instant;

/** PAT 발급 요청. expiresAt null 이면 무기한. */
public record IssueUserTokenRequest(
    @NotBlank(message = "토큰 이름을 입력해 주세요") @Size(max = 80) String name,
    @SupportedDateTime Instant expiresAt) {
  public IssueUserTokenRequest {
    // 이름은 한 줄로 다듬는다 — 제로폭 공백·점자 빈칸만 있는 이름이 그대로 발급돼 목록에서 빈 칸으로 보였다(WP-767, WP-724 빈틈).
    // 다듬어 비면 위 검증이 한국어로 거절한다
    name = SingleLineTitles.normalize(name);
  }
}
