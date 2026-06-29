package com.workplace.drive.outbound;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.fileai.outbound.WorkerProperties;
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
import org.springframework.stereotype.Service;

/**
 * 검색 쿼리를 워커로 동기 임베딩(/embed-query). 5s 타임아웃, LRU 캐시(200/사실상 짧은 수명), 실패 시 empty → 호출부가 키워드 전용으로 우아하게
 * 강등(검색이 워커 장애로 죽지 않는다).
 */
@Service
public class WorkerEmbedClient {

  private static final Logger log = LoggerFactory.getLogger(WorkerEmbedClient.class);

  private static final Duration TIMEOUT = Duration.ofSeconds(5);
  private static final int CACHE_MAX = 200;

  private final WorkerProperties props;
  // uvicorn(FastAPI)은 H2C(cleartext HTTP/2) 업그레이드를 거부해 400 을 반환하므로 HTTP/1.1 고정.
  private final HttpClient http =
      HttpClient.newBuilder()
          .connectTimeout(Duration.ofSeconds(2))
          .version(HttpClient.Version.HTTP_1_1)
          .build();
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

  public WorkerEmbedClient(WorkerProperties props) {
    this.props = props;
  }

  /** 쿼리 임베딩. 실패/비활성/타임아웃 시 empty(키워드 전용 강등). */
  public Optional<float[]> embedQuery(String query) {
    if (!props.enabled() || query == null || query.isBlank()) {
      return Optional.empty();
    }
    float[] cached = cache.get(query);
    if (cached != null) {
      return Optional.of(cached);
    }
    try {
      HttpRequest req =
          HttpRequest.newBuilder()
              .uri(URI.create(props.baseUrl() + "/embed-query"))
              .timeout(TIMEOUT)
              .header("Authorization", "Internal " + props.internalToken())
              .header("Content-Type", "application/json")
              .POST(
                  HttpRequest.BodyPublishers.ofString(
                      mapper.writeValueAsString(Map.of("text", query))))
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
      cache.put(query, vec);
      return Optional.of(vec);
    } catch (Exception e) {
      log.warn("embed-query 실패 — 키워드 전용 강등: query={} error={}", query, e.getMessage(), e);
      return Optional.empty(); // graceful degradation
    }
  }
}
