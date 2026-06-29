package com.workplace.drive.outbound;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

import com.workplace.fileai.outbound.WorkerProperties;
import java.net.http.HttpClient;
import java.net.http.HttpResponse;
import org.junit.jupiter.api.Test;

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
            new WorkerProperties.Embed("BAAI/bge-m3", 1024, 8000, false));
    WorkerEmbedClient client = new WorkerEmbedClient(props, http);

    assertThat(client.embedQuery("hello")).isEmpty();
    // 핵심: 게이트가 HTTP 자체를 막는다(HTTP 실패 강등 경로와 구분).
    verify(http, never()).send(any(), any(HttpResponse.BodyHandler.class));
  }
}
