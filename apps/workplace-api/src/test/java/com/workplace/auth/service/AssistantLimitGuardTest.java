package com.workplace.auth.service;

import static com.workplace.jooq.Tables.AI_AGENT_CREDENTIAL;
import static com.workplace.jooq.Tables.AI_RUN;
import static com.workplace.jooq.Tables.ASSISTANT_LIMIT_WAIT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.airun.context.AiRunContext;
import com.workplace.airun.context.AiRunKinds;
import com.workplace.auth.repository.AiAgentCredentialRepository;
import com.workplace.global.outbound.ProviderLimitSignal;
import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.exception.MailAiUnavailableException;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.HttpServerErrorException;

/**
 * WP-2108: 자동 호출부용 한도 도우미. detect/fromJson 은 순수 함수, onFailure·specOrSkip 은 mark(새 트랜잭션)·ai_run 기록이
 * 커밋돼야 보이므로 비-@Transactional 이며 직접 정리한다.
 */
class AssistantLimitGuardTest extends IntegrationTestBase {

  @Autowired AssistantLimitGuard guard;
  @Autowired AssistantLimitWaitService waitService;
  @Autowired AiAgentCredentialRepository credentialRepo;

  private final List<Long> users = new ArrayList<>();
  private final List<Long> credentials = new ArrayList<>();

  @BeforeEach
  void setUp() {
    TenantContext.set(1L);
  }

  @AfterEach
  void tearDown() {
    TenantContext.clear();
    cleanupInTenant(
        1L,
        () -> {
          baseDsl
              .deleteFrom(ASSISTANT_LIMIT_WAIT)
              .where(ASSISTANT_LIMIT_WAIT.CREDENTIAL_ID.in(credentials))
              .execute();
          baseDsl
              .deleteFrom(AI_RUN)
              .where(AI_RUN.ERROR_REASON.eq("limit_wait"))
              .and(AI_RUN.KIND.in(KIND_A, KIND_B))
              .execute();
          baseDsl
              .deleteFrom(AI_AGENT_CREDENTIAL)
              .where(AI_AGENT_CREDENTIAL.ID.in(credentials))
              .execute();
          baseDsl.deleteFrom(USER).where(USER.ID.in(users)).execute();
        });
  }

  private static final String KIND_A = AiRunKinds.MAIL_ANALYZE_CONTENT;
  private static final String KIND_B = AiRunKinds.WIKI_SUMMARIZE;

  private static final String LIMIT_BODY =
      "{\"error\":\"mail_unavailable\",\"reason\":\"PROVIDER_LIMIT\",\"resetsAt\":\"2026-11-25T06:30:00Z\"}";

  private static HttpServerErrorException http(HttpStatus status, String body) {
    return new HttpServerErrorException(
        status,
        "",
        new HttpHeaders(),
        body.getBytes(StandardCharsets.UTF_8),
        StandardCharsets.UTF_8);
  }

  /** 자격까지 갖춘 AI 계정 하나 — [agentId, credentialId]. */
  private long[] agentWithCredential() {
    long owner = TestFixtures.createHuman(baseDsl);
    users.add(owner);
    long agent = TestFixtures.createAgentNoToken(baseDsl);
    users.add(agent);
    long cred = credentialRepo.insert(agent, "anthropic", "iv:ct", "t", owner);
    credentials.add(cred);
    return new long[] {agent, cred};
  }

  private AssistantSpec spec(long agent, Long cred) {
    return new AssistantSpec(agent, "m", "NORMAL", 8, 60_000, null, cred);
  }

  private long skipRows(String kind) {
    return callInTenant(
        1L,
        () ->
            baseDsl.fetchCount(
                baseDsl
                    .selectFrom(AI_RUN)
                    .where(AI_RUN.STATUS.eq("SKIPPED"))
                    .and(AI_RUN.ERROR_REASON.eq("limit_wait"))
                    .and(AI_RUN.KIND.eq(kind))));
  }

  @Test
  void detect_503_PROVIDER_LIMIT_원인체인() {
    var wrapped = new MailAiUnavailableException("실패");
    wrapped.initCause(http(HttpStatus.SERVICE_UNAVAILABLE, LIMIT_BODY));

    var hit = ProviderLimitSignal.detect(wrapped);

    assertThat(hit).isPresent();
    assertThat(hit.get().resetsAt()).isEqualTo(Instant.parse("2026-11-25T06:30:00Z"));
    // resetsAt 없음·파싱 실패는 null — 서비스가 기본 대기를 쓴다.
    assertThat(
            ProviderLimitSignal.fromJson("{\"reason\":\"PROVIDER_LIMIT\",\"resetsAt\":\"곧\"}")
                .orElseThrow()
                .resetsAt())
        .isNull();
    assertThat(ProviderLimitSignal.fromJson("{\"reason\":\"PROVIDER_LIMIT\"}")).isPresent();
  }

  @Test
  void detect_한도가_아니면_empty() {
    assertThat(ProviderLimitSignal.detect(http(HttpStatus.BAD_GATEWAY, LIMIT_BODY))).isEmpty();
    assertThat(
            ProviderLimitSignal.detect(
                http(
                    HttpStatus.SERVICE_UNAVAILABLE,
                    LIMIT_BODY.replace("PROVIDER_LIMIT", "PROVIDER_AUTH"))))
        .isEmpty();
    assertThat(
            ProviderLimitSignal.detect(http(HttpStatus.SERVICE_UNAVAILABLE, "<html>busy</html>")))
        .isEmpty();
    assertThat(
            ProviderLimitSignal.detect(
                HttpClientErrorException.create(
                    HttpStatus.TOO_MANY_REQUESTS,
                    "",
                    new HttpHeaders(),
                    LIMIT_BODY.getBytes(),
                    null)))
        .isEmpty();
    assertThat(ProviderLimitSignal.detect(new RuntimeException("x"))).isEmpty();
    assertThat(ProviderLimitSignal.detect(null)).isEmpty();
  }

  @Test
  void onFailure_한도면_mark_하고_true() {
    long[] a = agentWithCredential();
    Instant resets = Instant.now().plus(Duration.ofHours(3));
    String body = "{\"reason\":\"PROVIDER_LIMIT\",\"resetsAt\":\"" + resets + "\"}";

    boolean limited =
        guard.onFailure(
            spec(a[0], a[1]),
            new RuntimeException("래핑", http(HttpStatus.SERVICE_UNAVAILABLE, body)));

    assertThat(limited).isTrue();
    assertThat(waitService.activeUntil(a[1]))
        .hasValueSatisfying(
            u ->
                assertThat(u)
                    .isCloseTo(
                        resets, org.assertj.core.api.Assertions.within(1, ChronoUnit.SECONDS)));
  }

  @Test
  void onFailure_credentialId_모르면_활성자격을_찾아_mark() {
    long[] a = agentWithCredential();

    assertThat(guard.onFailure(spec(a[0], null), http(HttpStatus.SERVICE_UNAVAILABLE, LIMIT_BODY)))
        .isTrue();
    assertThat(waitService.activeUntil(a[1])).isPresent();
  }

  @Test
  void onFailure_한도아니면_false_행없음() {
    long[] a = agentWithCredential();

    assertThat(guard.onFailure(spec(a[0], a[1]), http(HttpStatus.BAD_GATEWAY, LIMIT_BODY)))
        .isFalse();
    assertThat(waitService.activeUntil(a[1])).isEmpty();
  }

  @Test
  void onFailure_테넌트없으면_false_예외없음() {
    long[] a = agentWithCredential();
    TenantContext.clear();

    assertThat(guard.onFailure(spec(a[0], a[1]), http(HttpStatus.SERVICE_UNAVAILABLE, LIMIT_BODY)))
        .isFalse();
  }

  @Test
  void markLimit_저장된_until_을_돌려준다() {
    long[] a = agentWithCredential();
    Instant resets = Instant.now().plus(Duration.ofHours(2));

    Optional<Instant> until = guard.markLimit(spec(a[0], a[1]), resets.toString());

    assertThat(until).isPresent();
    assertThat(until.get())
        .isCloseTo(resets, org.assertj.core.api.Assertions.within(1, ChronoUnit.SECONDS));
    // 읽을 수 없는 시각은 기본 대기(1시간)
    long[] b = agentWithCredential();
    assertThat(guard.markLimit(spec(b[0], b[1]), "곧")).isPresent();
  }

  @Test
  void specOrSkip_대기중이면_SKIPPED_limit_wait_를_한번만() {
    long[] a = agentWithCredential();
    Instant until = Instant.now().plus(Duration.ofHours(1));
    var waiting = AssistantResolution.waiting(a[1], until);
    AiRunContext ctx = AiRunContext.auto();

    for (int i = 0; i < 3; i++) {
      assertThat(guard.specOrSkip(waiting, KIND_A, ctx)).isEmpty();
    }
    assertThat(skipRows(KIND_A)).isEqualTo(1);

    assertThat(guard.specOrSkip(waiting, KIND_B, ctx)).isEmpty();
    assertThat(skipRows(KIND_B)).isEqualTo(1);
  }

  @Test
  void specOrSkip_none_이면_기록없이_빈값_ready_면_spec() {
    long[] a = agentWithCredential();

    assertThat(guard.specOrSkip(AssistantResolution.none(), KIND_A, AiRunContext.auto())).isEmpty();
    assertThat(skipRows(KIND_A)).isZero();
    var s = spec(a[0], a[1]);
    assertThat(guard.specOrSkip(AssistantResolution.ready(s), KIND_A, AiRunContext.auto()))
        .contains(s);
  }
}
