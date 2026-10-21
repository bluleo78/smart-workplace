package com.workplace.wiki.exception;

/** 노트 이미지 첨부(file row) 가 존재하지 않을 때 — HTTP 404 매핑. */
public class WikiAttachmentNotFoundException extends RuntimeException {

  public WikiAttachmentNotFoundException(Long fileId) {
    // 문구에 id·영문 값을 넣지 않는다 — 응답 message 로 그대로 나가 화면·AI 에 내부 번호가 보였다(WP-672, WP-619 후속)
    super("첨부를 찾을 수 없습니다");
  }
}
