package com.workplace.global.outbound;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.home.exception.MemoryCleanupAiException;
import com.workplace.home.exception.PriorityAiException;
import com.workplace.mail.exception.MailAiException;
import com.workplace.mail.exception.MailAiUnavailableException;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.web.client.HttpServerErrorException;

/**
 * 503 가 둘로 갈리는지(WP-2108) — 본문이 {@code PROVIDER_LIMIT} 인 503 은 한 사용자 비서의 한도라 ai-agent 장애가 아니다. 장애로
 * 세면 한 사람의 한도가 우선순위 분류 회차·메모리 정리 전체를 멈춘다.
 */
class AgentOutageGuardLimitTest {

  private static HttpServerErrorException limit503() {
    return new HttpServerErrorException(
        HttpStatus.SERVICE_UNAVAILABLE,
        "",
        new HttpHeaders(),
        "{\"reason\":\"PROVIDER_LIMIT\",\"resetsAt\":\"2026-11-26T06:30:00Z\"}"
            .getBytes(StandardCharsets.UTF_8),
        StandardCharsets.UTF_8);
  }

  private static HttpServerErrorException plain503() {
    return new HttpServerErrorException(
        HttpStatus.SERVICE_UNAVAILABLE,
        "",
        new HttpHeaders(),
        "{\"reason\":\"AGENT_BUSY\"}".getBytes(StandardCharsets.UTF_8),
        StandardCharsets.UTF_8);
  }

  @Test
  void 한도_503_은_장애가_아니고_그냥_503_은_장애() {
    assertThat(AgentOutageGuard.isAgentDown(limit503())).isFalse();
    assertThat(AgentOutageGuard.isAgentDown(plain503())).isTrue();
  }

  @Test
  void 한도_503_이_연속돼도_가드가_트립하지_않는다() {
    AgentOutageGuard guard = new AgentOutageGuard();
    for (int i = 0; i < 5; i++) {
      PriorityAiException e = new PriorityAiException("x", limit503());
      if (e.isTransient()) guard.recordUnavailable();
      else guard.recordResponse();
    }
    assertThat(guard.tripped()).isFalse();
  }

  @Test
  void 메일_불가_판정도_한도_503_은_장애가_아니다() {
    assertThat(MailAiException.isAgentUnavailable(new MailAiUnavailableException("x", limit503())))
        .isFalse();
    assertThat(MailAiException.isAgentUnavailable(new MailAiUnavailableException("x", plain503())))
        .isTrue();
  }

  @Test
  void 도메인_예외_판정도_한도는_장애가_아니다() {
    assertThat(new PriorityAiException("x", limit503()).isTransient()).isFalse();
    assertThat(new PriorityAiException("x", plain503()).isTransient()).isTrue();
    assertThat(new MemoryCleanupAiException("x", limit503()).isAgentDown()).isFalse();
    assertThat(new MemoryCleanupAiException("x", plain503()).isAgentDown()).isTrue();
  }
}
