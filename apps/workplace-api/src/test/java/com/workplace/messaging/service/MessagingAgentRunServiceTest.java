package com.workplace.messaging.service;

import static com.workplace.jooq.Tables.MESSAGING_AGENT_RUN;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.messaging.dto.MessagingAgentRunAcquireRequest;
import com.workplace.messaging.dto.MessagingAgentRunAcquireResponse;
import com.workplace.messaging.dto.MessagingAgentRunReleaseRequest;
import com.workplace.support.IntegrationTestBase;
import java.time.OffsetDateTime;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

/**
 * 메시징 AI 대화별 실행 임대(WP-1979) 서비스 통합 테스트 — 바쁠 때 최신만 대기, 중복 무시, 만료 인수, 낡은 토큰 반납 무시, 키별 독립, leaseMs
 * 자르기를 검증한다. channel_id 는 FK 가 없어 실제 채널과 겹치지 않게 음수를 쓴다. @Transactional 이라 끝나면 롤백된다.
 */
@Transactional
class MessagingAgentRunServiceTest extends IntegrationTestBase {

  private static final long CHANNEL = -3001L;
  private static final long LEASE = 60_000L;

  @Autowired MessagingAgentRunService service;
  @Autowired DSLContext dsl;
  @Autowired ObjectMapper om;

  /** RLS 통과를 위해 테스트마다 tenant GUC 를 건다. */
  @BeforeEach
  void tenant() {
    dsl.execute("set app.tenant_id = '1'");
  }

  private MessagingAgentRunAcquireResponse acquire(
      long parent, long agent, long messageId, long leaseMs) {
    var event = om.createObjectNode().put("messageId", messageId);
    return service.acquire(
        new MessagingAgentRunAcquireRequest(
            CHANNEL, parent == 0 ? null : parent, agent, messageId, leaseMs, event, null));
  }

  private MessagingAgentRunAcquireResponse acquire(long messageId) {
    return acquire(0, 1, messageId, LEASE);
  }

  private Long release(String token) {
    var next =
        service.release(new MessagingAgentRunReleaseRequest(CHANNEL, null, 1, token, LEASE)).next();
    return next == null ? null : next.get("messageId").asLong();
  }

  /**
   * 같은 키의 행이 다른 테넌트 것이라 RLS 로 안 보이면 acquire 는 NPE 가 아닌 명확한 IllegalStateException, release 는
   * next=null.
   */
  @Test
  void invisibleRowFailsClearly() {
    var a = acquire(10);
    dsl.execute("set app.tenant_id = '2'");
    assertThatThrownBy(() -> acquire(11))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("임대 행");
    assertThat(release(a.token())).isNull();
  }

  @Test
  void firstMessageAcquires() {
    var r = acquire(10);
    assertThat(r.status()).isEqualTo("ACQUIRED");
    assertThat(r.token()).isNotBlank();
  }

  @Test
  void busyQueuesLatest() {
    var a = acquire(10);
    assertThat(acquire(11).status()).isEqualTo("QUEUED");
    assertThat(acquire(12).status()).isEqualTo("QUEUED");
    assertThat(release(a.token())).isEqualTo(12L);
    assertThat(release(a.token())).isNull();
  }

  @Test
  void olderMessageDoesNotReplacePending() {
    var a = acquire(10);
    assertThat(acquire(12).status()).isEqualTo("QUEUED");
    assertThat(acquire(11).status()).isEqualTo("DUPLICATE");
    assertThat(release(a.token())).isEqualTo(12L);
  }

  @Test
  void duplicateWhileRunningIsNotQueued() {
    var a = acquire(10);
    assertThat(acquire(10).status()).isEqualTo("DUPLICATE");
    assertThat(release(a.token())).isNull();
  }

  @Test
  void duplicateAfterFinishIsIgnored() {
    var a = acquire(10);
    assertThat(release(a.token())).isNull();
    assertThat(acquire(10).status()).isEqualTo("DUPLICATE");
    assertThat(acquire(11).status()).isEqualTo("ACQUIRED");
  }

  @Test
  void expiredLeaseIsTakenOver() {
    var old = acquire(0, 1, 10, 1);
    expire();
    var fresh = acquire(11);
    assertThat(fresh.status()).isEqualTo("ACQUIRED");
    assertThat(fresh.token()).isNotEqualTo(old.token());
  }

  @Test
  void staleTokenReleaseIsNoop() {
    var old = acquire(0, 1, 10, 1);
    expire();
    var fresh = acquire(11);
    assertThat(release(old.token())).isNull();
    // 새 실행이 소유를 유지 — 12 는 대기로 들어가고 새 토큰 반납이 정상 동작한다.
    assertThat(acquire(12).status()).isEqualTo("QUEUED");
    assertThat(release(fresh.token())).isEqualTo(12L);
  }

  @Test
  void differentKeysDoNotBlock() {
    assertThat(acquire(0, 1, 10, LEASE).status()).isEqualTo("ACQUIRED");
    assertThat(acquire(5, 1, 10, LEASE).status()).isEqualTo("ACQUIRED");
    assertThat(acquire(0, 2, 10, LEASE).status()).isEqualTo("ACQUIRED");
  }

  @Test
  void leaseMsIsClamped() {
    acquire(0, 1, 10, 1);
    OffsetDateTime until =
        dsl.select(MESSAGING_AGENT_RUN.LEASE_UNTIL)
            .from(MESSAGING_AGENT_RUN)
            .where(MESSAGING_AGENT_RUN.CHANNEL_ID.eq(CHANNEL))
            .fetchOne(0, OffsetDateTime.class);
    assertThat(until).isAfterOrEqualTo(OffsetDateTime.now().plusSeconds(59));
  }

  /** ai-agent 가 만들어 보낸 토큰을 소유 토큰으로 쓰고 그대로 돌려준다 — acquire 응답을 잃어도 그 토큰으로 반납할 수 있다. */
  @Test
  void suppliedTokenIsUsedAndReleasable() {
    String token = UUID.randomUUID().toString();
    var event = om.createObjectNode().put("messageId", 10);
    var r =
        service.acquire(
            new MessagingAgentRunAcquireRequest(CHANNEL, null, 1, 10, LEASE, event, token));
    assertThat(r.status()).isEqualTo("ACQUIRED");
    assertThat(r.token()).isEqualTo(token);
    assertThat(acquire(11).status()).isEqualTo("QUEUED");
    assertThat(release(token)).isEqualTo(11L);
    assertThat(release(token)).isNull();
    assertThat(acquire(12).status()).isEqualTo("ACQUIRED");
  }

  /** UUID 가 아닌 토큰은 거절한다(400) — 아무것도 바꾸지 않는다. */
  @Test
  void invalidSuppliedTokenIsRejected() {
    var event = om.createObjectNode().put("messageId", 10);
    assertThatThrownBy(
            () ->
                service.acquire(
                    new MessagingAgentRunAcquireRequest(
                        CHANNEL, null, 1, 10, LEASE, event, "not-a-uuid")))
        .isInstanceOf(IllegalArgumentException.class);
    assertThat(acquire(10).status()).isEqualTo("ACQUIRED");
  }

  /** 이벤트가 없거나 JSON null 이면 거절한다 — null 을 대기로 저장하면 반납 쪽이 이어 받지 못해 임대가 묶인다. */
  @Test
  void missingEventIsRejected() {
    assertThatThrownBy(
            () ->
                service.acquire(
                    new MessagingAgentRunAcquireRequest(CHANNEL, null, 1, 10, LEASE, null, null)))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(
            () ->
                service.acquire(
                    new MessagingAgentRunAcquireRequest(
                        CHANNEL, null, 1, 10, LEASE, om.nullNode(), null)))
        .isInstanceOf(IllegalArgumentException.class);
  }

  /** 임대 만료를 흉내 내려 lease_until 을 과거로 돌린다. */
  private void expire() {
    dsl.update(MESSAGING_AGENT_RUN)
        .set(MESSAGING_AGENT_RUN.LEASE_UNTIL, OffsetDateTime.now().minusMinutes(1))
        .where(MESSAGING_AGENT_RUN.CHANNEL_ID.eq(CHANNEL))
        .execute();
  }
}
