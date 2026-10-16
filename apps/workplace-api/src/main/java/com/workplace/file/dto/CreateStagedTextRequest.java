package com.workplace.file.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * 텍스트로 스테이징 파일 만들기 요청(WP-421) — AI·MCP 가 쓴 내용을 UTF-8 로 저장해 임시 첨부로 둔다.
 *
 * @param name 파일 이름(확장자로 MIME 을 정한다 — md·txt·csv·json 외 text/plain)
 * @param content 본문(빈 문자열 허용, UTF-8 10MB 이하)
 */
public record CreateStagedTextRequest(
    @NotBlank @Size(max = 255) String name, @NotNull String content) {}
