package com.workplace.issue.outbound;

import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.issue.exception.IssueAiException;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

/**
 * 클라이언트의 마지막 방어선(WP-1640) — 연동이 꺼져 있으면 보고 밖 메서드(요약·분류·업무 프로필·상태 요약)도 ai-agent 로 요청을 보내지 않고 일반 문구의
 * {@link IssueAiException} 으로 끝난다. 호출부가 먼저 막지만, 새 호출부가 확인을 빠뜨려도 남의 ai-agent 로 새지 않게 한다. 기대가 없는
 * MockRestServiceServer 의 verify 로 요청 0건을 확인한다(요청 본문은 보내기 전에 막히므로 null 이어도 된다).
 */
class AiAgentIssueClientDisabledTest {

  private final RestClient.Builder off = RestClient.builder().baseUrl("http://ai-agent.test");
  private final MockRestServiceServer offServer = MockRestServiceServer.bindTo(off).build();
  private final AiAgentIssueClient disabled = new AiAgentIssueClient(off, off, "tok-123", false);

  @Test
  void 연동꺼짐_보고밖_메서드도_요청없이_실패() {
    assertDisabled(() -> disabled.summarizeProgress(null));
    assertDisabled(() -> disabled.classify(null));
    assertDisabled(() -> disabled.analyzeWorkProfile(null));
    assertDisabled(() -> disabled.summarizeProjectStatus(null));
    offServer.verify();
  }

  /** 일반 문구의 IssueAiException 으로 끝나는지. */
  private static void assertDisabled(Runnable call) {
    assertThatThrownBy(call::run)
        .isInstanceOf(IssueAiException.class)
        .hasMessage(AiAgentIssueClient.DISABLED_MESSAGE_GENERIC);
  }
}
