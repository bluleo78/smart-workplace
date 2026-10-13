package com.workplace.drive.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * 업로드 전송 링크 발급 요청(WP-369).
 *
 * @param folderId 올릴 폴더(없으면 공간 루트). 같은 공간의 폴더여야 한다
 * @param name 만들 파일 이름 — 같은 이름의 활성 파일이 있으면 새 버전으로 들어간다. 경로 구분자·제어 문자는 "_" 로 정리된다
 */
public record CreateUploadLinkRequest(Long folderId, @NotBlank @Size(max = 255) String name) {}
