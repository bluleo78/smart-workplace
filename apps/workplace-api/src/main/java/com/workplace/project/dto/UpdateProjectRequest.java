package com.workplace.project.dto;

import com.workplace.global.util.SingleLineTitles;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * 프로젝트 부분 수정 요청(#858). key 는 불변. null 필드는 변경 없음을 의미하고, 설명을 비우려면 {@code clearDescription=true} 를
 * 보낸다(이슈 PATCH 와 같은 규칙). name 은 보낼 때만 공백이 아니어야 한다 — 이전엔 전체 덮어쓰기라 name 만 보내면 설명이 null 로 지워졌다.
 */
public record UpdateProjectRequest(
    @Size(max = 120) @Pattern(regexp = "(?s).*\\S.*", message = "이름은 비워 둘 수 없습니다.") String name,
    @Size(max = 2000) String description,
    Boolean clearDescription) {
  public UpdateProjectRequest {
    // 이름은 한 줄로 다듬는다 — 앞뒤 공백·제로폭 문자만 남은 이름이 목록에 빈 줄로 보였다(WP-628). 다듬어 비면 아래 검증이 한국어로 거절한다
    name = SingleLineTitles.normalize(name);
  }
}
