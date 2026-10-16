package com.workplace.filepreview.inbound;

import com.workplace.global.tenant.TenantContext;

/**
 * 드라이브 문서 미리 변환 요청 이벤트(WP-431). 드라이브 업로드·새 버전(업로드 핵심 경로 한 곳)만 발행한다.
 *
 * <p>추출 이벤트({@code FileExtractionRequestedEvent})를 재사용하지 않는 이유: 그 이벤트는 이슈·채팅 첨부도 발행하는데, 미리보기는 드라이브
 * 전용 범위라 첨부까지 변환하면 안 된다. 리스너는 커밋 후(AFTER_COMMIT) 백그라운드 실행기에 넘기기만 한다.
 *
 * @param fileId 코어 file.id
 * @param tenantId 행의 tenant_id — 실행기 스레드에서 RLS 컨텍스트를 세우는 데 쓴다
 * @param mime 정규화된 file.mime_type
 * @param originalName 원본 파일명 — mime 이 범용(octet-stream)이어도 확장자로 대상 형식을 고르게 함께 싣는다
 */
public record FilePreviewRequestedEvent(
    long fileId, long tenantId, String mime, String originalName) {

  /**
   * 현재 요청의 TenantContext 로 이벤트를 만든다 — {@code FileExtractionRequestedEvent.of} 와 같은 규칙(컨텍스트가 비면 0L,
   * 그 경우 file insert 가 RLS 로 먼저 실패하므로 실제로 쓰이지 않는다).
   */
  public static FilePreviewRequestedEvent of(long fileId, String mime, String originalName) {
    Long tenantId = TenantContext.get();
    return new FilePreviewRequestedEvent(
        fileId, tenantId != null ? tenantId : 0L, mime, originalName);
  }
}
