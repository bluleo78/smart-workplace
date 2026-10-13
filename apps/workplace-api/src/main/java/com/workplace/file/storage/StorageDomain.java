package com.workplace.file.storage;

/** 파일 저장 도메인 — 경로 두 번째 세그먼트({root}/tenant-{id}/{domain}/...)를 결정한다. */
public enum StorageDomain {
  FILES("files"), // 범용 파일 코어(/api/v1/files) + 드라이브 공유
  ISSUE("issue"),
  CHAT("chat"),
  MESSAGING("messaging"),
  MAIL("mail"),
  // WP-358 메일 첨부 텍스트 추출용 평문 사본(만료 TTL). "mail" 세그먼트와 반드시 분리 — MailAttachmentBlobGcSweeper 의 고아 파일
  // 백스톱이 tenant-{id}/mail 아래에서 mail_attachment_blob 에 없는 파일을 1시간 뒤 지운다.
  MAIL_EXTRACT("mail-extract"),
  WIKI("wiki"), // 노트 본문 이미지 첨부
  HOME("home"); // 메인 AI 채팅 첨부(WP-234)

  private final String segment;

  StorageDomain(String segment) {
    this.segment = segment;
  }

  /** 경로 세그먼트 문자열. */
  public String segment() {
    return segment;
  }
}
