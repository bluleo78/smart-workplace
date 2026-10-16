package com.workplace.file.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * 스테이징 업로드 링크 발급 요청(WP-421).
 *
 * @param name 올릴 파일 이름 — 링크에 묶이고 PUT 본문이 이 이름으로 저장된다
 */
public record CreateStagedLinkRequest(@NotBlank @Size(max = 255) String name) {}
