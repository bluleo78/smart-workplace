package com.workplace.cycle.dto;

import com.workplace.global.util.SingleLineTitles;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;

/**
 * 사이클 생성/수정 공통 요청 본문. name·startDate·endDate 필수, goal·status 는 선택. status 가 null 이면 생성 시 PLANNED,
 * 수정 시 기존 값 유지. 기간은 WP-1316 부터 필수다 — 날짜 없이 만들어진 예전 사이클도 수정할 때 기간을 채워야 한다(같은 본문으로 덮어쓰는 수정이라 비우기도
 * 막힌다).
 */
public record CreateCycleRequest(
    @NotBlank(message = "사이클 이름을 입력해 주세요") @Size(max = 60) String name,
    @Size(max = 2000) String goal,
    @NotNull(message = "사이클 시작일을 입력해 주세요") LocalDate startDate,
    @NotNull(message = "사이클 종료일을 입력해 주세요") LocalDate endDate,
    String status) {
  public CreateCycleRequest {
    // 이름은 한 줄로 다듬는다 — 앞뒤 공백·제로폭 문자만 남은 이름이 목록에 빈 줄로 보였다(WP-628). 다듬어 비면 아래 검증이 한국어로 거절한다
    name = SingleLineTitles.normalize(name);
  }
}
