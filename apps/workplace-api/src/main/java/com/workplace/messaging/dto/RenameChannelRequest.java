package com.workplace.messaging.dto;

import com.workplace.global.util.SingleLineTitles;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** 채널 이름 변경 요청. */
public record RenameChannelRequest(
    @NotBlank(message = "채널 이름을 입력해 주세요") @Size(max = 80) String name) {
  public RenameChannelRequest {
    // 이름은 한 줄로 다듬는다 — 제로폭 문자만 있는 이름이 그대로 저장돼 빈 이름처럼 보였다(WP-671, WP-628 후속). 다듬어 비면 위 검증이 한국어로 거절한다
    name = SingleLineTitles.normalize(name);
  }
}
