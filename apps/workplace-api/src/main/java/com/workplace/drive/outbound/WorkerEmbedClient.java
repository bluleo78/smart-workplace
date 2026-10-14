package com.workplace.drive.outbound;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.fileai.outbound.WorkerProperties;
import com.workplace.global.ai.TextEmbedder;
import com.workplace.global.outbound.InternalHttp;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/**
 * 검색 쿼리를 워커로 동기 임베딩(/embed-query). 5s 타임아웃, LRU 캐시(200/사실상 짧은 수명), 실패 시 empty → 호출부가 키워드 전용으로 우아하게
 * 강등(검색이 워커 장애로 죽지 않는다). WP-383: 메모리·대화 턴(문서) 임베딩과 대기 시간을 고르는 질의 임베딩도 같은 /embed-query 로 받는다(BGE-M3
 * 는 질의·문서 접두가 없다).
 */
@Service
public class WorkerEmbedClient implements TextEmbedder {

  private static final Logger log = LoggerFactory.getLogger(WorkerEmbedClient.class);

  private static final Duration TIMEOUT = Duration.ofSeconds(5);
  private static final int CACHE_MAX = 200;

  private final WorkerProperties props;
  private final HttpClient http;
  private final ObjectMapper mapper = new ObjectMapper();
  // 최근 쿼리 임베딩 LRU(동일 쿼리 반복 시 워커 왕복 회피).
  private final Map<String, float[]> cache =
      Collections.synchronizedMap(
          new LinkedHashMap<>(16, 0.75f, true) {
            @Override
            protected boolean removeEldestEntry(Map.Entry<String, float[]> e) {
              return size() > CACHE_MAX;
            }
          });

  @Autowired
  public WorkerEmbedClient(WorkerProperties props) {
    // HTTP/1.1 고정 — InternalHttp 참조
    this(props, InternalHttp.httpClientBuilder().connectTimeout(Duration.ofSeconds(2)).build());
  }

  /** 테스트용 — HttpClient 주입(게이트 off 시 HTTP 미호출 검증). */
  WorkerEmbedClient(WorkerProperties props, HttpClient http) {
    this.props = props;
    this.http = http;
  }

  /** 쿼리 임베딩(5초 대기). 실패/비활성/타임아웃 시 empty(키워드 전용 강등). 드라이브 콘텐츠 검색이 쓴다. */
  public Optional<float[]> embedQuery(String query) {
    return embedQuery(query, TIMEOUT);
  }

  @Override
  public boolean enabled() {
    return props.enabled() && props.embed().enabled();
  }

  /** 대기 시간을 고르는 쿼리 임베딩 — 같은 질의는 LRU 캐시에서 돌려준다. */
  @Override
  public Optional<float[]> embedQuery(String query, Duration timeout) {
    // 워커 비활성·임베딩 게이트 off·빈 쿼리 → empty(키워드 전용 강등)
    if (!enabled() || query == null || query.isBlank()) return Optional.empty();
    float[] cached = cache.get(query);
    if (cached != null) return Optional.of(cached);
    Optional<float[]> vec = call(query, timeout);
    vec.ifPresent(v -> cache.put(query, v));
    return vec;
  }

  /** 문서 임베딩(5초 대기, 캐시 없음) — 메모리 내용·대화 턴. */
  @Override
  public Optional<float[]> embedDocument(String text) {
    if (!enabled() || text == null || text.isBlank()) return Optional.empty();
    return call(text, TIMEOUT);
  }

  /** /embed-query 1회 호출 — 비정상 응답·예외는 empty. 로그에는 본문 대신 길이만 남긴다(메모리·대화는 사용자 데이터). */
  private Optional<float[]> call(String text, Duration timeout) {
    try {
      HttpRequest req =
          HttpRequest.newBuilder()
              .uri(URI.create(props.baseUrl() + "/embed-query"))
              .timeout(timeout)
              .header("Authorization", "Internal " + props.internalToken())
              .header("Content-Type", "application/json")
              .POST(
                  HttpRequest.BodyPublishers.ofString(
                      mapper.writeValueAsString(Map.of("text", text))))
              .build();
      HttpResponse<String> resp = http.send(req, HttpResponse.BodyHandlers.ofString());
      if (resp.statusCode() != 200) {
        log.warn("embed-query 비정상 응답: status={} body={}", resp.statusCode(), resp.body());
        return Optional.empty();
      }
      JsonNode arr = mapper.readTree(resp.body()).get("embedding");
      if (arr == null || !arr.isArray()) {
        return Optional.empty();
      }
      float[] vec = new float[arr.size()];
      for (int i = 0; i < arr.size(); i++) {
        vec[i] = (float) arr.get(i).asDouble();
      }
      return Optional.of(vec);
    } catch (Exception e) {
      log.warn("embed-query 실패 — 키워드 전용 강등: len={} error={}", text.length(), e.getMessage());
      return Optional.empty(); // graceful degradation
    }
  }
}
