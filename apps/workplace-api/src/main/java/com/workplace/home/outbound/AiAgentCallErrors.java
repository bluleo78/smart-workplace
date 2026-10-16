package com.workplace.home.outbound;

import com.workplace.home.exception.MemoryCleanupAiException;
import org.slf4j.Logger;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.RestClientException;

/**
 * ai-agent 동기 호출 클라이언트(메모리 정리 WP-385·공용 메모리 WP-386)가 함께 쓰는 오류 번역. HTTP 오류·연결 실패·시간 초과를 {@link
 * MemoryCleanupAiException} 으로 감싸고 로그를 남긴다 — 호출부가 {@code isAgentDown()}·{@code isReadTimeout()} 으로
 * 일시 장애와 그 요청만의 실패를 가른다.
 */
final class AiAgentCallErrors {

  private AiAgentCallErrors() {}

  /**
   * 예외를 번역해 돌려준다(던지는 것은 호출부).
   *
   * <p>503(재기동 등)·404(경로가 아직 없는 구 ai-agent)는 일시 불가라 WARN, 그 밖의 상태는 요청 자체의 문제라 ERROR 다.
   *
   * @param label 로그에 쓸 호출 이름(예: "memory cleanup")
   * @param failMessage 예외 메시지
   * @param logDetail true 면 응답 본문·예외 메시지를 로그에 싣는다. 요청에 사람이 한 말(발화·후보 문장)이 들어가는 호출은 false — 상태와 예외
   *     종류만 남긴다.
   */
  static MemoryCleanupAiException translate(
      Logger log, String label, String failMessage, RestClientException e, boolean logDetail) {
    if (e instanceof HttpStatusCodeException h) {
      int status = h.getStatusCode().value();
      boolean unavailable = status == 503 || status == 404;
      if (logDetail) {
        if (unavailable) {
          log.warn("ai-agent {} 불가({}): {}", label, status, h.getResponseBodyAsString());
        } else {
          log.error(
              "ai-agent {} 실패: status={} body={}",
              label,
              h.getStatusCode(),
              h.getResponseBodyAsString());
        }
      } else if (unavailable) {
        log.warn("ai-agent {} 불가({})", label, status);
      } else {
        log.error("ai-agent {} 실패: status={}", label, h.getStatusCode());
      }
    } else if (logDetail) {
      log.warn("ai-agent {} 실패: {}", label, e.getMessage());
    } else {
      log.warn("ai-agent {} 실패: {}", label, e.getClass().getSimpleName());
    }
    return new MemoryCleanupAiException(failMessage, e);
  }
}
