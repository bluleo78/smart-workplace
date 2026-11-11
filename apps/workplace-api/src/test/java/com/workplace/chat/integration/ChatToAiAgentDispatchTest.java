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
import com.workplace.support.ExternalClientMockedTestBase;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * chat 메시지 → ai-agent webhook 발사 통합. ai-agent client 를 MockitoBean 으로 가로채 호출 검증. enabled=true 강제.
 */
class ChatToAiAgentDispatchTest extends ExternalClientMockedTestBase {

  @Autowired AiAgentEventClient client;
  @Autowired ChatThreadService threadService;
  @Autowired ChatMessageService messageService;
  @Autowired ChatThreadMemberRepository memberRepo;
  @Autowired ChatFixtures fx;

  // 비-Tx 통합테스트: 커밋된 fixture 데이터를 회수 (project CASCADE + user).
  @AfterEach
  void cleanup() {
    fx.cleanupAll();
  }

  @Test
  void humanWithAgentMention_publishesOnce() {
    ChatFixtures.AgentSetup s = fx.setupWithAgent();
    var thread =
        threadService.getOrCreate(
            s.base().reporterId(), s.base().projectKey(), s.base().issueNumber());
    // AGENT 도 thread 멤버로 직접 추가 (mention resolve 단계와 무관 — mention 은 <@id> 토큰으로 작동).
    memberRepo.insertIgnoreConflict(thread.threadId(), List.of(s.agentId()));

    messageService.create(
        s.base().reporterId(),
        thread.threadId(),
        new CreateChatMessageRequest("<@" + s.agentId() + "> 처리해줘"));

    ArgumentCaptor<EventEnvelope> captor = ArgumentCaptor.forClass(EventEnvelope.class);
    // 비동기 리스너가 부르기를 기다린다 — 전체 회귀 부하에서는 2초를 넘겨 실패했다(v0.9.50 push). 오면 곧바로 끝나므로 상한만 넉넉히 둔다.
    verify(client, timeout(15000).times(1)).publish(captor.capture());
    assertThat(captor.getValue().type()).isEqualTo("chat.message.posted");
    assertThat(captor.getValue().payload())
        .containsKeys("threadId", "messageId", "actor", "mentions", "body");
  }

  /**
   * WP-1492: 대화에 아직 없는 프로젝트 AI 를 멘션해도 그 AI 가 깨어난다 — 서버가 멘션된 AI 를 스레드 멤버로 넣고(add-only) 실행 이벤트를 보낸다.
   * 웹 이슈챗 @ 후보가 비참여 프로젝트 AI 를 보이는 근거.
   */
  @Test
  void humanMentionsNonParticipantProjectAgent_joinsThreadAndPublishes() {
    ChatFixtures.AgentSetup s = fx.setupWithAgent();
    var thread =
        threadService.getOrCreate(
            s.base().reporterId(), s.base().projectKey(), s.base().issueNumber());
    assertThat(memberRepo.isMember(thread.threadId(), s.agentId())).isFalse();

    messageService.create(
        s.base().reporterId(),
        thread.threadId(),
        new CreateChatMessageRequest("<@" + s.agentId() + "> 처리해줘"));

    ArgumentCaptor<EventEnvelope> captor = ArgumentCaptor.forClass(EventEnvelope.class);
    verify(client, timeout(15000).times(1)).publish(captor.capture());
    assertThat(captor.getValue().type()).isEqualTo("chat.message.posted");
    // 멘션한 그 AI 가 대행 실행 AI 로 실린다(깨어남).
    assertThat(captor.getValue().payload()).containsEntry("actingAgentId", s.agentId());
    assertThat(memberRepo.isMember(thread.threadId(), s.agentId())).isTrue();
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
