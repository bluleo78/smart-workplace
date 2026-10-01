package com.workplace.global.realtime;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertTimeoutPreemptively;

import com.workplace.global.security.JwtTokenProvider;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.server.LocalServerPort;

/**
 * SSE 연결 직후 응답이 즉시 flush 되는지 검증하는 실제 HTTP 통합 테스트 (WP-156).
 *
 * <p>MockMvc 는 서블릿 응답 커밋 시점을 재현하지 못하므로 RANDOM_PORT 서버에 실제로 붙는다. 서버가 첫 바이트를 보내지 않으면 클라이언트는 30초
 * heartbeat 까지 헤더조차 받지 못해 "실시간 연결 중" 배너가 길게 떴다 — heartbeat 주기보다 훨씬 짧은 시간 안에 헤더와 초기 코멘트가 도착해야 한다.
 */
class EventStreamInitialFlushIntegrationTest extends IntegrationTestBase {

  // heartbeat(30s) 보다 충분히 짧은 상한 — 이 안에 첫 바이트가 오면 heartbeat 대기가 아님이 확실하다.
  private static final Duration FIRST_BYTE_TIMEOUT = Duration.ofSeconds(5);

  @Autowired private JwtTokenProvider jwtTokenProvider;
  @LocalServerPort private int port;

  private Long userId;

  @BeforeEach
  void seed() {
    userId = withMembership(TestFixtures.createHuman(baseDsl));
  }

  @AfterEach
  void cleanup() {
    // membership 은 user 삭제 시 FK CASCADE 로 함께 정리된다.
    cleanupInTenant(1L, () -> baseDsl.deleteFrom(USER).where(USER.ID.eq(userId)).execute());
  }

  @Test
  void stream_flushesHeadersAndInitialCommentImmediately() throws Exception {
    String token = jwtTokenProvider.generateAccessToken(userId, "user-" + userId, 1L);
    // request timeout 은 응답 헤더 수신까지 적용 — 서버가 첫 전송 전까지 응답을 커밋하지 않으면 여기서 타임아웃난다.
    HttpRequest request =
        HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/v1/events"))
            .header("Authorization", "Bearer " + token)
            .header("Accept", "text/event-stream")
            .timeout(FIRST_BYTE_TIMEOUT)
            .GET()
            .build();

    // HttpClient.close() 는 진행 중 교환이 끝나길 기다리므로, 끝나지 않는 SSE 본문을 먼저 닫아(교환 취소) 클라이언트가 바로 닫히게 한다.
    try (HttpClient client = HttpClient.newHttpClient()) {
      HttpResponse<InputStream> response =
          client.send(request, HttpResponse.BodyHandlers.ofInputStream());
      assertThat(response.statusCode()).isEqualTo(200);

      try (BufferedReader reader =
          new BufferedReader(new InputStreamReader(response.body(), StandardCharsets.UTF_8))) {
        // 첫 줄은 초기 연결 코멘트여야 한다(heartbeat ':ping' 이 아님).
        String firstLine = assertTimeoutPreemptively(FIRST_BYTE_TIMEOUT, reader::readLine);
        assertThat(firstLine).isEqualTo(":connected");
      }
    }
  }
}
