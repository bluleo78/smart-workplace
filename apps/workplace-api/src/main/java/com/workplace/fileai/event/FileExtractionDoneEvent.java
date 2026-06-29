package com.workplace.fileai.event;

/**
 * 파일 추출+요약이 DONE 으로 저장된 직후 발행.
 *
 * <p>임베딩 nudge 트리거. markSummarized 트랜잭션 내에서 publishEvent 하여 AFTER_COMMIT 리스너가 정상 발화하도록 한다.
 *
 * @param fileId 대상 파일 ID
 * @param tenantId 테넌트 ID — 리스너가 TenantContext.set 으로 GUC 복원에 사용
 */
public record FileExtractionDoneEvent(long fileId, long tenantId) {}
