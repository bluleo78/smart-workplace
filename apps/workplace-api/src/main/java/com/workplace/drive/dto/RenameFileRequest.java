package com.workplace.drive.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * 드라이브 파일 이름 변경 요청(WP-335). 경로 구분자(/, \)는 막는다 — 폴더 ZIP 다운로드가 이름을 엔트리 경로로 이어 붙이므로 끼어들면 폴더 구조가 깨진다.
 */
public record RenameFileRequest(
    @NotBlank
        @Size(max = 255)
        @Pattern(regexp = "^[^/\\\\]*$", message = "파일 이름에 / 나 \\ 는 쓸 수 없습니다.")
        String name) {}
