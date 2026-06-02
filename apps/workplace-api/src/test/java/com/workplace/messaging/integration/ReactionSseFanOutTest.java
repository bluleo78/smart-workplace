package com.workplace.messaging.integration;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;

import com.workplace.global.realtime.SseRegistry;
import com.workplace.messaging.dto.CreateMessageRequest;
import com.workplace.messaging.repository.ChannelRepository;
import com.workplace.messaging.service.ChannelService;
import com.workplace.messaging.service.MessageService;
import com.workplace.messaging.service.ReactionService;
import com.workplace.support.IntegrationTestBase;
import java.util.Collection;
import java.util.Map;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/**
 * 리액션 추가/제거 → SSE fan-out 통합 테스트.
 *
 * <p>SseRegistry 를 MockitoBean 으로 가로채어, 리액션 변경 후 AFTER_COMMIT 에 해당 채널 멤버에게
 * "messaging.reaction.added" / "messaging.reaction.removed" 이벤트가 fan-out 되는지 검증한다.
 */
class ReactionSseFanOutTest extends IntegrationTestBase {

  /** SseRegistry 를 mock 으로 대체해 실제 SSE 연결 없이 fan-out 호출을 캡처한다. */
  @MockitoBean SseRegistry registry;

  @Autowired DSLContext dsl;
  @Autowired ChannelService channelService;
  @Autowired MessageService messageService;
  @Autowired ReactionService reactionService;
  @Autowired ChannelRepository channelRepo;

  /** 테스트 격리를 위해 UUID suffix 로 유니크 유저를 직접 INSERT 후 ID 반환. */
  private long seedUser() {
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "rxsse_" + suffix)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "RxSse" + suffix)
        .set(USER.EMAIL, "rxsse_" + suffix + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  /**
   * 리액션 추가 후 채널 멤버에게 "messaging.reaction.added" SSE 이벤트가 fan-out 되는지 검증한다.
   *
   * <p>payload 에 messageId, emoji, userId 가 올바르게 포함되는지 확인. Mockito timeout(2000) 으로 비동기
   * AFTER_COMMIT 타이밍을 수용한다.
   */
  @Test
  void reactionAdd_fansOutAddedEvent() {
    // given: 유저 생성, 퍼블릭 채널 생성, 채널 가입, 메시지 작성
    long uid = seedUser();
    long channelId = channelRepo.insertPublic("rx-sse-add-test", uid);
    channelService.join(uid, channelId);
    long messageId = messageService.create(uid, channelId, new CreateMessageRequest("hi")).id();

    // when: 리액션 추가 (@Transactional 커밋 후 AFTER_COMMIT 이벤트 발행)
    reactionService.add(uid, messageId, "👍");

    // then: SseRegistry.fanOut() 이 "messaging.reaction.added" 이벤트로 호출되고
    //       payload 에 messageId 와 emoji 가 올바르게 포함된다
    @SuppressWarnings("unchecked")
    ArgumentCaptor<Collection<Long>> ids = ArgumentCaptor.forClass(Collection.class);
    @SuppressWarnings("unchecked")
    ArgumentCaptor<Map<String, Object>> payload = ArgumentCaptor.forClass(Map.class);
    verify(registry, timeout(2000))
        .fanOut(ids.capture(), eq("messaging.reaction.added"), payload.capture());
    assertThat(ids.getValue()).contains(uid);
    assertThat(payload.getValue()).containsEntry("messageId", messageId);
    assertThat(payload.getValue()).containsEntry("emoji", "👍");
  }

  /**
   * 리액션 제거 후 채널 멤버에게 "messaging.reaction.removed" SSE 이벤트가 fan-out 되는지 검증한다.
   *
   * <p>먼저 add 로 리액션을 등록한 뒤 remove 호출. registry mock 을 리셋해 remove 이벤트만 검증한다.
   */
  @Test
  void reactionRemove_fansOutRemovedEvent() {
    // given: 유저 생성, 퍼블릭 채널 생성, 채널 가입, 메시지 작성 후 리액션 추가
    long uid = seedUser();
    long channelId = channelRepo.insertPublic("rx-sse-rm-test", uid);
    channelService.join(uid, channelId);
    long messageId = messageService.create(uid, channelId, new CreateMessageRequest("hi")).id();
    reactionService.add(uid, messageId, "❤️");

    // mock 호출 기록 초기화 (add 이벤트와 분리)
    org.mockito.Mockito.reset(registry);

    // when: 리액션 제거
    reactionService.remove(uid, messageId, "❤️");

    // then: SseRegistry.fanOut() 이 "messaging.reaction.removed" 이벤트로 호출되고
    //       payload 에 messageId 와 emoji 가 올바르게 포함된다
    @SuppressWarnings("unchecked")
    ArgumentCaptor<Collection<Long>> ids = ArgumentCaptor.forClass(Collection.class);
    @SuppressWarnings("unchecked")
    ArgumentCaptor<Map<String, Object>> payload = ArgumentCaptor.forClass(Map.class);
    verify(registry, timeout(2000))
        .fanOut(ids.capture(), eq("messaging.reaction.removed"), payload.capture());
    assertThat(ids.getValue()).contains(uid);
    assertThat(payload.getValue()).containsEntry("messageId", messageId);
    assertThat(payload.getValue()).containsEntry("emoji", "❤️");
  }
}
