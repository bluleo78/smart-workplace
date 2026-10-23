package com.workplace.label.dto;

import com.workplace.global.util.SingleLineTitles;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** 라벨 생성/수정 공통 요청 본문. 두 시나리오 모두 name + colorToken 필수. */
public record CreateLabelRequest(
    @NotBlank(message = "라벨 이름을 입력해 주세요")
        // 공용 Size 문구(「최대 40까지」)는 어느 칸·무슨 단위인지 없어 이름과 단위를 밝힌다(WP-850).
        @Size(max = 40, message = "라벨 이름은 40자까지 입력할 수 있습니다")
        String name,
    @NotBlank String colorToken) {
  public CreateLabelRequest {
    // 이름은 한 줄로 다듬는다 — 앞뒤 공백·제로폭 문자만 남은 이름이 목록에 빈 줄로 보였다(WP-628). 다듬어 비면 아래 검증이 한국어로 거절한다
    name = SingleLineTitles.normalize(name);
  }
}
