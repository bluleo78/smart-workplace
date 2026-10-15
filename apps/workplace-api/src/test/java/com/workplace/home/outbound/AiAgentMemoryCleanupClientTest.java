package com.workplace.home.outbound;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.jsonPath;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withServerError;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import com.workplace.home.exception.MemoryCleanupAiException;
import com.workplace.home.outbound.MemoryCleanupMessages.AssistantNote;
import com.workplace.home.outbound.MemoryCleanupMessages.MemoryRef;
import com.workplace.home.outbound.MemoryCleanupMessages.Request;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

/** WP-385 AiAgentMemoryCleanupClient — 요청 필드명(ai-agent zod 와 같음), ops 파싱, 실패는 예외(일시 장애 판정). */
class AiAgentMemoryCleanupClientTest {

  private final RestClient.Builder builder = RestClient.builder().baseUrl("http://ai");
  private final MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
  private final AiAgentMemoryCleanupClient client = new AiAgentMemoryCleanupClient(builder, "tok");

  private static Request request() {
    return new Request(
        5L,
        "claude-haiku-5-5",
        30_000,
        "2026-10-15",
        List.of("나 백엔드 팀이야"),
        List.of(new AssistantNote(0, "알겠어요")),
        List.of(new MemoryRef(9L, "CONTEXT", "프론트 팀이다", null, null, "AI", false, false)));
  }

  @Test
  void 요청_필드명이_ai_agent_스키마와_같고_ops_를_돌려준다() {
    server
        .expect(requestTo("http://ai/home/memory-cleanup"))
        .andExpect(method(HttpMethod.POST))
        .andExpect(header("Authorization", "Internal tok"))
        .andExpect(jsonPath("$.agentId").value(5))
        .andExpect(jsonPath("$.model").value("claude-haiku-5-5"))
        .andExpect(jsonPath("$.timeoutMs").value(30000))
        .andExpect(jsonPath("$.today").value("2026-10-15"))
        .andExpect(jsonPath("$.utterances[0]").value("나 백엔드 팀이야"))
        .andExpect(jsonPath("$.assistantNotes[0].after").value(0))
        .andExpect(jsonPath("$.memories[0].id").value(9))
        .andExpect(jsonPath("$.memories[0].pinned").value(false))
        .andRespond(
            withSuccess(
                "{\"ops\":[{\"op\":\"UPDATE\",\"targetIds\":[9],\"content\":\"백엔드 팀이다\","
                    + "\"kind\":\"CONTEXT\",\"scope\":null,\"expiresOn\":null,\"evidence\":0,"
                    + "\"reason\":\"팀을 바로잡음\"}]}",
                MediaType.APPLICATION_JSON));

    var result = client.cleanup(request());

    assertThat(result.ops()).hasSize(1);
    var op = result.ops().get(0);
    assertThat(op.op()).isEqualTo("UPDATE");
    assertThat(op.targetIds()).containsExactly(9L);
    assertThat(op.evidence()).isZero();
    assertThat(op.resultText()).isEqualTo("백엔드 팀이다");
    server.verify();
  }

  @Test
  void ops_가_없으면_빈_목록() {
    server
        .expect(requestTo("http://ai/home/memory-cleanup"))
        .andRespond(withSuccess("{}", MediaType.APPLICATION_JSON));
    assertThat(client.cleanup(request()).ops()).isEmpty();
  }

  @Test
  void ai_agent_500_은_일시_장애가_아닌_실패다() {
    server.expect(requestTo("http://ai/home/memory-cleanup")).andRespond(withServerError());
    assertThatThrownBy(() -> client.cleanup(request()))
        .isInstanceOfSatisfying(
            MemoryCleanupAiException.class, e -> assertThat(e.isAgentDown()).isFalse());
  }

  @Test
  void ai_agent_503_은_일시_장애다() {
    server
        .expect(requestTo("http://ai/home/memory-cleanup"))
        .andRespond(withStatus(HttpStatus.SERVICE_UNAVAILABLE));
    assertThatThrownBy(() -> client.cleanup(request()))
        .isInstanceOfSatisfying(
            MemoryCleanupAiException.class, e -> assertThat(e.isAgentDown()).isTrue());
  }

  // 최종 리뷰 5: 새 API 를 구 ai-agent(경로 없음)보다 먼저 올린 구간 — 404 는 그 요청 탓이 아니라 일시 장애로 본다(세지 않음).
  @Test
  void ai_agent_404_는_경로가_아직_없는_일시_장애다() {
    server
        .expect(requestTo("http://ai/home/memory-cleanup"))
        .andRespond(withStatus(HttpStatus.NOT_FOUND));
    assertThatThrownBy(() -> client.cleanup(request()))
        .isInstanceOfSatisfying(
            MemoryCleanupAiException.class,
            e -> {
              assertThat(e.isAgentDown()).isTrue();
              assertThat(e.isReadTimeout()).isFalse();
            });
  }

  @Test
  void ai_agent_400_은_일시_장애가_아닌_실패다() {
    server
        .expect(requestTo("http://ai/home/memory-cleanup"))
        .andRespond(withStatus(HttpStatus.BAD_REQUEST));
    assertThatThrownBy(() -> client.cleanup(request()))
        .isInstanceOfSatisfying(
            MemoryCleanupAiException.class, e -> assertThat(e.isAgentDown()).isFalse());
  }
}
