package com.workplace.drive.dto;

import com.workplace.global.util.SingleLineTitles;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** 드라이브 파일 이름 변경 요청(WP-335). 금지 문자·"."/".." 검사는 앞뒤 공백을 지운 뒤 DriveFileService 가 한곳에서 한다. */
public record RenameFileRequest(
    @NotBlank(message = "파일 이름을 입력해 주세요") @Size(max = 255) String name) {
  public RenameFileRequest {
    // 이름은 한 줄로 다듬는다 — 제로폭 문자만 있는 이름이 그대로 저장돼 빈 이름처럼 보였다(WP-671, WP-628 후속). 다듬어 비면 위 검증이 한국어로 거절한다
    name = SingleLineTitles.normalize(name);
  }
}
