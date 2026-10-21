package com.workplace.issue.dto;

import com.workplace.global.util.SingleLineTitles;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** 유형 생성/수정 본문. PATCH 도 동일 record 사용. */
public record CreateIssueTypeRequest(
    @NotBlank(message = "유형 이름을 입력해 주세요") @Size(max = 40) String name,
    @NotBlank String colorToken,
    @NotBlank String icon) {
  public CreateIssueTypeRequest {
    // 이름은 한 줄로 다듬는다 — 제로폭 문자만 있는 이름이 그대로 저장돼 빈 이름처럼 보였다(WP-671, WP-628 후속). 다듬어 비면 위 검증이 한국어로 거절한다
    name = SingleLineTitles.normalize(name);
  }
}
