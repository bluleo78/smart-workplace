package com.workplace.notify.push;

import static com.workplace.jooq.Tables.CHANNEL;
import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.USER;
import static org.awaitility.Awaitility.await;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.global.tenant.TenantContext;
import com.workplace.messaging.dto.CreateMessageRequest;
import com.workplace.messaging.service.DmService;
import com.workplace.messaging.service.MessageService;
import com.workplace.support.IntegrationTestBase;
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

/** DM 메시지 커밋 → 상대 기기 푸시 게이트웨이 호출까지 배선 검증. MessagingToAiAgentDispatchTest 와 같은 정리 방식. */
class MessagePushDeliveryTest extends IntegrationTestBase {

  @MockitoBean PushGateway gateway;
  @Autowired DSLContext dsl;
  @Autowired DmService dmService;
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

  private long seedUser() {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "mpd_" + s)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, "Mpd" + s)
            .set(USER.EMAIL, "mpd_" + s + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    users.add(id);
    dsl.insertInto(MEMBERSHIP)
        .set(MEMBERSHIP.USER_ID, id)
        .set(MEMBERSHIP.TENANT_ID, 1L)
        .set(MEMBERSHIP.STATUS, "ACTIVE")
        .execute();
    return id;
  }

  @Test
  void dm_commit_deliversPushToOtherParticipant() {
    long me = seedUser();
    long you = seedUser();
    String ep = "https://203.0.113.10/push/" + UUID.randomUUID();
    subs.upsert(
        you,
        ep,
        EcKeys.b64e(EcKeys.encodePublic((ECPublicKey) EcKeys.generate().getPublic())),
        EcKeys.b64e(new byte[16]),
        null);
    when(gateway.deliver(eq(ep), any(), anyMap())).thenReturn(201);

    long dmId = dmService.createOrGet(me, List.of(you)).dm().id();
    messageService.create(me, dmId, new CreateMessageRequest("안녕하세요"));

    await()
        .atMost(Duration.ofSeconds(5))
        .untilAsserted(() -> verify(gateway).deliver(eq(ep), any(), anyMap()));
  }
}
