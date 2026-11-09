package com.workplace.agentaccount.usage;

import com.workplace.auth.service.AgentProviders;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.MediaType;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

/**
 * Claude(setup-token) 사용량 조회기. /v1/messages 에 최소 호출(max_tokens=1)을 보내고 응답의
 * anthropic-ratelimit-unified-* 헤더를 읽는다(/api/oauth/usage 는 setup-token 에 403 이라 쓰지 않는다). 2xx 와 429
 * 만 헤더가 있으면 성공 판독이다 — 429 는 한도 도달. 그 밖의 상태는 HTTP_<코드> 실패.
 */
public class ClaudeUsageProbe implements UsageProbe {

  private static final String PREFIX = "anthropic-ratelimit-unified-";

  private final RestClient client;
  private final AgentAccountUsageProperties props;

  public ClaudeUsageProbe(RestClient client, AgentAccountUsageProperties props) {
    this.client = client;
    this.props = props;
  }

  @Override
  public String provider() {
    return AgentProviders.ANTHROPIC;
  }

  /** 응답 상태·헤더를 받아 해석한다. 토큰은 요청 헤더에만 쓰고 예외·로그에는 싣지 않는다. */
  @Override
  public UsageReading read(String plaintextSecret) throws UsageProbeException {
    Map<String, Object> body =
        Map.of(
            "model",
            props.claudeModel(),
            "max_tokens",
            1,
            "system",
            "You are Claude Code, Anthropic's official CLI for Claude.",
            "messages",
            List.of(Map.of("role", "user", "content", ".")));
    Raw raw;
    try {
      raw =
          client
              .post()
              .uri("/v1/messages")
              .header(HttpHeaders.AUTHORIZATION, "Bearer " + plaintextSecret)
              .header("anthropic-version", "2023-06-01")
              .header("anthropic-beta", "oauth-2025-04-20")
              .contentType(MediaType.APPLICATION_JSON)
              .body(body)
              .exchange((req, res) -> new Raw(res.getStatusCode(), res.getHeaders()));
    } catch (RestClientException | IllegalArgumentException e) {
      // 원인 예외는 URL 등을 담을 수 있어 버리고 코드만 남긴다.
      throw new UsageProbeException("NETWORK", "연결 실패");
    }
    int status = raw.status().value();
    if (status == 401 || status == 403) {
      throw new UsageProbeException("UNAUTHORIZED", "토큰이 거절됨");
    }
    // 성공 판독은 2xx 와 429(한도 도달)만 — 400(폐기된 모델)·5xx 등은 헤더가 붙어 와도 실패로 다뤄
    // 기존 실패 이유가 「정상」으로 덮이지 않게 한다.
    if (!(status >= 200 && status < 300) && status != 429) {
      throw new UsageProbeException("HTTP_" + status, "응답 오류(" + status + ")");
    }
    Instant now = Instant.now();
    List<UsageSnapshot> windows = new ArrayList<>();
    boolean rejected = status == 429;
    String overall = raw.headers().getFirst(PREFIX + "status");
    for (UsageWindow w : UsageWindow.values()) {
      String util = raw.headers().getFirst(PREFIX + w.key() + "-utilization");
      if (util == null) continue;
      BigDecimal percent;
      try {
        percent = new BigDecimal(util.trim()).movePointRight(2).setScale(2, RoundingMode.HALF_UP);
      } catch (NumberFormatException e) {
        continue;
      }
      String winStatus = raw.headers().getFirst(PREFIX + w.key() + "-status");
      String limitStatus = winStatus != null ? winStatus : overall;
      if ("rejected".equalsIgnoreCase(limitStatus)) rejected = true;
      windows.add(
          new UsageSnapshot(
              w,
              percent,
              epoch(raw.headers().getFirst(PREFIX + w.key() + "-reset")),
              limitStatus,
              now));
    }
    if (windows.isEmpty()) {
      throw new UsageProbeException("BAD_RESPONSE", "사용량 헤더가 없음");
    }
    return new UsageReading(List.copyOf(windows), rejected);
  }

  /** epoch 초 문자열 → Instant. 없거나 숫자가 아니면 null. */
  private static Instant epoch(String s) {
    if (s == null) return null;
    try {
      return Instant.ofEpochSecond(Long.parseLong(s.trim()));
    } catch (NumberFormatException e) {
      return null;
    }
  }

  /** 응답에서 필요한 부분(상태·헤더)만 본문 소비 없이 꺼낸 값. */
  private record Raw(HttpStatusCode status, HttpHeaders headers) {}
}
