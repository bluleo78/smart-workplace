package com.workplace.home.outbound;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.jsonPath;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import com.workplace.home.exception.MemoryCleanupAiException;
import com.workplace.home.outbound.SharedMemoryMessages.CheckRequest;
import com.workplace.home.outbound.SharedMemoryMessages.ExtractRequest;
import com.workplace.home.outbound.SharedMemoryMessages.MemoryRef;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

/**
 * WP-386 AiAgentSharedMemoryClient — 검사·추출 요청 필드명(ai-agent zod 와 같음), 결과 파싱, 실패는 예외. 검사 요청에는 사람·대화
 * 식별자가 없다.
 */
class AiAgentSharedMemoryClientTest {

  private final RestClient.Builder quick = RestClient.builder().baseUrl("http://ai");
  private final RestClient.Builder slow = RestClient.builder().baseUrl("http://ai");
  private final MockRestServiceServer quickServer = MockRestServiceServer.bindTo(quick).build();
  private final MockRestServiceServer slowServer = MockRestServiceServer.bindTo(slow).build();
  private final AiAgentSharedMemoryClient client =
      new AiAgentSharedMemoryClient(quick, slow, "tok");

  @Test
  void 검사_요청은_후보와_공간만_싣고_결과를_돌려준다() {
    quickServer
        .expect(requestTo("http://ai/home/shared-memory-check"))
        .andExpect(header("Authorization", "Internal tok"))
        .andExpect(jsonPath("$.agentId").value(5))
        .andExpect(jsonPath("$.spaceType").value("PROJECT"))
        .andExpect(jsonPath("$.spaceName").value("Smart Workplace(WP)"))
        .andExpect(jsonPath("$.candidates[0]").value("배포는 API 먼저 한다"))
        .andExpect(jsonPath("$.userId").doesNotExist())
        .andExpect(jsonPath("$.sessionId").doesNotExist())
        .andRespond(
            withSuccess(
                "{\"results\":[{\"teamWide\":true,\"personal\":false,\"reason\":\"팀 규칙\"}]}",
                MediaType.APPLICATION_JSON));
    var r =
        client.checkNow(
            new CheckRequest(
                5L,
                "claude-haiku-5-5",
                12_000,
                "PROJECT",
                "Smart Workplace(WP)",
                List.of("배포는 API 먼저 한다")));
    assertThat(r.passed(0, 1)).isTrue();
    quickServer.verify();
  }

  @Test
  void 배경_검사는_긴_읽기_클라이언트로_보낸다() {
    slowServer
        .expect(requestTo("http://ai/home/shared-memory-check"))
        .andRespond(
            withSuccess(
                "{\"results\":[{\"teamWide\":false,\"personal\":true,\"reason\":\"개인\"}]}",
                MediaType.APPLICATION_JSON));
    var r = client.check(new CheckRequest(5L, null, 30_000, "PROJECT", "WP", List.of("나는 재택한다")));
    assertThat(r.passed(0, 1)).isFalse();
    slowServer.verify();
  }

  @Test
  void 결과_수가_후보_수와_다르면_모두_불통과() {
    var r =
        new SharedMemoryMessages.CheckResult(
            List.of(new SharedMemoryMessages.Verdict(true, false, "x")));
    assertThat(r.passed(0, 2)).isFalse();
    assertThat(r.passed(1, 2)).isFalse();
    assertThat(new SharedMemoryMessages.CheckResult(null).passed(0, 1)).isFalse();
    assertThat(new SharedMemoryMessages.Verdict(true, true, "섞임").passed()).isFalse();
  }

  @Test
  void 추출_요청_필드명과_ops() {
    slowServer
        .expect(requestTo("http://ai/home/shared-memory-extract"))
        .andExpect(jsonPath("$.utterances[0]").value("우리 팀은 배포를 API 먼저 하기로 했어"))
        .andExpect(jsonPath("$.memories[0].origin").value("AI_EXTRACTED"))
        .andExpect(jsonPath("$.today").value("2026-10-15"))
        .andRespond(
            withSuccess(
                "{\"ops\":[{\"op\":\"ADD\",\"targetIds\":[],\"content\":\" 배포는 API 먼저 한다 \",\"evidence\":0,\"reason\":\"r\"}]}",
                MediaType.APPLICATION_JSON));
    var r =
        client.extract(
            new ExtractRequest(
                5L,
                null,
                30_000,
                "2026-10-15",
                "PROJECT",
                "WP",
                List.of("우리 팀은 배포를 API 먼저 하기로 했어"),
                List.of(new MemoryRef(3L, "옛 규칙", "AI_EXTRACTED"))));
    assertThat(r.ops()).hasSize(1);
    assertThat(r.ops().get(0).resultText()).isEqualTo("배포는 API 먼저 한다");
  }

  @Test
  void 실패는_예외() {
    quickServer
        .expect(requestTo("http://ai/home/shared-memory-check"))
        .andRespond(withStatus(HttpStatus.BAD_GATEWAY));
    assertThatThrownBy(
            () ->
                client.checkNow(new CheckRequest(5L, null, 12_000, "PROJECT", "WP", List.of("x"))))
        .isInstanceOf(MemoryCleanupAiException.class);
    slowServer
        .expect(requestTo("http://ai/home/shared-memory-extract"))
        .andRespond(withStatus(HttpStatus.SERVICE_UNAVAILABLE));
    assertThatThrownBy(
            () ->
                client.extract(
                    new ExtractRequest(
                        5L, null, 30_000, "2026-10-15", "PROJECT", "WP", List.of("x"), List.of())))
        .isInstanceOfSatisfying(
            MemoryCleanupAiException.class, e -> assertThat(e.isAgentDown()).isTrue());
  }

  @Test
  void 본문이_없는_성공은_빈_결과로_다룬다() {
    slowServer
        .expect(requestTo("http://ai/home/shared-memory-extract"))
        .andRespond(withSuccess("{}", MediaType.APPLICATION_JSON));
    var r =
        client.extract(
            new ExtractRequest(
                5L, null, 30_000, "2026-10-15", "PROJECT", "WP", List.of("x"), List.of()));
    assertThat(r.ops()).isEmpty();
  }
}
