package com.workplace.messaging.integration;

import static com.workplace.jooq.Tables.CHANNEL;
import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;

import com.workplace.global.outbound.AiAgentEventClient;
import com.workplace.global.outbound.EventEnvelope;
import com.workplace.global.tenant.TenantContext;
import com.workplace.messaging.dto.CreateMessageRequest;
import com.workplace.messaging.repository.ChannelMemberRepository;
import com.workplace.messaging.repository.ChannelRepository;
import com.workplace.messaging.service.ChannelService;
import com.workplace.messaging.service.MessageService;
import com.workplace.support.IntegrationTestBase;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import java.util.stream.Collectors;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/** 메시지 → ai-agent 발사 결정 테이블 검증. client 를 MockitoBean 으로 가로채 호출 검증. enabled=true 강제. */
@TestPropertySource(properties = "workplace.ai-agent.enabled=true")
class MessagingToAiAgentDispatchTest extends IntegrationTestBase {

  @MockitoBean AiAgentEventClient client;
  @Autowired DSLContext dsl;
  @Autowired MessageService messageService;
  @Autowired ChannelService channelService;
  @Autowired ChannelRepository channelRepo;
  @Autowired ChannelMemberRepository memberRepo;

  // 비-Tx(커밋) 테스트: 만든 user id 추적 → @AfterEach 에서 채널(created_by, CASCADE)+멤버십+user 회수.
  private final List<Long> createdUserIds = new ArrayList<>();

  /** 각 테스트 전 TenantContext 를 tenant#1 로 설정 — AGENT 멤버십 검증 통과를 위한 전제 조건. */
  @BeforeEach
  void setTenantContext() {
    TenantContext.set(1L);
  }

  @AfterEach
  void cleanup() {
    TenantContext.clear(); // ThreadLocal 누수 방지
    if (createdUserIds.isEmpty()) return;
    dsl.deleteFrom(CHANNEL).where(CHANNEL.CREATED_BY.in(createdUserIds)).execute();
    // USER 삭제 → membership.user_id FK 의 ON DELETE CASCADE 로 멤버십 행도 자동 삭제(V44).
    // (app_tenant 는 membership DELETE 권한이 없지만, FK CASCADE 는 제약 소유자 권한으로 실행되어 통과.)
    dsl.deleteFrom(USER).where(USER.ID.in(createdUserIds)).execute();
    createdUserIds.clear();
  }

  /**
   * UUID suffix 로 격리된 테스트 유저 INSERT 후 id 반환. kind 미지정 → HUMAN(DB 기본값). tenant#1 ACTIVE 멤버십도 함께 부여하여
   * 채널 AGENT 멤버 추가 시 테넌트 경계 검증을 통과시킨다(same-tenant 사용자).
   */
  private long seedUser(String kind) {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    var step =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "m7_" + s)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, "M7" + s)
            .set(USER.EMAIL, "m7_" + s + "@example.com");
    if ("AGENT".equals(kind)) {
      step = step.set(USER.KIND, "AGENT");
    }
    long id = step.returning(USER.ID).fetchOne().getId();
    createdUserIds.add(id);
    // tenant#1 ACTIVE 멤버십 부여 — same-tenant 사용자로 취급.
    dsl.insertInto(MEMBERSHIP)
        .set(MEMBERSHIP.USER_ID, id)
        .set(MEMBERSHIP.TENANT_ID, 1L)
        .set(MEMBERSHIP.STATUS, "ACTIVE")
        .execute();
    return id;
  }

  /**
   * tenant#1 멤버십 없이 AGENT 유저만 INSERT — 교차테넌트(현재 테넌트 비멤버) AGENT 시뮬레이션. 멤버십 검증에서 걸러져야 하는 음성 케이스 전용.
   */
  private long seedAgentWithoutTenantMembership() {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "m7x_" + s)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, "M7x" + s)
            .set(USER.EMAIL, "m7x_" + s + "@example.com")
            .set(USER.KIND, "AGENT")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    createdUserIds.add(id);
    return id;
  }

  /** 정렬된 memberId 조합 → member_key (DmService 와 동일 규칙). DM 채널 생성 후 멤버 추가. */
  private long seedDm(long... memberIds) {
    String key =
        Arrays.stream(memberIds)
            .sorted()
            .mapToObj(String::valueOf)
            .collect(Collectors.joining(","));
    long channelId = channelRepo.insertDm(key, memberIds[0]);
    for (long id : memberIds) memberRepo.add(channelId, id, "MEMBER");
    return channelId;
  }

  /** 공개 채널에서 사람이 AGENT 를 @멘션하면 ai-agent 이벤트가 1회 발사되고, AGENT 가 채널 멤버로 자동 추가된다. */
  @Test
  void channel_humanMentionsAgent_publishesOnce_andAgentJoined() {
    long human = seedUser("HUMAN");
    long agent = seedUser("AGENT");
    long channelId = channelRepo.insertPublic("c7", human);
    channelService.join(human, channelId);

    messageService.create(human, channelId, new CreateMessageRequest("<@" + agent + "> 처리해줘"));

    ArgumentCaptor<EventEnvelope> captor = ArgumentCaptor.forClass(EventEnvelope.class);
    verify(client, timeout(2000).times(1)).publish(captor.capture());
    assertThat(captor.getValue().type()).isEqualTo("messaging.message.posted");
    assertThat(captor.getValue().payload())
        .containsKeys(
            "channelId",
            "channelKind",
            "messageId",
            "respondAsAgentId",
            "actor",
            "mentions",
            "body");
    assertThat(captor.getValue().payload().get("respondAsAgentId")).isEqualTo(agent);
    assertThat(memberRepo.isMember(channelId, agent)).isTrue();
  }

  /**
   * 공개 채널에서 현재 테넌트의 멤버가 아닌(교차테넌트) AGENT 를 멘션하면, 그 AGENT 는 채널에 추가되지 않고 이벤트도 발사되지 않는다. 단, 메시지 전송 자체는
   * 성공해야 한다(거부가 아닌 조용한 무시) — 설계 §4 의 멤버십 경계 검증.
   */
  @Test
  void channel_humanMentionsCrossTenantAgent_skipsAdd_andDoesNotPublish()
      throws InterruptedException {
    long human = seedUser("HUMAN");
    long crossTenantAgent = seedAgentWithoutTenantMembership(); // tenant#1 멤버십 없음
    long channelId = channelRepo.insertPublic("c7x", human);
    channelService.join(human, channelId);

    // 메시지 전송은 예외 없이 성공해야 한다(거부 아님).
    var saved =
        messageService.create(
            human, channelId, new CreateMessageRequest("<@" + crossTenantAgent + "> 처리해줘"));
    assertThat(saved.body()).contains("처리해줘");

    // 교차테넌트 AGENT 는 채널 멤버로 추가되지 않고, AI 이벤트도 발사되지 않는다.
    Thread.sleep(800);
    assertThat(memberRepo.isMember(channelId, crossTenantAgent)).isFalse();
    verify(client, never()).publish(any());
  }

  /** 공개 채널에서 사람이 AGENT 를 언급하지 않으면 이벤트가 발사되지 않는다. */
  @Test
  void channel_humanNoAgentMention_doesNotPublish() throws InterruptedException {
    long human = seedUser("HUMAN");
    long channelId = channelRepo.insertPublic("c7b", human);
    channelService.join(human, channelId);
    messageService.create(human, channelId, new CreateMessageRequest("그냥 메시지"));
    Thread.sleep(800);
    verify(client, never()).publish(any());
  }

  /** 1:1 DM 에서 사람이 메시지를 보내면 상대 AGENT 를 respondAsAgentId 로 담아 이벤트가 발사된다. */
  @Test
  void dm1to1_humanMessage_publishesWithPartnerAgent() {
    long human = seedUser("HUMAN");
    long agent = seedUser("AGENT");
    long dmId = seedDm(human, agent);

    messageService.create(human, dmId, new CreateMessageRequest("안녕 AI"));

    ArgumentCaptor<EventEnvelope> captor = ArgumentCaptor.forClass(EventEnvelope.class);
    verify(client, timeout(2000).times(1)).publish(captor.capture());
    assertThat(captor.getValue().payload().get("respondAsAgentId")).isEqualTo(agent);
    assertThat(captor.getValue().payload().get("channelKind")).isEqualTo("DM");
  }

  /** 1:1 DM 에서 AGENT 가 직접 메시지를 작성하면 self-loop 가드로 이벤트가 발사되지 않는다. */
  @Test
  void dm1to1_agentAuthoredMessage_doesNotPublish() throws InterruptedException {
    long human = seedUser("HUMAN");
    long agent = seedUser("AGENT");
    long dmId = seedDm(human, agent);
    messageService.create(agent, dmId, new CreateMessageRequest("AI 응답 메시지"));
    Thread.sleep(800);
    verify(client, never()).publish(any());
  }

  /** 1:1 DM 이 사람↔사람 이면 AGENT 가 없으므로 이벤트가 발사되지 않는다. */
  @Test
  void dm1to1_humanToHuman_doesNotPublish() throws InterruptedException {
    long a = seedUser("HUMAN");
    long b = seedUser("HUMAN");
    long dmId = seedDm(a, b);
    messageService.create(a, dmId, new CreateMessageRequest("hi"));
    Thread.sleep(800);
    verify(client, never()).publish(any());
  }
}
