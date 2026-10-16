package com.workplace.file.exception;

import org.springframework.http.HttpStatus;

/**
 * 스테이징 업로드 링크(WP-421)를 쓸 때 다시 확인한 발급자가 더 이상 워크스페이스 ACTIVE 멤버가 아님(멤버십 정지·탈퇴). → 403
 *
 * <p>링크는 이미 소비됐으므로 문구가 "새 링크를 발급받으세요"로 끝난다.
 */
public class StagedUploadLinkForbiddenException extends StagedUploadRejectedException {
  public StagedUploadLinkForbiddenException() {
    super(HttpStatus.FORBIDDEN, "링크를 발급한 사용자가 더 이상 이 워크스페이스에 파일을 올릴 수 없습니다. 새 링크를 발급받으세요");
  }
}
