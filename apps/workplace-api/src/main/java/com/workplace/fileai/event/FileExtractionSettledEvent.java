package com.workplace.fileai.event;

/**
 * 워커 추출 결과가 확정된 직후 발행(WP-358) — 텍스트가 저장됐거나(TEXT_READY/DONE) 추출할 수 없다고(SKIPPED) 판정된 시점.
 *
 * <p>이 시점 이후로는 워커가 원본 바이너리를 다시 읽지 않는다(재디스패치는 PENDING·lease 만료 EXTRACTING 만 대상). 그래서 추출 전용 임시 사본(메일
 * 첨부 평문 사본 등)을 가진 도메인이 바이너리를 즉시 지우는 신호로 쓴다. {@link FileExtractionDoneEvent} 는 요약까지 끝난 FULL 프로파일에서만
 * 나오므로 TEXT_ONLY 첨부에는 오지 않는다.
 *
 * <p>applyExtractResult 트랜잭션 안에서 발행하므로 AFTER_COMMIT 리스너는 상태 전이가 커밋된 뒤에만 발화한다.
 *
 * @param fileId 대상 파일 ID
 * @param tenantId 테넌트 ID — 리스너가 TenantContext 복원(RLS GUC)에 쓴다
 */
public record FileExtractionSettledEvent(long fileId, long tenantId) {}
