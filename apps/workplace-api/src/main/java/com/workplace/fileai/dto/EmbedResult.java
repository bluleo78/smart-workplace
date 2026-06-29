package com.workplace.fileai.dto;

/**
 * 워커 임베딩 콜백 본문.
 *
 * <p>tenantId echo 로 RLS 컨텍스트 복원(C1 패턴). 실패 시 error 만 채워진다.
 *
 * @param tenantId 디스패치 시 워커에 전달한 테넌트 ID 를 그대로 에코 — 콜백 컨트롤러가 TenantContext 복원에 사용
 * @param dimensions 임베딩 벡터 차원 수 (모델 검증용)
 * @param embedding 임베딩 벡터 값 배열 (실패 시 null)
 * @param error 오류 메시지 (성공 시 null)
 */
public record EmbedResult(Long tenantId, Integer dimensions, float[] embedding, String error) {}
