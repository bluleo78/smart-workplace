package com.workplace.file.storage;

/** 파일 저장 도메인 — 경로 두 번째 세그먼트({root}/tenant-{id}/{domain}/...)를 결정한다. */
public enum StorageDomain {
  FILES("files"), // 범용 파일 코어(/api/v1/files) + 드라이브 공유
  ISSUE("issue"),
  CHAT("chat"),
  MESSAGING("messaging"),
  MAIL("mail");

  private final String segment;

  StorageDomain(String segment) {
    this.segment = segment;
  }

  /** 경로 세그먼트 문자열. */
  public String segment() {
    return segment;
  }
}
