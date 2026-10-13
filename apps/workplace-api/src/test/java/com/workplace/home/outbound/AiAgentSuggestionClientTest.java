package com.workplace.home.outbound;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.jsonPath;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withServerError;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import com.workplace.home.outbound.ChatMessages.SuggestionRequest;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

/** WP-139 AiAgentSuggestionClient — ai-agent /home/suggestions 요청 필드명과 실패 시 빈 결과. */
class AiAgentSuggestionClientTest {

  private final RestClient.Builder builder = RestClient.builder().baseUrl("http://ai");
  private final MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
  private final AiAgentSuggestionClient client = new AiAgentSuggestionClient(builder, "tok");

  private static SuggestionRequest starter() {
    return new SuggestionRequest(
        "starter", 5L, null, null, List.of("3분기 매출"), null, null, 4, 15_000);
  }

  @Test
  void 요청_필드명이_ai_agent_스키마와_같고_items_를_돌려준다() {
    server
        .expect(requestTo("http://ai/home/suggestions"))
        .andExpect(method(HttpMethod.POST))
        .andExpect(header("Authorization", "Internal tok"))
        .andExpect(jsonPath("$.mode").value("starter"))
        .andExpect(jsonPath("$.agentId").value(5))
        .andExpect(jsonPath("$.recentTitles[0]").value("3분기 매출"))
        .andExpect(jsonPath("$.count").value(4))
        .andExpect(jsonPath("$.timeoutMs").value(15000))
        .andRespond(withSuccess("{\"items\":[\"오늘 일정 요약해줘\"]}", MediaType.APPLICATION_JSON));
    assertThat(client.suggest(starter())).containsExactly("오늘 일정 요약해줘");
    server.verify();
  }

  @Test
  void ai_agent_502_면_빈_목록() {
    server.expect(requestTo("http://ai/home/suggestions")).andRespond(withServerError());
    assertThat(client.suggest(starter())).isEmpty();
  }

  @Test
  void items_가_없으면_빈_목록() {
    server
        .expect(requestTo("http://ai/home/suggestions"))
        .andRespond(withSuccess("{}", MediaType.APPLICATION_JSON));
    assertThat(client.suggest(starter())).isEmpty();
  }
}
