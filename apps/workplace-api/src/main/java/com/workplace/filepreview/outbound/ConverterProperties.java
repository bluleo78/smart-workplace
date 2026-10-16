package com.workplace.filepreview.outbound;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 문서 변환 서비스(workplace-converter, WP-430) 연결·미리보기 설정(WP-431). {@code workplace.converter} 키로 바인딩한다.
 *
 * <p>{@code @ConfigurationPropertiesScan} 이 WorkplaceApplication 에 있어 별도 등록 불필요.
 *
 * @param baseUrl 변환 서비스 base URL(예: http://localhost:6085)
 * @param internalToken 내부 서비스 토큰 — {@code Authorization: Internal {token}}(워커와 같은 값)
 * @param enabled 전역 on/off. 꺼져 있으면 미리보기 대상이 아닌 것처럼 다룬다(테스트 기본 false)
 * @param timeoutSeconds 요청 한 번의 응답 타임아웃(초) — 변환 상한 60초 + 여유
 * @param maxBytes 원본 크기 상한(바이트). 넘으면 호출 없이 TOO_LARGE
 * @param busyRetries 429 BUSY 일 때 같은 작업 안에서 더 시도할 횟수
 * @param busyBackoffMs BUSY 재시도 대기 기본값 — n 번째 재시도는 {@code busyBackoffMs * n} 만큼 기다린다
 * @param preview 미리보기 상태 관리 설정
 */
@ConfigurationProperties("workplace.converter")
public record ConverterProperties(
    String baseUrl,
    String internalToken,
    boolean enabled,
    int timeoutSeconds,
    long maxBytes,
    int busyRetries,
    long busyBackoffMs,
    Preview preview) {

  /**
   * 기동 검증 — 한 작업이 쓸 수 있는 최악 시간이 리스보다 짧아야 한다. 아니면 변환 중인 행의 리스가 먼저 끝나 다른 요청이 같은 파일을 다시 선점해 이중 변환한다.
   *
   * <p>최악 시간 = 요청 (busyRetries+1)번 각각의 타임아웃 + BUSY 대기 합(n 번째 재시도는 {@code busyBackoffMs * n} 이라
   * {@code busyBackoffMs * R(R+1)/2}). 재시도마다 새 요청이 타임아웃 전체를 쓸 수 있으므로 타임아웃도 시도 수만큼 곱한다.
   */
  public ConverterProperties {
    if (timeoutSeconds < 1) {
      throw new IllegalArgumentException(
          "workplace.converter.timeout-seconds 는 1 이상이어야 합니다: " + timeoutSeconds);
    }
    if (busyRetries < 0 || busyBackoffMs < 0) {
      throw new IllegalArgumentException(
          "workplace.converter.busy-retries·busy-backoff-ms 는 0 이상이어야 합니다");
    }
    if (preview == null || preview.lease() == null) {
      throw new IllegalArgumentException("workplace.converter.preview.lease 가 필요합니다");
    }
    long budgetMs = worstCaseMs(timeoutSeconds, busyRetries, busyBackoffMs);
    if (budgetMs >= preview.lease().toMillis()) {
      throw new IllegalArgumentException(
          "workplace.converter 의 timeout-seconds·busy 재시도 합("
              + budgetMs
              + "ms)이 preview.lease("
              + preview.lease()
              + ")보다 짧아야 합니다");
    }
  }

  /** 한 변환 작업의 최악 소요 시간(ms) — 요청 (R+1)회 타임아웃 + BUSY 대기 합 {@code backoff * R(R+1)/2}. */
  static long worstCaseMs(int timeoutSeconds, int busyRetries, long busyBackoffMs) {
    return (busyRetries + 1L) * timeoutSeconds * 1000L
        + busyBackoffMs * busyRetries * (busyRetries + 1L) / 2;
  }

  /**
   * 미리보기 상태(file_preview) 관리 설정.
   *
   * @param engineVersion 변환 엔진 버전 — 바뀌면 영구 실패·이전 결과도 다시 변환한다
   * @param lease CONVERTING 선점 유효 시간 — 변환 중 API 가 죽어도 이 시간 뒤 다시 선점된다
   * @param maxAttempts 일시 실패 연속 재시도 상한 — 이 횟수를 다 쓰면 쿨다운이 지날 때까지 다시 시도하지 않는다
   * @param interactiveConcurrency 첫 열람(대화형) 실행기 동시 상한
   * @param backgroundConcurrency 업로드 후 백그라운드 실행기 동시 상한
   * @param transientCooldown 일시 실패가 상한에 닿은 뒤 다시 시도할 수 있게 되기까지의 대기(기본 10분) — 변환 서비스 장애가 지나간 뒤에도 영원히
   *     실패로 굳지 않게
   */
  public record Preview(
      String engineVersion,
      Duration lease,
      int maxAttempts,
      int interactiveConcurrency,
      int backgroundConcurrency,
      Duration transientCooldown) {

    /** 쿨다운 미설정이면 10분. */
    public Preview {
      if (transientCooldown == null) {
        transientCooldown = Duration.ofMinutes(10);
      }
    }
  }
}
