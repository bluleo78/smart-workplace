package com.workplace.issue.dto;

import com.workplace.global.util.SingleLineTitles;
import jakarta.validation.constraints.NotBlank;

/** 프로젝트 상태 이름 변경 본문(WP-807). 범주는 바꾸지 않는다. */
public record RenameProjectStatusRequest(@NotBlank(message = "상태 이름을 입력해 주세요") String name) {
  public RenameProjectStatusRequest {
    // 추가와 같은 한 줄 정규화 — 다듬어 비면 위 검증(또는 서비스)이 거절한다
    name = SingleLineTitles.normalize(name);
  }
}
