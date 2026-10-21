package com.workplace.issue.dto;

import com.fasterxml.jackson.databind.JsonNode;
import com.workplace.global.util.SingleLineTitles;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * POST / PATCH 본문. PATCH 에서는 type 을 동일 값으로 전송 (변경 시 400). options 는 SELECT/MULTI_SELECT 만 non-null.
 */
public record CreateIssueFieldDefRequest(
    @NotBlank(message = "필드 이름을 입력해 주세요") @Size(max = 40) String name,
    @NotBlank String type,
    JsonNode options) {
  public CreateIssueFieldDefRequest {
    // 이름은 한 줄로 다듬는다 — 제로폭 문자만 있는 이름이 그대로 저장돼 빈 이름처럼 보였다(WP-671, WP-628 후속). 다듬어 비면 위 검증이 한국어로 거절한다
    name = SingleLineTitles.normalize(name);
  }
}
