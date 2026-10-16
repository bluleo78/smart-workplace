package com.workplace.mail.repository;

import com.workplace.file.storage.StorageDomain;

/**
 * 메일 첨부 미리보기 상태 행의 키 — 같은 테넌트의 같은 첨부 바이트(sha256)는 메일·사용자가 달라도 한 행이다(WP-432).
 *
 * @param tenantId 테넌트 id
 * @param contentHash 첨부 평문 바이트의 sha256 hex({@code content_attachment.content_hash})
 */
public record MailPreviewKey(long tenantId, String contentHash) {

  /**
   * 변환 PDF(암호화)의 저장 루트 기준 상대 경로 — 결정적 경로 규칙의 유일한 정의다.
   *
   * <p>{@code tenant-{tid}/mail-preview/{hash 앞2}/{hash}.enc}. "mail" 세그먼트 아래에 두면 고아 파일 스윕이 지우므로 별도
   * 세그먼트를 쓴다.
   */
  public String previewRef() {
    return "tenant-"
        + tenantId
        + "/"
        + StorageDomain.MAIL_PREVIEW.segment()
        + "/"
        + contentHash.substring(0, 2)
        + "/"
        + contentHash
        + ".enc";
  }
}
