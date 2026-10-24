package com.workplace.issue.dto;

import com.workplace.global.util.SingleLineTitles;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

/**
 * 프로젝트 상태 추가 본문(WP-807). afterStatusId 가 있으면 그 상태 바로 뒤에, 없으면 범주 맨 뒤에 넣는다. color 가 없으면 범주 기본
 * 색({@link StatusDefaultColors}), 있으면 서비스가 색 토큰인지 확인한다(WP-809). 길이(30자)는 서비스가 한국어 문구로 거절한다.
 */
public record CreateProjectStatusRequest(
    @NotBlank(message = "상태 이름을 입력해 주세요") String name,
    @NotBlank @Pattern(regexp = IssueStatuses.CATEGORY_REGEX) String category,
    Long afterStatusId,
    String color) {
  public CreateProjectStatusRequest {
    // 이름은 한 줄로 다듬는다 — 줄바꿈·앞뒤 공백·제로폭 문자만 남은 이름이 보드 컬럼에 빈 머리로 보이지 않게(유형 이름 WP-671 과 같은 규칙)
    name = SingleLineTitles.normalize(name);
  }
}
