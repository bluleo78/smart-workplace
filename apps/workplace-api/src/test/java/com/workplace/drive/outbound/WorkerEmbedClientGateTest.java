package com.workplace.drive.outbound;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

import com.workplace.fileai.outbound.WorkerProperties;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/** WorkerEmbedClient 임베딩 게이트 단위 테스트 — 게이트 off 시 HTTP 미호출 + empty. */
class WorkerEmbedClientGateTest {

  @Test
  void embedGateOff_returnsEmpty_withoutAnyHttpCall() throws Exception {
    HttpClient http = mock(HttpClient.class);
    // 워커는 활성이나 임베딩 게이트만 false
    WorkerProperties props =
        new WorkerProperties(
            "http://localhost:7080",
            "token",
            true,
            new WorkerProperties.Embed("BAAI/bge-m3", 1024, 8000, false),
            null);
    WorkerEmbedClient client = new WorkerEmbedClient(props, http);

    assertThat(client.embedQuery("hello")).isEmpty();
    // 핵심: 게이트가 HTTP 자체를 막는다(HTTP 실패 강등 경로와 구분).
    verify(http, never()).send(any(), any(HttpResponse.BodyHandler.class));
  }

  /** WP-383: 게이트가 꺼지면 enabled=false, 대기 시간을 준 질의·문서 임베딩도 HTTP 없이 empty. */
  @Test
  void 게이트가_꺼지면_문서와_대기_지정_질의도_HTTP_없이_empty() throws Exception {
    HttpClient http = mock(HttpClient.class);
    WorkerProperties props =
        new WorkerProperties(
            "http://localhost:7080",
            "token",
            true,
            new WorkerProperties.Embed("BAAI/bge-m3", 1024, 8000, false),
            null);
    WorkerEmbedClient client = new WorkerEmbedClient(props, http);

    assertThat(client.enabled()).isFalse();
    assertThat(client.embedQuery("hello", Duration.ofMillis(1500))).isEmpty();
    assertThat(client.embedDocument("hello")).isEmpty();
    verify(http, never()).send(any(), any(HttpResponse.BodyHandler.class));
  }

  /** WP-383: 질의 임베딩은 받은 대기 시간을 요청 타임아웃으로 쓰고 캐시하며, 문서 임베딩은 캐시하지 않는다(질의 캐시를 밀어내지 않게). */
  @Test
  @SuppressWarnings("unchecked")
  void 질의는_대기_시간을_타임아웃으로_쓰고_캐시하며_문서는_캐시하지_않는다() throws Exception {
    HttpClient http = mock(HttpClient.class);
    HttpResponse<String> resp = mock(HttpResponse.class);
    org.mockito.Mockito.when(resp.statusCode()).thenReturn(200);
    org.mockito.Mockito.when(resp.body()).thenReturn("{\"embedding\":[0.5,0.25]}");
    doReturn(resp).when(http).send(any(), any(HttpResponse.BodyHandler.class));
    WorkerProperties props =
        new WorkerProperties(
            "http://localhost:7080",
            "token",
            true,
            new WorkerProperties.Embed("BAAI/bge-m3", 1024, 8000, true),
            null);
    WorkerEmbedClient client = new WorkerEmbedClient(props, http);

    assertThat(client.embedQuery("고양이", Duration.ofMillis(1500)))
        .hasValueSatisfying(v -> assertThat(v).containsExactly(0.5f, 0.25f));
    client.embedQuery("고양이", Duration.ofMillis(1500));
    ArgumentCaptor<HttpRequest> req = ArgumentCaptor.forClass(HttpRequest.class);
    verify(http, times(1)).send(req.capture(), any(HttpResponse.BodyHandler.class));
    assertThat(req.getValue().timeout()).contains(Duration.ofMillis(1500));

    client.embedDocument("긴 문서");
    client.embedDocument("긴 문서");
    verify(http, times(3)).send(any(), any(HttpResponse.BodyHandler.class));
  }
}
