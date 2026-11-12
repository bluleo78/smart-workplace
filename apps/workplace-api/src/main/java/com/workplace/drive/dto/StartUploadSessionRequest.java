package com.workplace.drive.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;

/**
 * 나눠 올리기 세션 시작 요청(WP-1520). 바이트를 받기 전에 권한·폴더·범주 한도·회사 용량을 먼저 본다.
 *
 * @param folderId 올릴 폴더(없으면 공간 루트). 같은 공간의 폴더여야 한다
 * @param fileName 원본 파일 이름 — 완료 때 일반 업로드와 같은 정리(경로 구분자·제어 문자 → "_")를 거친다
 * @param contentType 브라우저가 알려준 MIME(없으면 확장자로 정한다)
 * @param size 전체 바이트 수(0 보다 커야 한다)
 */
public record StartUploadSessionRequest(
    Long folderId,
    @NotBlank @Size(max = 1000) String fileName,
    @Size(max = 255) String contentType,
    @NotNull @Positive Long size) {}
