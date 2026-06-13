package com.workplace.project.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * 프로젝트 생성 요청. TEAM 은 key 필수(대문자/숫자 2~10자, 첫 글자 대문자) — null/형식 검증은 서비스에서 수행. PERSONAL 은 key 를 생략하면
 * 서버가 자동 생성하므로 {@code @NotBlank} 를 두지 않는다(@Pattern 은 null 을 허용). type 미지정(null) 시 TEAM 으로 간주.
 */
public record CreateProjectRequest(
    @Pattern(regexp = "^[A-Z][A-Z0-9]{1,9}$", message = "key 는 대문자/숫자 2~10자, 첫 글자는 대문자여야 합니다")
        String key,
    @NotBlank @Size(max = 120) String name,
    @Size(max = 2000) String description,
    String type) {

  /** 기존 3-인자 호출 호환용. type 미지정 → null 로 위임(typeOrDefault 에서 TEAM 으로 해석). */
  public CreateProjectRequest(String key, String name, String description) {
    this(key, name, description, null);
  }

  /** type 미지정(null/blank) 시 TEAM 으로 해석. */
  public String typeOrDefault() {
    return (type == null || type.isBlank()) ? "TEAM" : type;
  }
}
