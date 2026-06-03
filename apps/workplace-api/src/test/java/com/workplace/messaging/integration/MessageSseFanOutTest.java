package com.workplace.messaging.integration;

import static com.workplace.jooq.Tables.CHANNEL;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;

import com.workplace.global.realtime.SseRegistry;
import com.workplace.messaging.dto.CreateMessageRequest;
import com.workplace.messaging.repository.ChannelRepository;
import com.workplace.messaging.service.ChannelService;
import com.workplace.messaging.service.MessageService;
import com.workplace.support.IntegrationTestBase;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/**
 * 메시지 작성 → SSE fan-out 통합 테스트.
 *
 * <p>SseRegistry 를 MockitoBean 으로 가로채어, 메시지 생성 후 AFTER_COMMIT 에 해당 채널 멤버에게
 * "messaging.message.created" 이벤트가 fan-out 되는지 검증한다.
 */
class MessageSseFanOutTest extends IntegrationTestBase {

  /** SseRegistry 를 mock 으로 대체해 실제 SSE 연결 없이 fan-out 호출을 캡처한다. */
  @MockitoBean SseRegistry registry;

  @Autowired DSLContext dsl;
  @Autowired ChannelService channelService;
  @Autowired MessageService messageService;
  @Autowired ChannelRepository channelRepo;

  // 비-Tx(AFTER_COMMIT 이벤트 검증) 테스트: 만든 user id 추적 → @AfterEach 에서 채널(CASCADE)+user 회수.
  private final List<Long> createdUserIds = new ArrayList<>();

  @AfterEach
  void cleanup() {
    if (createdUserIds.isEmpty()) return;
    dsl.deleteFrom(CHANNEL).where(CHANNEL.CREATED_BY.in(createdUserIds)).execute();
    dsl.deleteFrom(USER).where(USER.ID.in(createdUserIds)).execute();
    createdUserIds.clear();
  }

  /** 테스트 격리를 위해 UUID suffix 로 유니크 유저를 직접 INSERT 후 ID 반환. */
  private long seedUser() {
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").substring(0, 8);
    long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "msg_sse_" + suffix)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, "MsgSse" + suffix)
            .set(USER.EMAIL, "msgsse_" + suffix + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    createdUserIds.add(id);
    return id;
  }

  /**
   * 메시지 생성 후 채널 멤버에게 SSE fan-out 이 전달되는지 검증한다.
   *
   * <p>MessageService.create() 가 @Transactional 트랜잭션 커밋 후 AFTER_COMMIT 이벤트를 발행하고,
   * MessageSseDispatcher 가 SseRegistry.fanOut() 을 호출하는 전체 흐름을 커버. Mockito timeout(2000) 으로 비동기
   * AFTER_COMMIT 타이밍을 수용한다.
   */
  @Test
  void messageCreate_fansOutToChannelMembers() {
    // given: 유저 생성, 퍼블릭 채널 생성, 채널 가입
    long uid = seedUser();
    long channelId = channelRepo.insertPublic("fan-out-test", uid);
    channelService.join(uid, channelId);

    // when: 메시지 작성 (서비스 @Transactional → 커밋 후 이벤트 발행)
    messageService.create(uid, channelId, new CreateMessageRequest("실시간"));

    // then: AFTER_COMMIT 이후 SseRegistry.fanOut() 이 호출되어 해당 유저가 수신 목록에 포함됨
    @SuppressWarnings("unchecked")
    ArgumentCaptor<Collection<Long>> ids = ArgumentCaptor.forClass(Collection.class);
    verify(registry, timeout(2000)).fanOut(ids.capture(), eq("messaging.message.created"), any());
    assertThat(ids.getValue()).contains(uid);
  }
}
