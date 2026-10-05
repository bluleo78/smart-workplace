package com.workplace.fileai.inbound;

import com.workplace.fileai.ExtractionProfile;
import com.workplace.global.tenant.TenantContext;

/**
 * 도메인 중립 "파일 텍스트 추출 요청" 이벤트(WP-242). 드라이브·이슈 첨부·이슈 챗 첨부가 파일이 영구가 되는 시점에 발행한다.
 *
 * <p>반드시 트랜잭션 안에서 발행해야 한다 — fileai 리스너가 같은 트랜잭션에서 file_extraction 행을 만들고(원자성), 커밋 후 워커로 디스패치한다.
 * storageKey 는 싣지 않는다(디스패치가 file 테이블에서 직접 조회).
 *
 * @param fileId 코어 file.id
 * @param tenantId 행의 tenant_id
 * @param mime 정규화된 mime — 추출 가능 판정({@link com.workplace.fileai.ExtractableTypes})
 * @param profile 추출 이후 처리 범위
 */
public record FileExtractionRequestedEvent(
    long fileId, long tenantId, String mime, ExtractionProfile profile) {

  /**
   * 현재 요청의 TenantContext 로 이벤트를 만든다 — 세 발행처(드라이브·이슈 첨부·챗 첨부)의 테넌트 폴백 중복을 한곳에 모은다.
   *
   * <p>TenantContext 가 비어 있으면 0L 로 채운다. 언박싱 NPE 로 업로드·전송이 실패하지 않게 하려는 가드이며, 컨텍스트가 없으면 RLS 로 file 행
   * insert 가 먼저 실패하므로 0L 이 실제로 쓰이는 일은 없다(기존 동작 유지).
   */
  public static FileExtractionRequestedEvent of(
      long fileId, String mime, ExtractionProfile profile) {
    Long tenantId = TenantContext.get();
    return new FileExtractionRequestedEvent(
        fileId, tenantId != null ? tenantId : 0L, mime, profile);
  }
}
