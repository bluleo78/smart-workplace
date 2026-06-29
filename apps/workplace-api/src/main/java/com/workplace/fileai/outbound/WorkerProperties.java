package com.workplace.fileai.outbound;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 워커 서비스 연결 설정. workplace.worker 키로 바인딩.
 *
 * <ul>
 *   <li>baseUrl: 워커 서버 base URL (예: http://localhost:7080)
 *   <li>internalToken: 사내 서비스 인증 — Authorization: Internal {token}
 *   <li>enabled: 전역 on/off. 테스트 기본 false.
 *   <li>embed: 임베딩 모델 설정 — 모델명·차원·최대 텍스트 길이.
 * </ul>
 *
 * @ConfigurationPropertiesScan 이 WorkplaceApplication 에 선언돼 있으므로 별도 @EnableConfigurationProperties
 * 불필요.
 */
@ConfigurationProperties("workplace.worker")
public record WorkerProperties(String baseUrl, String internalToken, boolean enabled, Embed embed) {

  /**
   * 임베딩 설정(설정 가능 모델). dimensions 는 마이그레이션 vector(N) 와 일치해야 한다.
   *
   * @param model 임베딩 모델명 (예: BAAI/bge-m3)
   * @param dimensions 벡터 차원 수 — DB 컬럼 vector(N) 과 반드시 일치
   * @param maxChars 임베딩 전 텍스트 최대 길이 (초과분 잘림)
   */
  public record Embed(String model, int dimensions, int maxChars) {}
}
