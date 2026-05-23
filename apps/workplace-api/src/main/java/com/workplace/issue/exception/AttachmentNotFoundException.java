package com.workplace.issue.exception;

/** 이슈 첨부 매핑(또는 file row) 이 존재하지 않을 때 — HTTP 404 매핑. */
public class AttachmentNotFoundException extends RuntimeException {

  /** fileId 기반 메시지. 매핑 row 또는 file row 둘 중 어느 한쪽이라도 없으면 던진다. */
  public AttachmentNotFoundException(Long fileId) {
    super("첨부를 찾을 수 없습니다: fileId=" + fileId);
  }
}
