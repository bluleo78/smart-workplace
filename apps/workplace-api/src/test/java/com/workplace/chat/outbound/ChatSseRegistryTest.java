package com.workplace.chat.outbound;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

class ChatSseRegistryTest {

  private final ChatSseRegistry registry = new ChatSseRegistry(new ObjectMapper());

  @Test
  void register_returnsEmitterAndCounts() {
    SseEmitter e = registry.register(1L);
    assertThat(e).isNotNull();
    assertThat(registry.connectedUserCount()).isEqualTo(1);
  }

  @Test
  void fanOut_toRegisteredUsersOnly_doesNotThrow() {
    registry.register(1L);
    registry.register(2L);
    // user 3 미등록 → skip. 예외 없이 동작하고 연결 유저 수는 2 유지.
    registry.fanOut(List.of(1L, 3L), "chat.message.created", Map.of("threadId", 5));
    assertThat(registry.connectedUserCount()).isEqualTo(2);
  }
}
