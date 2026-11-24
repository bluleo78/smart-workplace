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
import com.workplace.support.ExternalClientMockedTestBase;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * 메시지 작성 → SSE fan-out 통합 테스트.
 *
 * <p>SseRegistry 를 MockitoBean 으로 가로채어, 메시지 생성 후 AFTER_COMMIT 에 해당 채널 멤버에게
 * "messaging.message.created" 이벤트가 fan-out 되는지 검증한다.
 */
class MessageSseFanOutTest extends ExternalClientMockedTestBase {

  /** SseRegistry 를 mock 으로 대체해 실제 SSE 연결 없이 fan-out 호출을 캡처한다. */
  @Autowired SseRegistry registry;

  @Autowired DSLContext dsl;
  @Autowired ChannelService channelService;
  @Autowired MessageService messageService;
  @Autowired ChannelRepository channelRepo;

  /** REST 응답을 쓰는 Boot 매퍼 — SSE payload 의 시각 형식이 REST 와 같은지 견준다(WP-2046). */
  @Autowired JsonMapper jsonMapper;

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

  /**
   * WP-2046: SSE 로 나가는 메시지의 createdAt 이 REST 응답과 같은 ISO 문자열이어야 한다.
   *
   * <p>SSE payload 를 정적 매퍼(Jackson 2 기본값 — 시각을 epoch 숫자로 씀)로 직렬화해 createdAt 이 {@code 1795518215.83}
   * 처럼 나가, 웹이 날짜로 읽지 못하고 채팅 화면 전체가 오류로 깨졌다. 실제 발행 경로가 쓰는 {@link SseRegistry#toJson} 으로 직렬화해 본다.
   */
  @Test
  void messageCreate_SSE_payload_시각은_REST_와_같은_ISO_문자열이다() {
    long uid = seedUser();
    long channelId = channelRepo.insertPublic("sse-date-test", uid);
    channelService.join(uid, channelId);

    messageService.create(uid, channelId, new CreateMessageRequest("시각 형식"));

    ArgumentCaptor<Object> payload = ArgumentCaptor.forClass(Object.class);
    verify(registry, timeout(2000))
        .fanOut(any(), eq("messaging.message.created"), payload.capture());
    JsonNode sse = jsonMapper.readTree(SseRegistry.toJson(payload.getValue()));
    JsonNode rest = jsonMapper.readTree(jsonMapper.writeValueAsString(payload.getValue()));
    assertThat(sse.get("createdAt").isString())
        .as("SSE createdAt: %s", sse.get("createdAt"))
        .isTrue();
    // payload 전체가 REST 직렬화와 같아야 한다(날짜 외 필드도 어긋나지 않음)
    assertThat(sse).isEqualTo(rest);
  }
}
