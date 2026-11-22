package com.workplace.mail.service;

import com.workplace.mail.dto.MailSyncStatus;
import com.workplace.mail.repository.MailAccountJobRepository;
import com.workplace.mail.repository.MailAccountJobRepository.Job;
import com.workplace.mail.repository.MailAccountJobRepository.Kind;
import java.time.Duration;
import java.util.Optional;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 계정당 수동 동기화 진행 상태 + 동시 실행 가드. DB({@code mail_account_job}, Kind.SYNC)에 보관하므로 파드가 여러 대여도 가드·진행률이
 * 공유되고 재기동에도 남는다(WP-1977). 비정상 종료로 RUNNING 이 남아도 {@link #TTL} 이 지나면 만료로 보아 IDLE 취급·재시작을 허용한다.
 *
 * <p>{@link #tryStart} 가 돌려주는 실행 핸들({@link MailJobRun})을 호출자(동기화·본문 보충)가 들고 다니며 진행 쓰기·끝내기에 넘긴다 —
 * 쓰기는 그 핸들의 실행 토큰으로 한정돼, 같은 파드에서든 다른 파드에서든 만료 뒤 다시 선점된 새 실행을 옛 실행이 덮어쓰지 못한다. 살아 있는 실행은 전용
 * 하트비트({@link MailJobHeartbeat}, 30초)가 updated_at 을 갱신하므로 TTL 을 짧게(2분) 둬도 오래 걸리는 동기화를 빼앗기지 않고, 파드가
 * 죽으면 최대 TTL 뒤 다른 파드가 이어받는다.
 *
 * <p>선점·하트비트 등록·테넌트 처리·best-effort 쓰기는 공통 골격({@link MailJobTracker})이 한다. 진행
 * 쓰기(startBodies·incBody·finish)는 실패해도 동기화를 깨지 않고, tryStart/snapshot 은 가드가 실제 값을 필요로 하므로 엄격하다.
 */
@Component
public class MailSyncProgress {

  /** RUNNING 이 이 시간 동안 갱신(진행 쓰기·하트비트)이 없으면 만료(죽은 작업)로 본다. 하트비트 주기(30초)보다 넉넉히 길게 둔다. */
  static final Duration TTL = Duration.ofMinutes(2);

  private final MailAccountJobRepository repo;
  private final MailJobTracker jobs;

  /** 스프링 주입용 — 다른 메일 서비스처럼 테넌트 인식 트랜잭션 매니저로 짧은 트랜잭션 템플릿을 만든다. */
  @Autowired
  public MailSyncProgress(
      MailAccountJobRepository repo,
      PlatformTransactionManager txManager,
      MailJobHeartbeat heartbeat) {
    this(repo, new TransactionTemplate(txManager), heartbeat);
  }

  /** 템플릿 직접 지정(테스트용). */
  public MailSyncProgress(
      MailAccountJobRepository repo, TransactionTemplate txTemplate, MailJobHeartbeat heartbeat) {
    this.repo = repo;
    this.jobs = new MailJobTracker(Kind.SYNC, "메일 동기화 진행", TTL, repo, txTemplate, heartbeat);
  }

  /**
   * 동기화 시작 시도. 이미 진행 중(만료 전)이면 empty(가드). 성공 시 RUNNING, phase=LIST 로 리셋하고 실행 핸들을 하트비트에 넣어 돌려준다 —
   * 호출자는 이 핸들로 진행 쓰기·끝내기를 한다.
   */
  public Optional<MailJobRun> tryStart(long accountId) {
    return jobs.tryStart(accountId, "LIST");
  }

  /** 목록 단계 완료 → 본문 보충 단계 진입(total = 보충 대상 수, done 은 0 으로 리셋). */
  public void startBodies(MailJobRun run, int total) {
    jobs.write(
        run,
        "startBodies",
        () -> repo.setPhaseTotal(Kind.SYNC, run.accountId(), run.runId(), "BODIES", total));
  }

  /** 본문 1건 적재 완료. */
  public void incBody(MailJobRun run) {
    jobs.write(run, "incBody", () -> repo.addDone(Kind.SYNC, run.accountId(), run.runId(), 1));
  }

  /** 동기화/보충 종료 → DONE(스냅샷상 IDLE, running=false). 먼저 하트비트에서 빼고 쓴다(쓰기가 실패해도 TTL 뒤 만료되게). */
  public void finish(MailJobRun run) {
    jobs.end(run, "finish", () -> repo.finish(Kind.SYNC, run.accountId(), run.runId()));
  }

  /**
   * 테스트 정리 전용 — 계정의 동기화 진행 행을 실행 토큰과 상관없이 지운다(목킹된 보충이 끝내지 못한 진행을 지울 때). 살아 있는 동기화의 가드를 풀어 버리므로 운영
   * 코드에서 부르면 안 된다.
   */
  public void discardForTest(long accountId) {
    jobs.discardForTest(accountId);
  }

  /** 현재 상태 스냅샷. 행 없음·만료·종료(DONE/FAILED)는 IDLE(종료 시 total/done 유지, 행 없음은 0/0). */
  public MailSyncStatus snapshot(long accountId) {
    Job job = jobs.find(accountId).orElse(null);
    if (job == null) {
      return new MailSyncStatus("IDLE", 0, 0, false);
    }
    int total = job.total() == null ? 0 : job.total();
    boolean running = "RUNNING".equals(job.state()) && !job.expired();
    return new MailSyncStatus(running ? job.phase() : "IDLE", total, job.done(), running);
  }
}
