package com.workplace.global.outbound;

import com.workplace.global.tenant.TenantContext;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.MediaType;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.HttpServerErrorException;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;

/**
 * ai-agent 의 POST /events 로 envelope 을 전송한다.
 *
 * <ul>
 *   <li>인증: Authorization: Internal {token}
 *   <li>재시도: 시도 1 + 재시도 3회 = 최대 4회, 백오프 baseBackoffMs * 2^(n-1)
 *   <li>재시도 대상: IO 에러, 5xx, 408, 429. 그 외 4xx 는 즉시 포기.
 *   <li>모두 실패 시 에러 로그만 남기고 도메인으로 예외 propagate 하지 않음.
 * </ul>
 */
@Slf4j
public class AiAgentEventClient {

  /** 테넌트를 ai-agent 의 AI 처리 기록에 전달하는 헤더 이름 (WP-1828). */
  public static final String AI_RUN_HEADER = "X-AI-Run";

  /** 시도 횟수 (초회 + 재시도). */
  private static final int MAX_ATTEMPTS = 4;

  private final RestClient restClient;
  private final String internalToken;
  private final long baseBackoffMs;

  public AiAgentEventClient(RestClient.Builder builder, String internalToken, long baseBackoffMs) {
    this.restClient = builder.build();
    this.internalToken = internalToken;
    this.baseBackoffMs = baseBackoffMs;
  }

  /** envelope 을 발사. 도메인으로 예외를 던지지 않는다. */
  public void publish(EventEnvelope envelope) {
    Exception lastError = null;
    String aiRun = aiRunHeaderValue();
    for (int attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        RestClient.RequestBodySpec request =
            restClient
                .post()
                .uri("/events")
                .header("Authorization", "Internal " + internalToken)
                .contentType(MediaType.APPLICATION_JSON);
        // 테넌트 맥락이 있을 때만 싣는다 — ai-agent 가 이벤트로 시작한 AI 처리 기록에 테넌트를 채운다.
        if (aiRun != null) {
          request.header(AI_RUN_HEADER, aiRun);
        }
        request.body(envelope).retrieve().toBodilessEntity();
        return; // 성공
      } catch (HttpClientErrorException e) {
        HttpStatusCode status = e.getStatusCode();
        if (!isRetryableClientStatus(status)) {
          log.error(
              "ai-agent dispatch failed (4xx, no retry): type={}, status={}, body={}",
              envelope.type(),
              status,
              e.getResponseBodyAsString());
          return;
        }
        lastError = e;
      } catch (HttpServerErrorException | ResourceAccessException e) {
        lastError = e;
      }
      if (attempt < MAX_ATTEMPTS) {
        sleepBackoff(attempt);
      }
    }
    log.error(
        "ai-agent dispatch failed after {} attempts: type={}, lastError={}",
        MAX_ATTEMPTS,
        envelope.type(),
        lastError == null ? "unknown" : lastError.getMessage());
  }

  /**
   * X-AI-Run 값: {"tenantId":N} 을 base64url(패딩 없음)로 인코딩. 테넌트 맥락이 없으면 null. 숫자 하나뿐이라 JSON 라이브러리 없이 직접
   * 만든다.
   */
  private String aiRunHeaderValue() {
    Long tenantId = TenantContext.get();
    if (tenantId == null) {
      return null;
    }
    String json = "{\"tenantId\":" + tenantId + "}";
    return Base64.getUrlEncoder()
        .withoutPadding()
        .encodeToString(json.getBytes(StandardCharsets.UTF_8));
  }

  /** 4xx 중 재시도 가능한 코드 (408, 429). */
  private boolean isRetryableClientStatus(HttpStatusCode status) {
    int code = status.value();
    return code == 408 || code == 429;
  }

  /** 지수 백오프: baseBackoffMs * 2^(attempt-1). */
  private void sleepBackoff(int attempt) {
    long delay = baseBackoffMs * (1L << (attempt - 1));
    try {
      Thread.sleep(delay);
    } catch (InterruptedException ie) {
      Thread.currentThread().interrupt();
    }
  }
}
