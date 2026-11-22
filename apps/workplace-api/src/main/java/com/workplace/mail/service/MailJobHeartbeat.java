package com.workplace.mail.service;

import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.repository.MailAccountJobRepository;
import com.workplace.mail.repository.MailAccountJobRepository.Kind;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import java.time.Duration;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 메일 작업 진행(동기화·휴지통 비우기) 하트비트 전용 스케줄러(WP-1977) — 이 파드가 쥔 실행({@link MailJobRun})마다 {@link #INTERVAL}
 * 주기로 updated_at 을 갱신해 살아 있는 작업이 TTL 로 만료돼 다른 파드에 빼앗기지(중복 실행) 않게 한다.
 *
 * <p>왜 공용 {@code @Scheduled} 가 아닌가: 공용 스케줄러 풀은 스레드가 적고 LLM 작업이 몇 분씩 잡아 하트비트가 밀릴 수 있으며, 전역 스케줄링 플래그
 * ({@code workplace.scheduling.enabled=false})로 꺼지면 하트비트도 함께 멈춘다. 그래서 데몬 스레드 하나짜리 전용 실행기를 두고 전역
 * 플래그와 무관하게 돈다. 두 진행 클래스(MailSyncProgress·MailTrashEmptyProgress)가 함께 쓴다.
 *
 * <p>스프링 빈은 {@link #start()} 로 주기 실행을 시작하고 {@link #stop()} 으로 끈다. 테스트에서 {@code new} 로 만든 인스턴스는 시작하지
 * 않으므로 {@link #beat()} 를 직접 불러 한 번씩 돌린다.
 */
@Component
public class MailJobHeartbeat {

  /** 하트비트 주기 — 진행 TTL(2분)보다 넉넉히 짧게 둬 한두 번 실패해도 만료되지 않게 한다. */
  public static final Duration INTERVAL = Duration.ofSeconds(30);

  private static final Logger log = LoggerFactory.getLogger(MailJobHeartbeat.class);

  private final MailAccountJobRepository repo;
  private final TransactionTemplate txTemplate;

  /** 이 파드가 쥔 실행들 — 핸들 전체(토큰 포함)로 구분해 같은 계정을 다시 선점해도 옛 핸들을 빼면서 새 핸들을 지우지 않는다. */
  private final Set<MailJobRun> held = ConcurrentHashMap.newKeySet();

  /** 주기 실행기 — {@link #start()} 전에는 null(테스트 인스턴스). */
  private ScheduledExecutorService executor;

  /** 스프링 주입용 — 테넌트 인식 트랜잭션 매니저로 짧은 트랜잭션 템플릿을 만든다. */
  @Autowired
  public MailJobHeartbeat(MailAccountJobRepository repo, PlatformTransactionManager txManager) {
    this(repo, new TransactionTemplate(txManager));
  }

  /** 템플릿 직접 지정(테스트용). */
  public MailJobHeartbeat(MailAccountJobRepository repo, TransactionTemplate txTemplate) {
    this.repo = repo;
    this.txTemplate = txTemplate;
  }

  /** 빈 초기화 때 데몬 단일 스레드로 주기 실행을 시작한다(종료를 막지 않게 데몬). 이미 시작했으면 아무것도 하지 않는다. */
  @PostConstruct
  public synchronized void start() {
    if (executor != null) {
      return;
    }
    executor =
        Executors.newSingleThreadScheduledExecutor(
            r -> {
              Thread t = new Thread(r, "mail-job-heartbeat");
              t.setDaemon(true);
              return t;
            });
    long ms = INTERVAL.toMillis();
    executor.scheduleWithFixedDelay(this::beatSafely, ms, ms, TimeUnit.MILLISECONDS);
  }

  /** 빈 종료 때 주기 실행을 멈춘다 — 남은 실행 행은 TTL 뒤 만료된다. */
  @PreDestroy
  public synchronized void stop() {
    if (executor != null) {
      executor.shutdownNow();
      executor = null;
    }
  }

  /** 실행을 하트비트 대상에 넣는다(선점 직후). */
  public void hold(MailJobRun run) {
    held.add(run);
  }

  /** 실행을 하트비트 대상에서 뺀다(끝·실패·되돌림) — 그 핸들만 빼고 같은 계정의 다른 실행은 그대로 둔다. */
  public void drop(MailJobRun run) {
    held.remove(run);
  }

  /** 이 종류·계정의 실행을 모두 뺀다 — 핸들 없이 행을 지울 때(진행 행 정리) 쓴다. */
  public void dropAccount(Kind kind, long accountId) {
    held.removeIf(r -> r.kind() == kind && r.accountId() == accountId);
  }

  /** 이 실행이 하트비트 대상인지(테스트·진단용). */
  public boolean holds(MailJobRun run) {
    return held.contains(run);
  }

  /**
   * 쥔 실행마다 하트비트를 한 번 보낸다. 실행마다 기억한 테넌트 문맥을 세운다(하트비트 스레드에는 문맥이 없다). 갱신된 행이 없으면(이미 끝났거나 다른 실행에 넘어갔거나
   * 계정이 지워짐) 더는 쥔 것이 아니므로 뺀다. 실행 하나의 실패는 로그만 남기고 다음 실행으로 넘어간다 — 하트비트가 작업을 깨면 안 된다.
   */
  public void beat() {
    for (MailJobRun run : held) {
      if (run.tenantId() == null) {
        // 테넌트를 모르면 RLS 때문에 갱신할 수 없다 — 건너뛰고 TTL 만료에 맡긴다.
        log.warn("메일 작업 하트비트 건너뜀 — 테넌트 모름(kind={}, accountId={})", run.kind(), run.accountId());
        continue;
      }
      try {
        Boolean alive =
            TenantContext.callAs(
                run.tenantId(),
                () ->
                    txTemplate.execute(
                        s -> repo.heartbeat(run.kind(), run.accountId(), run.runId())));
        if (!Boolean.TRUE.equals(alive)) {
          held.remove(run);
          log.info(
              "메일 작업 하트비트 대상 없음 — 쥔 실행에서 뺌(kind={}, accountId={})", run.kind(), run.accountId());
        }
      } catch (RuntimeException e) {
        log.warn("메일 작업 하트비트 실패 — 무시(kind={}, accountId={})", run.kind(), run.accountId(), e);
      }
    }
  }

  /** 주기 실행 본체 — 예외가 새면 ScheduledExecutorService 가 이후 실행을 멈추므로 모든 Throwable 을 삼키고 로그만 남긴다. */
  private void beatSafely() {
    try {
      beat();
    } catch (Throwable t) {
      log.warn("메일 작업 하트비트 회차 실패 — 다음 회차에 다시 시도", t);
    }
  }
}
