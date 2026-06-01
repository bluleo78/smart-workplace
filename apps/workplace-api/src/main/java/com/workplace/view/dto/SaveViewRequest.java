package com.workplace.view.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/** 뷰 생성/수정 공통 요청. query 는 프론트 필터 쿼리스트링(불투명, NotBlank). */
public record SaveViewRequest(
    @NotBlank @Size(max = 60) String name,
    @NotBlank @Size(max = 2000) String query,
    @Pattern(regexp = "PRIVATE|SHARED") String visibility) {}
