package com.workplace.airun.outbound;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.net.ConnectException;
import java.net.SocketTimeoutException;
import java.net.http.HttpConnectTimeoutException;
import java.net.http.HttpTimeoutException;
import org.junit.jupiter.api.Test;

/** AiRunFailures.reasonFor 사유 분류 단위 테스트 (WP-1829). */
class AiRunFailuresTest {

  @Test
  void connectTimeout_isUnreachable() {
    assertThat(AiRunFailures.reasonFor(new HttpConnectTimeoutException("connect timed out")))
        .isEqualTo("agent_unreachable");
  }

  @Test
  void connectTimeoutInCauseChain_isUnreachable() {
    IOException wrapped = new IOException("wrap", new HttpConnectTimeoutException("x"));
    assertThat(AiRunFailures.reasonFor(wrapped)).isEqualTo("agent_unreachable");
  }

  @Test
  void connectionRefused_isUnreachable() {
    assertThat(AiRunFailures.reasonFor(new ConnectException("refused")))
        .isEqualTo("agent_unreachable");
  }

  @Test
  void readTimeout_isTimeout() {
    assertThat(AiRunFailures.reasonFor(new HttpTimeoutException("request timed out")))
        .isEqualTo("agent_timeout");
    assertThat(AiRunFailures.reasonFor(new SocketTimeoutException("Read timed out")))
        .isEqualTo("agent_timeout");
  }

  /** 취소로 감싸진 인터럽트(Spring JdkClientHttpRequest 의 IOException)는 인터럽트로 본다. */
  @Test
  void interruptWrappedInIOException_isInterrupt() {
    assertThat(
            AiRunFailures.isInterrupt(
                new IOException("Request was interrupted", new InterruptedException())))
        .isTrue();
    assertThat(AiRunFailures.isInterrupt(new java.io.InterruptedIOException("x"))).isTrue();
  }

  /** 시간 초과·연결 거부는 인터럽트가 아니다(InterruptedIOException 하위 SocketTimeoutException 포함). */
  @Test
  void timeoutAndRefused_areNotInterrupt() {
    assertThat(AiRunFailures.isInterrupt(new SocketTimeoutException("Read timed out"))).isFalse();
    assertThat(AiRunFailures.isInterrupt(new ConnectException("refused"))).isFalse();
  }

  /** SSE 전송에서 인터럽트는 기록 없이 그대로 던지고, 연결 거부는 기록한다. */
  @Test
  void send_interruptNotRecorded_refusedRecorded() throws Exception {
    var recorder = org.mockito.Mockito.mock(com.workplace.airun.service.AiRunRecorder.class);
    var http = org.mockito.Mockito.mock(java.net.http.HttpClient.class);
    var req = java.net.http.HttpRequest.newBuilder(java.net.URI.create("http://x/")).build();

    IOException interrupted =
        new IOException("Request was interrupted", new InterruptedException());
    org.mockito.Mockito.doThrow(interrupted)
        .when(http)
        .send(org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any());
    org.assertj.core.api.Assertions.assertThatThrownBy(
            () -> AiRunFailures.send(http, recorder, "/ai/chat", header -> req))
        .isSameAs(interrupted);
    org.mockito.Mockito.verifyNoInteractions(recorder);

    ConnectException refused = new ConnectException("refused");
    org.mockito.Mockito.doThrow(refused)
        .when(http)
        .send(org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any());
    org.assertj.core.api.Assertions.assertThatThrownBy(
            () -> AiRunFailures.send(http, recorder, "/ai/chat", header -> req))
        .isSameAs(refused);
    org.mockito.Mockito.verify(recorder).upsert(org.mockito.ArgumentMatchers.any());
  }
}
