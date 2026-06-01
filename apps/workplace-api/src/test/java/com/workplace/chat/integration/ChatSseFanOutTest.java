package com.workplace.chat.integration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;

import com.workplace.chat.dto.CreateChatMessageRequest;
import com.workplace.chat.service.ChatFixtures;
import com.workplace.chat.service.ChatMessageService;
import com.workplace.chat.service.ChatThreadService;
import com.workplace.global.outbound.AiAgentEventClient;
import com.workplace.global.realtime.SseRegistry;
import com.workplace.support.IntegrationTestBase;
import java.util.Collection;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/** chat 메시지 작성 → SSE fan-out 통합. registry 를 mock 으로 가로채 멤버 fan-out 을 검증. */
class ChatSseFanOutTest extends IntegrationTestBase {

  @MockitoBean SseRegistry registry;
  @MockitoBean AiAgentEventClient aiClient; // ai-agent 실제 호출 차단
  @Autowired ChatThreadService threadService;
  @Autowired ChatMessageService messageService;
  @Autowired ChatFixtures fx;

  @Test
  void messageCreate_fansOutToThreadMembers() {
    ChatFixtures.Setup s = fx.setup();
    var thread = threadService.getOrCreate(s.reporterId(), s.projectKey(), s.issueNumber());

    messageService.create(s.reporterId(), thread.threadId(), new CreateChatMessageRequest("hello"));

    @SuppressWarnings("unchecked")
    ArgumentCaptor<Collection<Long>> ids = ArgumentCaptor.forClass(Collection.class);
    verify(registry, timeout(2000)).fanOut(ids.capture(), eq("chat.message.created"), any());
    assertThat(ids.getValue()).contains(s.reporterId());
  }
}
