package com.workplace.global.outbound;

import com.workplace.global.json.JsonMappers;
import java.time.Instant;
import java.util.Optional;
import org.springframework.web.client.HttpStatusCodeException;
import tools.jackson.databind.JsonNode;

/**
 * ai-agent 가 비서 사용 한도 때문에 실패했음을 알리는 신호(503 + {@code reason=PROVIDER_LIMIT}, WP-2108)를 읽는다. 한도 대기를
 * 거는 auth 쪽과 장애 판정을 하는 global·mail 쪽이 같은 파싱을 쓰도록 global 에 둔다 — global 이 auth 를 import 하는 역의존을 없애려고.
 */
public final class ProviderLimitSignal {

  /** ai-agent 가 한도 때문에 실패했음을 알리는 reason 값(503 본문·SSE error 공통). */
  public static final String REASON = "PROVIDER_LIMIT";

  /** 한도 감지 결과 — 풀리는 시각(모르면 null). */
  public record Hit(Instant resetsAt) {}

  private ProviderLimitSignal() {}

  /**
   * 원인 체인에서 상태 503 인 {@link HttpStatusCodeException} 의 본문을 읽어 PROVIDER_LIMIT 이면 감지 결과를 돌려준다. 래핑
   * 예외(예: MailAiUnavailableException)도 원인을 따라간다.
   */
  public static Optional<Hit> detect(Throwable error) {
    int depth = 0;
    for (Throwable t = error; t != null && depth < 10; t = t.getCause(), depth++) {
      if (t instanceof HttpStatusCodeException h && h.getStatusCode().value() == 503) {
        Optional<Hit> hit = fromJson(h.getResponseBodyAsString());
        if (hit.isPresent()) return hit;
      }
    }
    return Optional.empty();
  }

  /** 본문 JSON 이 reason == PROVIDER_LIMIT 일 때만 감지로 본다. resetsAt 을 못 읽으면 null(서비스가 기본 대기를 쓴다). */
  public static Optional<Hit> fromJson(String body) {
    if (body == null || body.isBlank()) return Optional.empty();
    try {
      JsonNode n = JsonMappers.JACKSON2.readTree(body);
      if (n == null || !n.isObject()) return Optional.empty();
      JsonNode reason = n.get("reason");
      if (reason == null || !reason.isString() || !REASON.equals(reason.asString())) {
        return Optional.empty();
      }
      JsonNode r = n.get("resetsAt");
      return Optional.of(new Hit(r != null && r.isString() ? parseInstant(r.asString()) : null));
    } catch (RuntimeException e) {
      // JSON 이 아니면 한도 신호가 아니다.
      return Optional.empty();
    }
  }

  /** ISO-8601 시각 문자열 → Instant. 비었거나 읽을 수 없으면 null. */
  public static Instant parseInstant(String iso) {
    if (iso == null || iso.isBlank()) return null;
    try {
      return Instant.parse(iso.trim());
    } catch (RuntimeException e) {
      return null;
    }
  }
}
