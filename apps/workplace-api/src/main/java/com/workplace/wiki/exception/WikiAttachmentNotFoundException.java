package com.workplace.wiki.exception;

/** 노트 이미지 첨부(file row) 가 존재하지 않을 때 — HTTP 404 매핑. */
public class WikiAttachmentNotFoundException extends RuntimeException {

  public WikiAttachmentNotFoundException(Long fileId) {
    super("첨부를 찾을 수 없습니다: fileId=" + fileId);
  }
}
