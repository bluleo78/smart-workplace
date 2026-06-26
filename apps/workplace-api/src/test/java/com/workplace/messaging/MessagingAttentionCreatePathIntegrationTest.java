package com.workplace.messaging;

import static com.workplace.jooq.Tables.CHANNEL;
import static com.workplace.jooq.Tables.CONVERSATION_ATTENTION;
import static com.workplace.jooq.Tables.MESSAGE;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

import com.workplace.global.tenant.TenantContext;
import com.workplace.messaging.dto.CreateMessageRequest;
import com.workplace.messaging.outbound.AiAgentMessagingClient;
import com.workplace.messaging.outbound.dto.MessagingClassifyResult;
import com.workplace.messaging.repository.ChannelMemberRepository;
import com.workplace.messaging.repository.ChannelRepository;
import com.workplace.messaging.repository.ConversationAttentionRepository;
import com.workplace.messaging.service.MessageService;
import com.workplace.support.IntegrationTestBase;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.context.TestPropertySource;

/**
 * 메시징 어텐션 도착 트리거 production 경로 통합 (#476 C1).
 *
 * <p>{@code MessageService.create()}(@Transactional)를 실제 호출 → 커밋 → MessageCreatedEvent 의
 * AFTER_COMMIT 리스너({@code MessagingAttentionDispatcher}) → @Async 분류 → conversation_attention 기록까지
 * 전체 경로를 검증한다. 커밋 전 직접 호출(레이스) 대신 AFTER_COMMIT 로 전환된 배선이 깨지지 않음을 보장하는 회귀 가드.
 *
 * <p>이 클래스는 @Transactional 을 절대 붙이지 않는다 — 외부 트랜잭션 안에서는 AFTER_COMMIT 이 발화하지 않아 검증이 무력화된다. 커밋된 row 를
 * 추적해 @AfterEach 에서 회수한다. tenant 는 ThreadLocal(TenantContext)로 주입 — @Async 워커에 decorator 가 전파해 새
 * 트랜잭션의 GUC 를 채운다(세션 GUC trick 은 풀 커넥션 전환 시 무력).
 *
 * <p>ai-agent enabled=true override — 어텐션 분류 경로는 enabled 게이트를 받지 않지만, 일관성을 위해 통합 환경에서 활성화한다.
 */
@DisplayName("메시징 어텐션 도착 트리거 → AFTER_COMMIT → async 분류 통합 (#476)")
@TestPropertySource(properties = "workplace.ai-agent.enabled=true")
class MessagingAttentionCreatePathIntegrationTest extends IntegrationTestBase {

  @Autowired MessageService messageService;
  @Autowired ChannelRepository channelRepo;
  @Autowired ChannelMemberRepository memberRepo;
  @Autowired ConversationAttentionRepository attnRepo;
  @Autowired DSLContext dsl;

  /** ai-agent 분류 호출을 모킹 — relevant 반환으로 conversation_attention 기록을 강제. */
  @MockBean AiAgentMessagingClient aiClient;

  private final List<Long> createdChannelIds = new ArrayList<>();
  private final List<Long> createdUserIds = new ArrayList<>();

  /** RLS 게이트: ThreadLocal tenant 주입(decorator 가 @Async 워커로 전파). */
  @BeforeEach
  void tenant() {
    TenantContext.set(1L);
  }

  @AfterEach
  void cleanup() {
    // 커밋된 row 회수 — conversation_attention·message·channel_member 는 channel/user 삭제 전 명시 정리.
    TenantContext.set(1L);
    if (!createdChannelIds.isEmpty()) {
      dsl.deleteFrom(CONVERSATION_ATTENTION)
          .where(CONVERSATION_ATTENTION.CHANNEL_ID.in(createdChannelIds))
          .execute();
      dsl.deleteFrom(MESSAGE).where(MESSAGE.CHANNEL_ID.in(createdChannelIds)).execute();
      dsl.deleteFrom(CHANNEL).where(CHANNEL.ID.in(createdChannelIds)).execute();
    }
    if (!createdUserIds.isEmpty()) {
      dsl.deleteFrom(USER).where(USER.ID.in(createdUserIds)).execute();
    }
    createdChannelIds.clear();
    createdUserIds.clear();
    TenantContext.clear();
  }

  /** USER 행 INSERT 후 id 반환 (USER.NAME = name 정확히 설정 — 이름 프리필터 매핑 기준). */
  private long seedUser(String name) {
    String suffix = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, name + "_" + suffix)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, name)
            .set(USER.EMAIL, name + "_" + suffix + "@example.com")
            .set(USER.KIND, "HUMAN")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    createdUserIds.add(id);
    return id;
  }

  @Test
  @DisplayName("일반 채널 메시지 작성 → 커밋 후 비동기 분류 → conversation_attention 기록")
  void create_normalChannel_triggersAttentionAfterCommit() {
    long owner = seedUser("양동희");
    long author = seedUser("김PM");
    long channelId = channelRepo.insertPublic("attn-create-" + UUID.randomUUID(), owner);
    createdChannelIds.add(channelId);
    memberRepo.add(channelId, owner, "MEMBER");
    memberRepo.add(channelId, author, "MEMBER");

    // 분류는 owner(양동희)를 relevant 로 반환하도록 모킹 — 이름 토큰("동희")이 본문에 등장해 프리필터 통과.
    when(aiClient.classify(any()))
        .thenReturn(
            new MessagingClassifyResult(
                List.of(new MessagingClassifyResult.Relevant(owner, "배포 여부 질문"))));

    // production 경로: 일반 채널 + 멘션 없는 메시지 → create() 커밋 → AFTER_COMMIT → @Async 분류.
    messageService.create(author, channelId, new CreateMessageRequest("동희가 배포했나?"));

    // 비동기 분류 완료 대기 — conversation_attention 에 owner 마크가 기록되어야 한다.
    final long markedUser = owner;
    final long ch = channelId;
    await()
        .atMost(Duration.ofSeconds(5))
        .untilAsserted(
            () -> {
              TenantContext.set(1L);
              assertThat(attnRepo.isFlagged(ch, markedUser)).isTrue();
            });
  }
}
