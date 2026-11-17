package com.workplace.auth.oauth;

import static com.workplace.jooq.Tables.OAUTH_CONNECTION;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.auth.oauth.repository.OAuthClientRepository;
import com.workplace.auth.oauth.repository.OAuthConnectionRepository;
import com.workplace.auth.outbound.OAuthConnectionCreatedEvent;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

/**
 * WP-1686 — 승인(ALLOW)이 <b>새</b> 연결을 만들 때만 {@link OAuthConnectionCreatedEvent} 를 낸다. 같은 연결을 다시
 * 허용하거나(Claude 가 다시 연결할 때마다) 거부하면 내지 않아 「새 앱 연결」 알림이 쌓이지 않는다. 끊은 뒤 다시 허용하거나 다른 워크스페이스로 허용하면 새 연결이라
 * 다시 낸다.
 *
 * <p>이벤트 발행만 본다 — 클래스 단위 {@code @Transactional} 이라 커밋 뒤 리스너(알림 insert)는 돌지 않는다. 커밋 뒤 인박스까지는 {@link
 * OAuthConnectionNotificationDeliveryTest} 가 본다.
 */
@Transactional
@RecordApplicationEvents
class OAuthConnectionNotificationTest extends IntegrationTestBase {

  private static final long TENANT_ID = 1L;

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired ObjectMapper objectMapper;
  @Autowired OAuthClientRepository clients;
  @Autowired OAuthConnectionRepository connections;
  @Autowired ApplicationEvents events;

  private long userId;
  private long clientPk;
  private String clientId;
  private OAuthTestSupport support;

  @BeforeEach
  void seed() {
    OAuthTestSupport.Seed seed = OAuthTestSupport.seedUserAndClaudeClient(dsl, clients, TENANT_ID);
    userId = seed.userId();
    clientId = seed.clientId();
    clientPk = seed.clientPk();
    // 토큰 엔드포인트를 부르지 않으므로 포트는 쓰지 않는다(승인은 MockMvc).
    support = new OAuthTestSupport(mvc, objectMapper, 0);
  }

  @Test
  void 처음_허용하면_새_연결_이벤트_한_건() throws Exception {
    allow(TENANT_ID);

    assertThat(events.stream(OAuthConnectionCreatedEvent.class))
        .containsExactly(new OAuthConnectionCreatedEvent(TENANT_ID, userId, "Claude"));
  }

  @Test
  void 같은_연결을_다시_허용하면_이벤트가_없다() throws Exception {
    allow(TENANT_ID);
    allow(TENANT_ID);

    assertThat(events.stream(OAuthConnectionCreatedEvent.class)).hasSize(1);
  }

  @Test
  void 거부는_이벤트가_없다() throws Exception {
    deny();

    assertThat(events.stream(OAuthConnectionCreatedEvent.class)).isEmpty();
  }

  @Test
  void 다른_워크스페이스로_허용하면_그_테넌트로_한_건_더() throws Exception {
    long other = TestFixtures.createTenant(dsl, "ACTIVE");
    TestFixtures.ensureActiveMember(dsl, userId, other);

    allow(TENANT_ID);
    allow(other);

    assertThat(events.stream(OAuthConnectionCreatedEvent.class))
        .extracting(OAuthConnectionCreatedEvent::tenantId)
        .containsExactly(TENANT_ID, other);
  }

  @Test
  void 끊은_뒤_다시_허용하면_다시_한_건() throws Exception {
    allow(TENANT_ID);
    long connectionId =
        dsl.select(OAUTH_CONNECTION.ID)
            .from(OAUTH_CONNECTION)
            .where(OAUTH_CONNECTION.USER_ID.eq(userId))
            .and(OAUTH_CONNECTION.CLIENT_PK.eq(clientPk))
            .fetchSingle()
            .value1();
    assertThat(connections.revoke(connectionId, userId)).isTrue();

    allow(TENANT_ID);

    assertThat(events.stream(OAuthConnectionCreatedEvent.class)).hasSize(2);
  }

  /** 실제 승인 API(웹 세션 ALLOW) — 연결을 만들거나 다시 쓴다. */
  private void allow(long tenantId) throws Exception {
    support.obtainCode(userId, clientId, tenantId);
  }

  /** {@link OAuthTestSupport#obtainCode} 와 같은 본문에 decision 만 DENY. */
  private void deny() throws Exception {
    support.decide(userId, clientId, TENANT_ID, "DENY");
  }
}
