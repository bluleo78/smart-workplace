package com.workplace.auth.service;

import static com.workplace.jooq.Tables.AGENT_API_KEY;
import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.auth.dto.IssueAgentKeyRequest;
import com.workplace.global.realtime.SseRegistry;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.OffsetDateTime;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * WP-2008 — AI 키를 폐기하거나 AI 를 지우면 그 키로 연 이벤트 스트림이 닫히고, 다른 파드에서 일어난 폐기는 30초 주기 확인({@link
 * AgentKeyStreamCloser#revalidate})이 잡는다. 커밋 뒤 리스너를 보므로 테스트 트랜잭션 없이 실제로 커밋하고 직접 정리한다.
 */
class AgentKeyStreamCloserTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired AgentApiKeyService keyService;
  @Autowired AgentRemovalService removal;
  @Autowired AgentKeyStreamCloser closer;
  @Autowired SseRegistry registry;

  private long admin;
  private long agent;
  private long k1;
  private long k2;
  private SseEmitter s1;
  private SseEmitter s2;

  @BeforeEach
  void seed() {
    callInTenant(
        1L,
        () -> {
          admin = TestFixtures.createHuman(dsl);
          TestFixtures.addMember(dsl, admin, 1L);
          agent = TestFixtures.createAgentNoToken(dsl);
          TestFixtures.addMember(dsl, agent, 1L);
          k1 = keyService.issue(admin, agent, new IssueAgentKeyRequest("k1")).id();
          k2 = keyService.issue(admin, agent, new IssueAgentKeyRequest("k2")).id();
          return null;
        });
    s1 = registry.register(agent, k1);
    s2 = registry.register(agent, k2);
  }

  @AfterEach
  void cleanup() {
    registry.closeAll(agent);
    cleanupInTenant(
        1L,
        () -> {
          dsl.deleteFrom(AGENT_API_KEY).where(AGENT_API_KEY.USER_ID.eq(agent)).execute();
          dsl.deleteFrom(AUDIT_LOG).where(AUDIT_LOG.USER_ID.in(admin, agent)).execute();
          dsl.deleteFrom(USER).where(USER.ID.in(agent, admin)).execute();
        });
  }

  /** emitter 가 이미 complete 됐는지 — complete 된 emitter 에 보내면 IllegalStateException. */
  private static boolean isClosed(SseEmitter emitter) {
    try {
      emitter.send(SseEmitter.event().comment("probe"));
      return false;
    } catch (IllegalStateException e) {
      return true;
    } catch (java.io.IOException e) {
      return false;
    }
  }

  @Test
  void revoke_closesThatKeysStreamOnly() {
    callInTenant(
        1L,
        () -> {
          keyService.revoke(admin, agent, k1);
          return null;
        });

    assertThat(isClosed(s1)).isTrue();
    assertThat(isClosed(s2)).isFalse();
    assertThat(registry.openAgentKeyIds()).contains(k2).doesNotContain(k1);
  }

  @Test
  void revokeRolledBack_keepsStream() {
    assertThatThrownBy(
            () ->
                callInTenant(
                    1L,
                    () -> {
                      keyService.revoke(admin, agent, k1);
                      throw new IllegalStateException("rollback");
                    }))
        .isInstanceOf(IllegalStateException.class);

    assertThat(isClosed(s1)).isFalse();
    assertThat(registry.openAgentKeyIds()).contains(k1, k2);
  }

  @Test
  void revalidate_closesStreamOfRevokedKeyFromOtherPod() {
    // 다른 파드에서 회수된 것처럼 이벤트 없이 DB 만 바꾼다.
    dsl.update(AGENT_API_KEY)
        .set(AGENT_API_KEY.REVOKED_AT, OffsetDateTime.now())
        .where(AGENT_API_KEY.ID.eq(k1))
        .execute();

    closer.revalidate();

    assertThat(isClosed(s1)).isTrue();
    assertThat(isClosed(s2)).isFalse();
    assertThat(registry.openAgentKeyIds()).contains(k2).doesNotContain(k1);
  }

  @Test
  void revalidate_closesStreamOfDeletedKey() {
    dsl.deleteFrom(AGENT_API_KEY).where(AGENT_API_KEY.ID.eq(k1)).execute();

    closer.revalidate();

    assertThat(isClosed(s1)).isTrue();
    assertThat(isClosed(s2)).isFalse();
  }

  @Test
  void revalidate_closesStreamOfExpiredKey() {
    dsl.update(AGENT_API_KEY)
        .set(AGENT_API_KEY.EXPIRES_AT, OffsetDateTime.now().minusMinutes(1))
        .where(AGENT_API_KEY.ID.eq(k1))
        .execute();

    closer.revalidate();

    assertThat(isClosed(s1)).isTrue();
    assertThat(isClosed(s2)).isFalse();
  }

  @Test
  void agentDeleted_closesAllStreamsOfAgent() {
    AgentRemovalService.Result result = callInTenant(1L, () -> removal.remove(admin, agent));

    assertThat(result).isEqualTo(AgentRemovalService.Result.DELETED);
    assertThat(isClosed(s1)).isTrue();
    assertThat(isClosed(s2)).isTrue();
    assertThat(registry.openAgentKeyIds()).doesNotContain(k1, k2);
  }
}
