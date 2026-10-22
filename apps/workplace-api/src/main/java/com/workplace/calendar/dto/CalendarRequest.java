package com.workplace.calendar.dto;

import com.workplace.global.util.SingleLineTitles;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** 캘린더 생성/수정 요청. color 는 팔레트 키. position 은 선택(미지정 시 서비스가 말미 배치). */
public record CalendarRequest(
    @NotBlank(message = "캘린더 이름을 입력해 주세요") @Size(max = 100) String name,
    @NotBlank @Size(max = 32) String color,
    // 순서는 0~10000 — 음수·최댓값이 그대로 저장돼, 최댓값 뒤 말미 배치가 오버플로로 맨 앞에 정렬됐다(WP-747).
    @Min(value = 0, message = "캘린더 순서는 0~10000 이어야 합니다")
        @Max(value = 10000, message = "캘린더 순서는 0~10000 이어야 합니다")
        Integer position) {
  public CalendarRequest {
    // 이름은 한 줄로 다듬는다 — 제로폭 문자만 있는 이름이 그대로 저장돼 빈 이름처럼 보였다(WP-671, WP-628 후속). 다듬어 비면 위 검증이 한국어로 거절한다
    name = SingleLineTitles.normalize(name);
  }
}
