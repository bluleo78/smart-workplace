package com.workplace.file.exception;

import org.springframework.http.HttpStatus;

/**
 * 스테이징 업로드 링크(WP-421)의 토큰이 없거나 잘못됐거나(다른 종류 접두사 포함), 테넌트가 비활성임. → 404
 *
 * <p>공개 경로라 메시지에 식별자(id)를 넣지 않고, 링크 소지자가 할 일("새 링크를 발급받으세요")을 안내한다.
 */
public class StagedUploadLinkNotFoundException extends StagedUploadRejectedException {
  public StagedUploadLinkNotFoundException() {
    super(HttpStatus.NOT_FOUND, "업로드 링크를 찾을 수 없습니다. 새 링크를 발급받으세요");
  }
}
