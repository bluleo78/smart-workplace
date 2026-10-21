package com.workplace.issue.exception;

/** 이슈 첨부 매핑(또는 file row) 이 존재하지 않을 때 — HTTP 404 매핑. */
public class AttachmentNotFoundException extends RuntimeException {

  /** fileId 기반 메시지. 매핑 row 또는 file row 둘 중 어느 한쪽이라도 없으면 던진다. */
  public AttachmentNotFoundException(Long fileId) {
    // 문구에 id·영문 값을 넣지 않는다 — 응답 message 로 그대로 나가 화면·AI 에 내부 번호가 보였다(WP-672, WP-619 후속)
    super("첨부를 찾을 수 없습니다");
  }
}
