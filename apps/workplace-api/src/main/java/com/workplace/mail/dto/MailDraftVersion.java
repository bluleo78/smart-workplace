package com.workplace.mail.dto;

import java.time.OffsetDateTime;

/**
 * 임시저장 수정 결과(WP-577) — 다음 수정에 넘길 새 버전과, 서버가 정한 첨부 개수(올린 파일 + 남은 전달 원본). 웹은 이 값으로 목록 행을 그 자리에서 고친다 —
 * 남의·없어진 전달 원본은 서버가 버리므로 요청 값으로 센 개수와 다를 수 있다.
 */
public record MailDraftVersion(int version, OffsetDateTime updatedAt, int attachmentCount) {

  /** 저장 직후(첨부를 반영하기 전) 버전 — 서비스가 첨부를 반영한 뒤 {@link #withAttachmentCount} 로 개수를 채운다. */
  public static MailDraftVersion of(int version, OffsetDateTime updatedAt) {
    return new MailDraftVersion(version, updatedAt, 0);
  }

  public MailDraftVersion withAttachmentCount(int count) {
    return new MailDraftVersion(version, updatedAt, count);
  }
}
