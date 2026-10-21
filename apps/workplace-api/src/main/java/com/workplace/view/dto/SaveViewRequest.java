package com.workplace.view.dto;

import com.workplace.global.util.SingleLineTitles;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/** 뷰 생성/수정 공통 요청. query 는 프론트 필터 쿼리스트링(불투명, NotBlank). */
public record SaveViewRequest(
    @NotBlank(message = "뷰 이름을 입력해 주세요") @Size(max = 60) String name,
    @NotBlank @Size(max = 2000) String query,
    @Pattern(regexp = "PRIVATE|SHARED") String visibility) {
  public SaveViewRequest {
    // 이름은 한 줄로 다듬는다 — 제로폭 문자만 있는 이름이 그대로 저장돼 빈 이름처럼 보였다(WP-671, WP-628 후속). 다듬어 비면 위 검증이 한국어로 거절한다
    name = SingleLineTitles.normalize(name);
  }
}
