package com.workplace.wiki.exception;

/** 업로드가 거부됐을 때(빈 파일·크기 초과·이미지 형식 아님) — HTTP 400 매핑. */
public class WikiAttachmentRejectedException extends RuntimeException {

  public WikiAttachmentRejectedException(String message) {
    super(message);
  }
}
