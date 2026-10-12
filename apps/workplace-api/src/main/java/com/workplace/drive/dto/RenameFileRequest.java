package com.workplace.drive.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * 드라이브 파일 이름 변경 요청(WP-335). 경로 구분자(/, \)·"."·".."(앞뒤 공백은 서비스가 지우므로 공백 포함)·제어 문자는 막는다 — 폴더 ZIP 다운로드가
 * 이름을 엔트리 경로로 이어 붙여 구조가 깨지거나 경로를 벗어날 수 있고, 제어 문자(NUL·개행)는 DB 저장 실패나 다운로드 헤더 오염을 일으킨다.
 */
public record RenameFileRequest(
    @NotBlank
        @Size(max = 255)
        @Pattern(
            regexp = "^(?!\\s*\\.{1,2}\\s*$)[^/\\\\\\p{Cntrl}]*$",
            message = "파일 이름에 / \\ 나 제어 문자는 쓸 수 없고, . 이나 .. 만으로 지을 수 없습니다.")
        String name) {}
