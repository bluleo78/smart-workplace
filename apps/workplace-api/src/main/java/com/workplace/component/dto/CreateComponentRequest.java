package com.workplace.component.dto;

import com.workplace.global.util.SingleLineTitles;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** 구성요소 추가 요청(WP-933). 이름 1~40자, 설명 0~200자, 담당자는 선택(프로젝트 멤버·활성·사람만 — 서비스가 검증). */
public record CreateComponentRequest(
    @NotBlank(message = "구성요소 이름을 입력해 주세요") @Size(max = 40, message = "구성요소 이름은 40자까지 입력할 수 있습니다")
        String name,
    @Size(max = 200, message = "설명은 200자까지 입력할 수 있습니다") String description,
    Long defaultAssigneeId) {
  public CreateComponentRequest {
    // 이름은 한 줄로 다듬는다 — 앞뒤 공백·줄바꿈이 같은 이름을 둘로 만들지 않게(라벨과 같은 규칙, WP-628). 설명은 앞뒤 공백만 걷고 비면 없는 것으로 본다.
    name = SingleLineTitles.normalize(name);
    description = description == null || description.isBlank() ? null : description.strip();
  }
}
