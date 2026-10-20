package com.workplace.wiki.dto;

import com.workplace.global.util.SingleLineTitles;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

// title 은 빈 문자열 허용 — "제목 없음"은 프론트 표시용 폴백일 뿐 실제 저장값이 아니다(#596).
// 받을 때 한 줄로 다듬는다 — 공백뿐인 제목은 빈 제목, 줄바꿈은 공백(WP-601).
public record CreatePageRequest(Long parentId, @NotNull @Size(max = 255) String title) {
  public CreatePageRequest {
    title = SingleLineTitles.normalize(title);
  }
}
