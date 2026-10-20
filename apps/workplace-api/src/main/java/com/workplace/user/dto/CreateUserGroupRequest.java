package com.workplace.user.dto;

import com.workplace.global.util.SingleLineTitles;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/** 그룹 생성 요청. SHARED 는 user-group:manage 권한 필요(서비스에서 검증), PERSONAL 은 owner=caller. */
public record CreateUserGroupRequest(
    @NotBlank(message = "그룹 이름을 입력해 주세요") @Size(max = 100) String name,
    Long parentId,
    @NotNull @Pattern(regexp = "SHARED|PERSONAL") String visibility,
    @Size(max = 64) String code,
    Integer sortOrder) {
  public CreateUserGroupRequest {
    // 이름은 한 줄로 다듬는다 — 앞뒤 공백·제로폭 문자만 남은 이름이 목록에 빈 줄로 보였다(WP-628). 다듬어 비면 아래 검증이 한국어로 거절한다
    name = SingleLineTitles.normalize(name);
  }
}
