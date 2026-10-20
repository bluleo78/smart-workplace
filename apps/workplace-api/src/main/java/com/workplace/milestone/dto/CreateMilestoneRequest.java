package com.workplace.milestone.dto;

import com.workplace.global.util.SingleLineTitles;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;

/** 마일스톤 생성/수정 공통 요청 본문. name/dueDate 는 생성·수정 모두 필수, description 은 선택. */
public record CreateMilestoneRequest(
    @NotBlank(message = "마일스톤 이름을 입력해 주세요") @Size(max = 100) String name,
    @NotNull LocalDate dueDate,
    @Size(max = 2000) String description) {
  public CreateMilestoneRequest {
    // 이름은 한 줄로 다듬는다 — 앞뒤 공백·제로폭 문자만 남은 이름이 목록에 빈 줄로 보였다(WP-628). 다듬어 비면 아래 검증이 한국어로 거절한다
    name = SingleLineTitles.normalize(name);
  }
}
