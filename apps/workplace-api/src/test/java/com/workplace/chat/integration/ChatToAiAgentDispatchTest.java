package com.workplace.chat.integration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;

import com.workplace.chat.dto.CreateChatMessageRequest;
import com.workplace.chat.repository.ChatThreadMemberRepository;
import com.workplace.chat.service.ChatFixtures;
import com.workplace.chat.service.ChatMessageService;
import com.workplace.chat.service.ChatThreadService;
import com.workplace.global.outbound.AiAgentEventClient;
import com.workplace.global.outbound.EventEnvelope;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/**
 * chat 메시지 → ai-agent webhook 발사 통합. ai-agent client 를 MockitoBean 으로 가로채 호출 검증. enabled=true 강제.
 */
@TestPropertySource(properties = "workplace.ai-agent.enabled=true")
class ChatToAiAgentDispatchTest extends IntegrationTestBase {

  @MockitoBean AiAgentEventClient client;
  @Autowired ChatThreadService threadService;
  @Autowired ChatMessageService messageService;
  @Autowired ChatThreadMemberRepository memberRepo;
  @Autowired ChatFixtures fx;

  @Test
  void humanWithAgentMention_publishesOnce() {
    ChatFixtures.AgentSetup s = fx.setupWithAgent();
    var thread =
        threadService.getOrCreate(
            s.base().reporterId(), s.base().projectKey(), s.base().issueNumber());
    // AGENT 도 thread 멤버로 직접 추가 (mention resolve 단계와 무관 — mention 은 username 매칭으로 작동).
    memberRepo.insertIgnoreConflict(thread.threadId(), List.of(s.agentId()));

    messageService.create(
        s.base().reporterId(),
        thread.threadId(),
        new CreateChatMessageRequest("@" + s.agentUsername() + " 처리해줘"));

    ArgumentCaptor<EventEnvelope> captor = ArgumentCaptor.forClass(EventEnvelope.class);
    verify(client, timeout(2000).times(1)).publish(captor.capture());
    assertThat(captor.getValue().type()).isEqualTo("chat.message.posted");
    assertThat(captor.getValue().payload())
        .containsKeys("threadId", "messageId", "actor", "mentions", "body");
  }

  @Test
  void humanNoMention_doesNotPublish() throws InterruptedException {
    ChatFixtures.Setup s = fx.setup();
    var thread = threadService.getOrCreate(s.reporterId(), s.projectKey(), s.issueNumber());
    messageService.create(s.reporterId(), thread.threadId(), new CreateChatMessageRequest("hi"));
    Thread.sleep(800); // async listener catch
    verify(client, never()).publish(any());
  }
}
