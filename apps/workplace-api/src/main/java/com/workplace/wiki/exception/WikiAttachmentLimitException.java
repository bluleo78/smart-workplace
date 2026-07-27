package com.workplace.wiki.exception;

/** 페이지당 첨부 개수 한도를 초과했을 때 — HTTP 409 매핑. */
public class WikiAttachmentLimitException extends RuntimeException {

  public WikiAttachmentLimitException(long pageId, int limit) {
    super("페이지당 첨부 한도 초과: pageId=" + pageId + " limit=" + limit);
  }
}
