package com.workplace.wiki.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

// title 은 빈 문자열 허용 — "제목 없음"은 프론트 표시용 폴백일 뿐 실제 저장값이 아니다(#596).
public record CreatePageRequest(Long parentId, @NotNull @Size(max = 255) String title) {}
