package com.workplace.file.exception;

import org.springframework.http.HttpStatus;

/** 스테이징 업로드 링크(WP-421)가 만료되었거나 이미 사용됨(일회용). → 410 Gone */
public class StagedUploadLinkGoneException extends StagedUploadRejectedException {
  public StagedUploadLinkGoneException() {
    super(HttpStatus.GONE, "업로드 링크가 만료되었거나 이미 사용되었습니다. 새 링크를 발급받으세요");
  }
}
