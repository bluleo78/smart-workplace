package com.workplace.mail.service;

import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.repository.MailAccountJobRepository;
import com.workplace.mail.repository.MailAccountJobRepository.Job;
import com.workplace.mail.repository.MailAccountJobRepository.Kind;
import java.time.Duration;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 메일 작업 진행(동기화·휴지통 비우기) 공통 골격(WP-1977) — 한 작업 종류({@link Kind})의 선점·실행 핸들 발급·하트비트 등록, 핸들 테넌트로 문맥을 세운
 * best-effort 쓰기, 끝내기(하트비트 해제 + 쓰기), 조회를 한곳에 둔다. 두 진행 클래스(MailSyncProgress·MailTrashEmptyProgress)가
 * 같은 순서·같은 테넌트 처리를 복사해 들고 있던 것을 합쳐, 한쪽만 고쳐져 어긋나는 일을 막으려는 것이다.
 *
 * <p>스프링 빈이 아니다 — 각 진행 클래스가 자기 종류·로그 이름표·TTL 로 하나씩 만들어 쓴다. 상태는 없고(쥔 실행 목록은 {@link MailJobHeartbeat}
 * 가 든다) 모든 저장소 호출은 짧은 트랜잭션({@code txTemplate})으로 감싼다(테넌트 GUC 가 필요하다).
 */
public final class MailJobTracker {

  private static final Logger log = LoggerFactory.getLogger(MailJobTracker.class);

  private final Kind kind;
  private final String label;
  private final Duration ttl;
  private final MailAccountJobRepository repo;
  private final TransactionTemplate txTemplate;
  private final MailJobHeartbeat heartbeat;

  /**
   * @param kind 이 골격이 다루는 작업 종류
   * @param label 로그 이름표(예: "메일 동기화 진행") — 어느 작업의 경고인지 알 수 있게
   * @param ttl RUNNING 이 이 시간 동안 갱신이 없으면 만료로 본다
   */
  public MailJobTracker(
      Kind kind,
      String label,
      Duration ttl,
      MailAccountJobRepository repo,
      TransactionTemplate txTemplate,
      MailJobHeartbeat heartbeat) {
    this.kind = kind;
    this.label = label;
    this.ttl = ttl;
    this.repo = repo;
    this.txTemplate = txTemplate;
    this.heartbeat = heartbeat;
  }

  /**
   * 작업 선점을 시도한다. 이미 진행 중(만료 전)이면 empty(가드). 성공하면 실행 핸들을 하트비트에 넣고 돌려준다. 호출 시점의 테넌트 문맥으로 선점하며(엄격 — DB
   * 실패는 던진다), 그 테넌트를 핸들에 담아 이후 쓰기·하트비트가 문맥 없는 스레드에서도 RLS 문맥을 세우게 한다.
   */
  public Optional<MailJobRun> tryStart(long accountId, String initialPhase) {
    UUID runId =
        txTemplate.execute(s -> repo.tryStart(kind, accountId, initialPhase, ttl).orElse(null));
    if (runId == null) {
      return Optional.empty();
    }
    // 선점이 됐다면 실제 DB 에선 테넌트 문맥이 있었다(RLS 가 문맥 없는 INSERT 를 막는다) — 이후 쓰기·하트비트용으로 함께 든다.
    MailJobRun run = new MailJobRun(kind, accountId, runId, TenantContext.get());
    heartbeat.hold(run);
    return Optional.of(run);
  }

  /**
   * 진행 표시용 쓰기 — 부가 데이터라 실패해도 본 작업을 깨뜨리지 않는다(예외는 삼키고 경고만). 핸들에 저장된 테넌트로 문맥을 세워 짧은 트랜잭션에서 쓴다(작업 스레드에
   * 문맥이 없어도 쓰게). 핸들에 테넌트가 없으면 호출자 문맥을 쓰고, 그것도 없으면 RLS(fail-closed)를 우회하지 않고 건너뛴다(행은 TTL 뒤 만료). 핸들이
   * 없으면(선점하지 않은 보충 등) 쓸 실행이 없어 건너뛴다.
   */
  public void write(MailJobRun run, String op, Runnable write) {
    if (run == null) {
      log.debug("{} {} 건너뜀 — 실행 핸들 없음", label, op);
      return;
    }
    Long tenantId = tenantOf(run);
    if (tenantId == null) {
      log.warn(
          "{} {} 건너뜀 — 테넌트 모름(accountId={}). 행은 TTL({}) 뒤 만료된다.", label, op, run.accountId(), ttl);
      return;
    }
    try {
      TenantContext.runAs(tenantId, () -> txTemplate.executeWithoutResult(s -> write.run()));
    } catch (RuntimeException e) {
      log.warn(
          "{} {} 실패 — 무시(accountId={}). 남은 행은 TTL({}) 뒤 만료된다.", label, op, run.accountId(), ttl, e);
    }
  }

  /**
   * 실행을 끝낸다(끝·실패 표시). 쓰기 성공 여부와 상관없이 먼저 하트비트에서 빼 갱신을 멈춘다 — 쓰기가 실패해도 행이 하트비트로 영영 RUNNING 에 붙잡히지 않고
   * TTL 뒤 만료되게. 핸들 자신만 빼므로 같은 계정의 새 실행은 그대로다.
   */
  public void end(MailJobRun run, String op, Runnable write) {
    if (run != null) {
      heartbeat.drop(run);
    }
    write(run, op, write);
  }

  /**
   * 이 실행이 선점한 행을 지워 시작하지 않은 것으로 되돌린다(하트비트에서도 뺀다). 요청 스레드용이라 엄격하다(DB 실패는 던진다 — 호출자가 처리). 핸들 테넌트로 문맥을
   * 세운다.
   */
  public void release(MailJobRun run) {
    heartbeat.drop(run);
    Long tenantId = tenantOf(run);
    if (tenantId == null) {
      log.warn("{} 되돌림 건너뜀 — 테넌트 모름(accountId={})", label, run.accountId());
      return;
    }
    TenantContext.runAs(
        tenantId,
        () ->
            txTemplate.executeWithoutResult(
                s -> repo.deleteRun(kind, run.accountId(), run.runId())));
  }

  /**
   * 테스트 정리 전용 — 계정의 진행 행을 실행 토큰과 상관없이 지우고 이 파드가 쥔 그 계정 실행도 하트비트에서 뺀다. 살아 있는 작업의 가드를 풀어 버리므로 운영 코드에서
   * 부르면 안 된다. 호출자 테넌트 문맥이 필요하며, 없으면 경고만 남기고 건너뛴다.
   */
  public void discardForTest(long accountId) {
    heartbeat.dropAccount(kind, accountId);
    if (TenantContext.get() == null) {
      log.warn("{} 정리 건너뜀 — 테넌트 문맥 없음(accountId={})", label, accountId);
      return;
    }
    txTemplate.executeWithoutResult(s -> repo.delete(kind, accountId));
  }

  /** 작업 행을 호출자 테넌트 문맥으로 조회한다(엄격). expired 는 TTL 기준으로 DB 에서 계산된다. */
  public Optional<Job> find(long accountId) {
    return Optional.ofNullable(
        txTemplate.execute(s -> repo.find(kind, accountId, ttl).orElse(null)));
  }

  /** 쓰기에 쓸 테넌트 — 핸들에 담긴 선점 당시 테넌트, 없으면 호출자 문맥. */
  private static Long tenantOf(MailJobRun run) {
    return run.tenantId() != null ? run.tenantId() : TenantContext.get();
  }
}
