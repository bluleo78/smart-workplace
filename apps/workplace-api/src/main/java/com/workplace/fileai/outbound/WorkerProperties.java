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
 *   <li>render: 첨부를 모델 입력용 이미지로 그리는 /render 설정 — 긴 변 픽셀·요청 타임아웃(WP-250).
 * </ul>
 *
 * @ConfigurationPropertiesScan 이 WorkplaceApplication 에 선언돼 있으므로 별도 @EnableConfigurationProperties
 * 불필요.
 */
@ConfigurationProperties("workplace.worker")
public record WorkerProperties(
    String baseUrl, String internalToken, boolean enabled, Embed embed, Render render) {

  /**
   * 임베딩 설정(설정 가능 모델). dimensions 는 마이그레이션 vector(N) 와 일치해야 한다.
   *
   * @param model 임베딩 모델명 (예: BAAI/bge-m3)
   * @param dimensions 벡터 차원 수 — DB 컬럼 vector(N) 과 반드시 일치
   * @param maxChars 임베딩 전 텍스트 최대 길이 (초과분 잘림)
   * @param enabled 임베딩 생성·검색 활성화 여부. false 면 임베딩 미생성 + 검색 키워드 전용 강등(추출은 무영향).
   */
  public record Embed(String model, int dimensions, int maxChars, boolean enabled) {}

  /**
   * 페이지·이미지 렌더 설정(WP-250). maxEdge 는 캐시 파일 이름에도 들어가므로 바꾸면 다음 요청부터 새로 그린다.
   *
   * @param maxEdge 결과 이미지 긴 변 픽셀 — 기본 1568(모델 이미지 입력 권장 상한). 워커가 64~4096 만 받는다.
   * @param timeoutSeconds /render 요청 타임아웃(초) — 큰 PDF 한 쪽 래스터화 여유를 둔 기본 20.
   */
  public record Render(int maxEdge, int timeoutSeconds) {

    /** 워커 /render 가 받는 긴 변 범위 — 밖이면 모든 요청이 워커 검증(422)에서 막히므로 기동 때 바로 실패시킨다. */
    public static final int MIN_EDGE = 64;

    public static final int MAX_EDGE = 4096;

    public Render {
      if (maxEdge < MIN_EDGE || maxEdge > MAX_EDGE) {
        throw new IllegalArgumentException(
            "workplace.worker.render.max-edge 는 "
                + MIN_EDGE
                + "~"
                + MAX_EDGE
                + " 사이여야 합니다(워커 /render 범위): "
                + maxEdge);
      }
      if (timeoutSeconds < 1) {
        throw new IllegalArgumentException(
            "workplace.worker.render.timeout-seconds 는 1 이상이어야 합니다: " + timeoutSeconds);
      }
    }
  }
}
