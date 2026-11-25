package com.workplace.support;

import static com.workplace.jooq.Tables.AI_AGENT_CREDENTIAL;
import static com.workplace.jooq.Tables.ASSISTANT_LIMIT_WAIT;
import static com.workplace.jooq.Tables.NOTIFICATION;
import static com.workplace.jooq.Tables.USER;

import com.workplace.auth.repository.AiAgentCredentialRepository;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.global.tenant.TenantContext;
import java.util.ArrayList;
import java.util.List;
import org.jooq.DSLContext;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 사용 한도 대기(WP-2108) 시험용 — 커밋된 비서 AGENT 와 자격을 만들고 치운다. {@code AssistantLimitGuard#onFailure} 가 대기를
 * 거는 {@code AssistantLimitWaitService#mark} 는 호출자 트랜잭션과 떨어진 새 트랜잭션에서 쓰므로, 자격·사용자 행이 커밋돼 있어야 외래키를
 * 지킨다. {@code @Transactional} 시험 안에서도 쓸 수 있게 만들기와 치우기를 모두 별도(REQUIRES_NEW) 트랜잭션으로 한다.
 */
public final class LimitWaitFixtures {

  /** 시험이 만든 비서 — 소유 사람, AGENT, 자격. */
  public record Fixture(long ownerId, long agentId, long credentialId) {

    /** 이 자격을 가리키는 비서 사양. */
    public AssistantSpec spec() {
      return new AssistantSpec(agentId, "m", "NORMAL", 8, null, credentialId);
    }
  }

  /** ai-agent 가 사용 한도에 걸렸을 때 내는 503 PROVIDER_LIMIT 응답 예외(재설정은 지금부터 2시간 뒤). */
  public static org.springframework.web.client.HttpServerErrorException providerLimit503() {
    String body =
        "{\"reason\":\"PROVIDER_LIMIT\",\"resetsAt\":\""
            + java.time.Instant.now().plus(java.time.Duration.ofHours(2))
            + "\"}";
    return new org.springframework.web.client.HttpServerErrorException(
        org.springframework.http.HttpStatus.SERVICE_UNAVAILABLE,
        "",
        new org.springframework.http.HttpHeaders(),
        body.getBytes(java.nio.charset.StandardCharsets.UTF_8),
        java.nio.charset.StandardCharsets.UTF_8);
  }

  private final PlatformTransactionManager txManager;
  private final DSLContext dsl;
  private final AiAgentCredentialRepository credentialRepo;
  private final List<Fixture> made = new ArrayList<>();

  public LimitWaitFixtures(
      PlatformTransactionManager txManager,
      DSLContext dsl,
      AiAgentCredentialRepository credentialRepo) {
    this.txManager = txManager;
    this.dsl = dsl;
    this.credentialRepo = credentialRepo;
  }

  private TransactionTemplate newTx() {
    TransactionTemplate t = new TransactionTemplate(txManager);
    t.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    return t;
  }

  /** 테넌트 1 에 사람 하나와 그 사람이 만든 비서 AGENT·자격을 커밋한다. */
  public Fixture create() {
    Long prev = TenantContext.get();
    TenantContext.set(1L);
    try {
      Fixture f =
          newTx()
              .execute(
                  s -> {
                    long owner = TestFixtures.createHuman(dsl);
                    long agent = TestFixtures.createAgentNoToken(dsl);
                    long cred = credentialRepo.insert(agent, "anthropic", "iv:ct", "t", owner);
                    return new Fixture(owner, agent, cred);
                  });
      made.add(f);
      return f;
    } finally {
      if (prev == null) TenantContext.clear();
      else TenantContext.set(prev);
    }
  }

  /** 만든 것을 모두 지운다 — 대기 행·알림·자격·사용자. 한도 알림이 커밋 뒤 비동기로 늦게 들어올 수 있어 외래키 위반이면 잠시 뒤 다시 지운다(최대 약 3초). */
  public void cleanup() {
    if (made.isEmpty()) return;
    List<Long> users = new ArrayList<>();
    List<Long> creds = new ArrayList<>();
    for (Fixture f : made) {
      users.add(f.ownerId());
      users.add(f.agentId());
      creds.add(f.credentialId());
    }
    Long prev = TenantContext.get();
    TenantContext.set(1L);
    try {
      for (int attempt = 1; ; attempt++) {
        try {
          newTx()
              .executeWithoutResult(
                  s -> {
                    dsl.deleteFrom(ASSISTANT_LIMIT_WAIT)
                        .where(ASSISTANT_LIMIT_WAIT.CREDENTIAL_ID.in(creds))
                        .execute();
                    dsl.deleteFrom(NOTIFICATION)
                        .where(
                            NOTIFICATION.RECIPIENT_ID.in(users).or(NOTIFICATION.ACTOR_ID.in(users)))
                        .execute();
                    dsl.deleteFrom(AI_AGENT_CREDENTIAL)
                        .where(AI_AGENT_CREDENTIAL.ID.in(creds))
                        .execute();
                    dsl.deleteFrom(USER).where(USER.ID.in(users)).execute();
                  });
          break;
        } catch (DataIntegrityViolationException e) {
          if (attempt >= 30) throw e;
          try {
            Thread.sleep(100);
          } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
            throw e;
          }
        }
      }
    } finally {
      if (prev == null) TenantContext.clear();
      else TenantContext.set(prev);
      made.clear();
    }
  }
}
