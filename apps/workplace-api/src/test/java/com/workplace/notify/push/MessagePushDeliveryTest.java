package com.workplace.notify.push;

import static com.workplace.jooq.Tables.CHANNEL;
import static com.workplace.jooq.Tables.USER;
import static org.awaitility.Awaitility.await;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.global.tenant.TenantContext;
import com.workplace.messaging.dto.CreateMessageRequest;
import com.workplace.messaging.repository.ChannelMemberRepository;
import com.workplace.messaging.service.ChannelService;
import com.workplace.messaging.service.DmService;
import com.workplace.messaging.service.MessageService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.security.interfaces.ECPublicKey;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/** DM·채널 멘션 메시지 커밋 → 대상 기기 푸시 게이트웨이 호출까지 배선 검증. MessagingToAiAgentDispatchTest 와 같은 정리 방식. */
class MessagePushDeliveryTest extends IntegrationTestBase {

  @MockitoBean PushGateway gateway;
  @Autowired DSLContext dsl;
  @Autowired DmService dmService;
  @Autowired ChannelService channelService;
  @Autowired ChannelMemberRepository memberRepo;
  @Autowired MessageService messageService;
  @Autowired PushSubscriptionRepository subs;

  final List<Long> users = new ArrayList<>();

  @BeforeEach
  void tenant() {
    TenantContext.set(1L);
  }

  @AfterEach
  void cleanup() {
    TenantContext.clear();
    if (users.isEmpty()) return;
    dsl.deleteFrom(CHANNEL).where(CHANNEL.CREATED_BY.in(users)).execute();
    dsl.deleteFrom(USER).where(USER.ID.in(users)).execute();
    users.clear();
  }

  /** 공용 픽스처 + 테넌트#1 멤버십(DM·채널 생성 가드 통과용). 커밋되는 테스트라 정리 대상에 등록한다. */
  private long seedUser() {
    long id = withMembership(TestFixtures.createHuman(dsl));
    users.add(id);
    return id;
  }

  /** 수신자 기기 구독 1건 등록 후 endpoint 반환. */
  private String subscribe(long userId) {
    String ep = "https://203.0.113.10/push/" + UUID.randomUUID();
    subs.upsert(
        userId,
        ep,
        EcKeys.b64e(EcKeys.encodePublic((ECPublicKey) EcKeys.generate().getPublic())),
        EcKeys.b64e(new byte[16]),
        null);
    return ep;
  }

  @Test
  void dm_commit_deliversPushToOtherParticipant() {
    long me = seedUser();
    long you = seedUser();
    String ep = subscribe(you);
    when(gateway.deliver(eq(ep), any(), anyMap())).thenReturn(PushGateway.Result.of(201));

    long dmId = dmService.createOrGet(me, List.of(you)).dm().id();
    messageService.create(me, dmId, new CreateMessageRequest("안녕하세요"));

    await()
        .atMost(Duration.ofSeconds(5))
        .untilAsserted(() -> verify(gateway).deliver(eq(ep), any(), anyMap()));
  }

  /**
   * 채널 멘션 경로 — 커밋 후 pushExecutor 스레드의 resolver 트랜잭션에서 채널 종류·멤버·채널명(RLS 테이블) 조회가 tenant GUC 와 함께
   * 동작해야 멘션 대상에게 발송된다(GUC 가 없으면 조용히 "대상 없음"이 되므로 실제 커밋으로 검증).
   */
  @Test
  void channelMention_commit_deliversPushToMentionedMember() {
    long me = seedUser();
    long member = seedUser();
    long ch =
        channelService
            .create(me, "mpd-" + UUID.randomUUID().toString().substring(0, 8), "PUBLIC")
            .id();
    memberRepo.add(ch, member, "MEMBER");
    String ep = subscribe(member);
    when(gateway.deliver(eq(ep), any(), anyMap())).thenReturn(PushGateway.Result.of(201));

    messageService.create(me, ch, new CreateMessageRequest("<@" + member + "> 확인 부탁"));

    await()
        .atMost(Duration.ofSeconds(5))
        .untilAsserted(() -> verify(gateway).deliver(eq(ep), any(), anyMap()));
  }
}
