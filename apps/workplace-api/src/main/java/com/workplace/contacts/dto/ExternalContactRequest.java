package com.workplace.contacts.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * 외부 연락처 생성 요청(및 부분 수정 병합 결과). optional 필드의 빈 문자열은 저장 시 null 로 정규화한다. PATCH 요청 본문은 {@link
 * UpdateExternalContactRequest}(부분 수정, #839).
 */
public record ExternalContactRequest(
    @NotBlank @Size(max = 120) String name,
    @Email @Size(max = 255) String email,
    @Size(max = 40) String phone,
    @Size(max = 120) String organization,
    @Size(max = 100) String title,
    String notes,
    @NotNull @Pattern(regexp = "SHARED|PERSONAL") String visibility) {}
