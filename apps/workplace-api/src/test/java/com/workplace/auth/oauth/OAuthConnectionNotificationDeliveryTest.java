package com.workplace.auth.oauth;

import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.NOTIFICATION;
import static com.workplace.jooq.Tables.OAUTH_CLIENT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

import com.workplace.auth.oauth.repository.OAuthClientRepository;
import com.workplace.support.ExternalClientMockedTestBase;
import java.time.Duration;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationContext;
import org.springframework.test.web.servlet.MockMvc;
import tools.jackson.databind.ObjectMapper;

/**
 * WP-1686 — 승인(ALLOW)이 커밋되면 커밋 뒤 리스너가 연결한 본인의 인박스에 「새 앱 연결」(OAUTH_APP_CONNECTED)을 넣는다. 앱 이름은
 * message 에 실린다(인박스가 「Claude」를 보인다).
 *
 * <p>AFTER_COMMIT 리스너가 돌아야 하므로 비-{@code @Transactional} 이다. 만든 행은 {@code @AfterEach} 에서 직접 지운다 —
 * 알림, 감사(새 연결 감사가 커밋된다), 사용자(멤버십·연결·code 는 CASCADE), DCR 클라이언트.
 */
class OAuthConnectionNotificationDeliveryTest extends ExternalClientMockedTestBase {

  private static final long TENANT_ID = 1L;

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired ObjectMapper objectMapper;
  @Autowired OAuthClientRepository clients;

  /** 정리 전에 비동기 풀(커밋 뒤 알림)이 비기를 기다리려고 쓴다. */
  @Autowired ApplicationContext asyncPoolContext;

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

  @AfterEach
  void cleanup() {
    // 커밋 뒤 알림을 넣는 일이 아직 돌고 있으면 지운 뒤에 행이 생기거나 사용자 삭제와 엇갈린다 — 풀이 빈 뒤 알림부터 지운다.
    OAuthTestSupport.deleteAppConnectedNotices(
        asyncPoolContext, dsl, this::cleanupInTenant, TENANT_ID, List.of(userId));
    cleanupInTenant(
        TENANT_ID,
        () -> {
          dsl.deleteFrom(AUDIT_LOG).where(AUDIT_LOG.USER_ID.eq(userId)).execute();
          // 멤버십·oauth_connection·code 는 user 삭제 CASCADE.
          dsl.deleteFrom(USER).where(USER.ID.eq(userId)).execute();
          dsl.deleteFrom(OAUTH_CLIENT).where(OAUTH_CLIENT.ID.eq(clientPk)).execute();
        });
  }

  @Test
  void 허용이_커밋되면_본인_인박스에_새_앱_연결이_들어온다() throws Exception {
    support.obtainCode(userId, clientId, TENANT_ID);

    await()
        .atMost(Duration.ofSeconds(5))
        .untilAsserted(
            () ->
                assertThat(
                        callInTenant(
                            TENANT_ID,
                            () ->
                                dsl.fetchCount(
                                    NOTIFICATION,
                                    NOTIFICATION
                                        .RECIPIENT_ID
                                        .eq(userId)
                                        .and(NOTIFICATION.TYPE.eq("OAUTH_APP_CONNECTED"))
                                        .and(NOTIFICATION.MESSAGE.eq("Claude"))
                                        .and(NOTIFICATION.ACTOR_ID.isNull()))))
                    .isEqualTo(1));
  }
}
