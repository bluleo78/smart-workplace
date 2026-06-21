// AttachmentSourceProvider.java — 가상 첨부 뷰 SPI (직접 업로드 첨부 노출)
package com.workplace.drive.api;

import java.time.Instant;
import java.util.List;

/** 내가 접근 가능한 이슈/메시지의 "직접 업로드" 첨부를 제공. 각 도메인이 구현. */
public interface AttachmentSourceProvider {
  String sourceType(); // "ISSUE" | "MESSAGE"

  /**
   * callerId 가 접근 가능한 첨부를 attachedAt desc 로 limit+1 개까지(다음 페이지 판단용).
   *
   * @param q 파일명 부분일치(null=전체), beforeAt 커서(null=최신부터)
   */
  List<Entry> list(long callerId, String q, Instant beforeAt, int limit);

  /**
   * callerId 가 fileId 에 접근할 수 있는지 확인. 해당 파일이 caller 가 접근 가능한 소스(이슈/메시지)에 첨부된 경우 true.
   * importAttachment 인가 검증용.
   */
  boolean canAccessFile(long callerId, long fileId);

  record Entry(
      long fileId,
      String name,
      String mimeType,
      long sizeBytes,
      boolean hasThumbnail,
      String sourceLabel,
      String deepLink,
      String downloadUrl,
      Instant attachedAt) {}
}
