package com.workplace.issue.dto;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.workplace.global.util.SingleLineTitles;
import jakarta.validation.constraints.AssertTrue;

/**
 * 프로젝트 상태 수정 본문(WP-807 이름 변경 → WP-809 색 추가). 이름·색 중 보낸 것만 바꾸고 범주는 바꾸지 않는다. 이름만 보내던 구 웹 본문도 그대로 받는다.
 * 이름 검증(빈 값·길이·범주 코드)과 색 토큰 검증은 서비스가 한국어 400 으로 한다.
 */
public record UpdateProjectStatusRequest(String name, String color) {
  public UpdateProjectStatusRequest {
    // 추가와 같은 한 줄 정규화 — 다듬어 비면 서비스가 「상태 이름을 입력해 주세요」로 거절한다(null 은 이름을 안 바꿈)
    name = SingleLineTitles.normalize(name);
  }

  /** 이름·색이 모두 없으면 바꿀 것이 없다 — 400. */
  @JsonIgnore
  @AssertTrue(message = "바꿀 내용을 입력해 주세요")
  public boolean isAnyChange() {
    return name != null || color != null;
  }
}
