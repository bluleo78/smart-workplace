package com.workplace.chat.integration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;

import com.workplace.chat.dto.CreateChatMessageRequest;
import com.workplace.chat.service.ChatFixtures;
import com.workplace.chat.service.ChatMessageService;
import com.workplace.chat.service.ChatThreadService;
import com.workplace.global.outbound.AiAgentEventClient;
import com.workplace.global.realtime.SseRegistry;
import com.workplace.support.ExternalClientMockedTestBase;
import java.util.Collection;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;

/** chat 메시지 작성 → SSE fan-out 통합. registry 를 mock 으로 가로채 멤버 fan-out 을 검증. */
class ChatSseFanOutTest extends ExternalClientMockedTestBase {

  @Autowired SseRegistry registry;
  @Autowired AiAgentEventClient aiClient; // ai-agent 실제 호출 차단
  @Autowired ChatThreadService threadService;
  @Autowired ChatMessageService messageService;
  @Autowired ChatFixtures fx;

  // 비-Tx 통합테스트: 커밋된 fixture 데이터를 회수 (project CASCADE + user).
  @AfterEach
  void cleanup() {
    fx.cleanupAll();
  }

  @Test
  void messageCreate_fansOutToThreadMembers() {
    ChatFixtures.Setup s = fx.setup();
    var thread = threadService.getOrCreate(s.reporterId(), s.projectKey(), s.issueNumber());

    messageService.create(s.reporterId(), thread.threadId(), new CreateChatMessageRequest("hello"));

    // 다른 테스트의 늦은 AFTER_COMMIT 이벤트가 이 검증에 잡히지 않도록 받는 사람을 이 테스트 유저로 좁힌다(WP-2059).
    ArgumentCaptor<Object> payload = ArgumentCaptor.forClass(Object.class);
    verify(registry, timeout(2000))
        .fanOut(
            argThat((Collection<Long> ids) -> ids != null && ids.contains(s.reporterId())),
            eq("chat.message.created"),
            payload.capture());
    // 잡은 이벤트가 이 테스트 스레드의 메시지인지 확인(chat payload 는 threadId 를 싣는다)
    assertThat(((Map<?, ?>) payload.getValue()).get("threadId")).isEqualTo(thread.threadId());
  }
}
