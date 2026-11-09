package com.workplace.agentaccount.usage;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.auth.service.AgentProviders;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import org.springframework.http.HttpHeaders;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

/**
 * ChatGPT(Codex 로그인) 사용량 조회기. 비밀은 Codex auth.json 원문이며, tokens.access_token·account_id 로
 * /backend-api/wham/usage 를 GET 한다. 토큰은 새로 고치지 않는다(WP-1450) — 401 이면 TOKEN_EXPIRED.
 */
public class ChatgptUsageProbe implements UsageProbe {

  private static final ObjectMapper MAPPER = new ObjectMapper();

  private final RestClient client;

  public ChatgptUsageProbe(RestClient client) {
    this.client = client;
  }

  @Override
  public String provider() {
    return AgentProviders.CHATGPT;
  }

  @Override
  public UsageReading read(String plaintextSecret) throws UsageProbeException {
    // 1) auth.json 에서 토큰·계정 id 추출 — 깨졌으면 네트워크 호출 없이 BAD_SECRET.
    String accessToken;
    String accountId;
    try {
      JsonNode tokens = MAPPER.readTree(plaintextSecret).path("tokens");
      accessToken = tokens.path("access_token").asText("");
      accountId = tokens.path("account_id").asText("");
    } catch (Exception e) {
      throw new UsageProbeException("BAD_SECRET", "저장된 로그인 정보를 읽을 수 없음");
    }
    if (accessToken.isBlank() || accountId.isBlank()) {
      throw new UsageProbeException("BAD_SECRET", "저장된 로그인 정보를 읽을 수 없음");
    }
    // 2) 호출 — 상태와 본문 바이트만 꺼낸다.
    int status;
    byte[] bodyBytes;
    try {
      var res =
          client
              .get()
              .uri("/backend-api/wham/usage")
              .header(HttpHeaders.AUTHORIZATION, "Bearer " + accessToken)
              .header("ChatGPT-Account-Id", accountId)
              .exchange((req, r) -> new Raw(r.getStatusCode().value(), r.getBody().readAllBytes()));
      status = res.status();
      bodyBytes = res.body();
    } catch (RestClientException | IllegalArgumentException e) {
      throw new UsageProbeException("NETWORK", "연결 실패");
    }
    if (status == 401) {
      throw new UsageProbeException("TOKEN_EXPIRED", "토큰 만료 — 다시 로그인 필요할 수 있음");
    }
    if (status < 200 || status >= 300) {
      throw new UsageProbeException("HTTP_" + status, "응답 오류(" + status + ")");
    }
    // 3) 응답 해석.
    JsonNode rate;
    try {
      rate = MAPPER.readTree(bodyBytes).path("rate_limit");
    } catch (Exception e) {
      throw new UsageProbeException("BAD_RESPONSE", "사용량 응답을 해석할 수 없음");
    }
    Instant now = Instant.now();
    List<UsageSnapshot> windows = new ArrayList<>();
    addWindow(windows, UsageWindow.FIVE_HOUR, rate.path("primary_window"), now);
    addWindow(windows, UsageWindow.WEEKLY, rate.path("secondary_window"), now);
    if (windows.isEmpty()) {
      throw new UsageProbeException("BAD_RESPONSE", "사용량 창이 없음");
    }
    return new UsageReading(List.copyOf(windows), rate.path("limit_reached").asBoolean(false));
  }

  /** 창 노드에 used_percent 가 있으면 스냅샷으로 추가한다. reset_at 이 없으면 reset_after_seconds 로 계산한다. */
  private static void addWindow(
      List<UsageSnapshot> out, UsageWindow window, JsonNode node, Instant now) {
    JsonNode used = node.path("used_percent");
    if (!used.isNumber()) return;
    BigDecimal percent = used.decimalValue().setScale(2, RoundingMode.HALF_UP);
    Instant resetsAt = null;
    if (node.path("reset_at").isNumber()) {
      resetsAt = Instant.ofEpochSecond(node.path("reset_at").asLong());
    } else if (node.path("reset_after_seconds").isNumber()) {
      resetsAt = now.plusSeconds(node.path("reset_after_seconds").asLong());
    }
    out.add(new UsageSnapshot(window, percent, resetsAt, null, now));
  }

  /** 응답 상태와 본문. */
  private record Raw(int status, byte[] body) {}
}
