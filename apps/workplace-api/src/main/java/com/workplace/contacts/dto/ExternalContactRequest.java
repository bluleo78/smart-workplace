package com.workplace.contacts.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/** 외부 연락처 생성/수정 요청. PATCH 는 부분 패치가 아닌 전체 교체(모든 필드 제출). optional 필드의 빈 문자열은 서비스에서 null 로 정규화한다. */
public record ExternalContactRequest(
    @NotBlank @Size(max = 120) String name,
    @Email @Size(max = 255) String email,
    @Size(max = 40) String phone,
    @Size(max = 120) String organization,
    @Size(max = 100) String title,
    String notes,
    @NotNull @Pattern(regexp = "SHARED|PERSONAL") String visibility) {}
