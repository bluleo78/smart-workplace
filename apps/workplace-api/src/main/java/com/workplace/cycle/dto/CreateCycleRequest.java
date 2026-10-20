package com.workplace.cycle.dto;

import com.workplace.global.util.SingleLineTitles;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;

/** 사이클 생성/수정 공통 요청 본문. name 필수, 나머지는 선택. status 가 null 이면 생성 시 PLANNED, 수정 시 기존 값 유지. */
public record CreateCycleRequest(
    @NotBlank(message = "사이클 이름을 입력해 주세요") @Size(max = 60) String name,
    @Size(max = 2000) String goal,
    LocalDate startDate,
    LocalDate endDate,
    String status) {
  public CreateCycleRequest {
    // 이름은 한 줄로 다듬는다 — 앞뒤 공백·제로폭 문자만 남은 이름이 목록에 빈 줄로 보였다(WP-628). 다듬어 비면 아래 검증이 한국어로 거절한다
    name = SingleLineTitles.normalize(name);
  }
}
