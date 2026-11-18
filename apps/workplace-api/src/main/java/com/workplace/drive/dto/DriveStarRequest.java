package com.workplace.drive.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;

/**
 * 별표 넣기·빼기 요청(PUT·DELETE /api/v1/drive/stars, WP-1698) — 대상 항목 하나.
 *
 * @param kind 항목 종류. FILE 또는 FOLDER — 빠지거나 다른 값이면 400
 * @param id 드라이브 파일 id 또는 폴더 id(kind 에 맞는 id 여야 한다 — 어긋나면 없는 항목과 같은 404)
 */
public record DriveStarRequest(
    @NotBlank(message = "항목 종류(kind)를 입력해 주세요")
        @Pattern(regexp = "FILE|FOLDER", message = "항목 종류(kind)는 FILE 또는 FOLDER 입니다")
        String kind,
    @NotNull(message = "항목 id 를 입력해 주세요") Long id) {

  /** 폴더 대상인지 — 검증을 통과한 뒤에만 부른다(kind 는 FILE·FOLDER 중 하나). */
  public boolean folder() {
    return "FOLDER".equals(kind);
  }
}
