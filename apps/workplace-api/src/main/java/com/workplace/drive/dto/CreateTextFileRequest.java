package com.workplace.drive.dto;

import com.workplace.global.util.SingleLineTitles;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * 텍스트로 드라이브 파일 만들기 요청(WP-369). AI·MCP 가 쓴 내용을 UTF-8 로 저장한다. 크기(10MB)·MIME 허용 목록은 DriveFileService 가
 * 검사한다.
 *
 * @param folderId 대상 폴더(없으면 공간 루트). 같은 공간의 폴더여야 한다
 * @param name 파일 이름(확장자로 MIME 을 정한다). 경로 구분자·제어 문자는 "_" 로 정리된다
 * @param content 파일 내용(빈 문자열 허용)
 * @param mimeType 선택 — text/markdown·text/plain·text/csv·application/json 만
 */
public record CreateTextFileRequest(
    Long folderId,
    @NotBlank(message = "파일 이름을 입력해 주세요") @Size(max = 255) String name,
    @NotNull String content,
    @Size(max = 100) String mimeType) {
  public CreateTextFileRequest {
    // 이름은 한 줄로 다듬는다 — 제로폭 문자만 있는 이름이 그대로 저장돼 빈 이름처럼 보였다(WP-671, WP-628 후속). 다듬어 비면 위 검증이 한국어로 거절한다
    name = SingleLineTitles.normalize(name);
  }
}
