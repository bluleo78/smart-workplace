package com.workplace.drive.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * 기존 드라이브 파일을 텍스트 내용으로 갱신하는 요청(WP-369) — 그 파일에 새 버전을 더한다(이름·폴더는 그대로). 크기(10MB)·MIME 허용 목록·텍스트 계열
 * 여부는 DriveFileService 가 검사한다.
 *
 * @param content 새 내용(빈 문자열 허용). UTF-8 로 저장한다
 * @param mimeType 선택 — text/markdown·text/plain·text/csv·application/json 만. 없으면 파일 이름의 확장자로 정한다
 */
public record UpdateTextFileRequest(@NotNull String content, @Size(max = 100) String mimeType) {}
