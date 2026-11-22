package com.workplace.mail.service.trash;

import com.workplace.mail.dto.MailTrashEmptyStatus;
import com.workplace.mail.exception.MailTrashException;
import com.workplace.mail.repository.MailAccountJobRepository;
import com.workplace.mail.repository.MailAccountJobRepository.Job;
import com.workplace.mail.repository.MailAccountJobRepository.Kind;
import com.workplace.mail.service.MailJobHeartbeat;
import com.workplace.mail.service.MailJobRun;
import com.workplace.mail.service.MailJobTracker;
import java.time.Duration;
import java.util.Optional;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 휴지통 비우기 진행 상태(WP-1682) — DB({@code mail_account_job}, Kind.TRASH_EMPTY)에 계정 id 키로 보관한다(WP-1977).
 * 계정당 작업은 하나뿐이라 RUNNING 이면 새로 시작하지 않고(다시 눌러도 같은 작업을 보인다), 끝난 상태(DONE·FAILED)는 다음 시작 때까지 남겨 웹이 결과를
 * 읽게 한다. DB 보관이라 파드가 여러 대여도 가드·진행이 공유되고 재시작에도 남는다. 비정상 종료로 RUNNING 이 남아도 {@link #TTL} 동안 갱신이 없으면
 * 만료로 보아 IDLE 을 돌려주고 다시 시작할 수 있다.
 *
 * <p>{@link #tryStart} 가 돌려주는 실행 핸들({@link MailJobRun})을 시작한 쪽({@link MailTrashService})이 작업({@link
 * MailTrashEmptyJob})에 넘기고, 진행 반영·끝내기·되돌리기는 그 핸들로 한다 — 쓰기가 핸들의 실행 토큰으로 한정돼 만료 뒤 다시 선점된 새 실행을 옛 실행이
 * 덮어쓰지 못한다(같은 파드에서 재선점돼도). 선점·하트비트 등록·테넌트 처리는 공통 골격({@link MailJobTracker})이 한다.
 *
 * <p>작업 스레드가 부르는 진행 반영(setTotal·addDeleted·addFailed·finish·fail)은 best-effort — {@link
 * MailTrashEmptyJob} 은 절대 던지면 안 되므로 실패해도 경고만 남기고 넘어간다. 요청 스레드의 tryStart·release·snapshot 은 엄격하다. 살아
 * 있는 실행은 전용 하트비트({@link MailJobHeartbeat}, 30초)가 updated_at 을 갱신하므로 TTL 을 짧게(2분) 둬도 큰 휴지통 비우기를 빼앗기지
 * 않고, 파드가 죽으면 최대 TTL 뒤 다시 시작할 수 있다.
 */
@Component
public class MailTrashEmptyProgress {

  /** RUNNING 이 이 시간 동안 갱신(진행 쓰기·하트비트)이 없으면 만료(죽은 작업)로 본다. 하트비트 주기(30초)보다 넉넉히 길게 둔다. */
  static final Duration TTL = Duration.ofMinutes(2);

  private final MailAccountJobRepository repo;
  private final MailJobTracker jobs;

  /** 스프링 주입용 — 테넌트 인식 트랜잭션 매니저로 짧은 트랜잭션 템플릿을 만든다. */
  @Autowired
  public MailTrashEmptyProgress(
      MailAccountJobRepository repo,
      PlatformTransactionManager txManager,
      MailJobHeartbeat heartbeat) {
    this(repo, new TransactionTemplate(txManager), heartbeat);
  }

  /** 템플릿 직접 지정(테스트용). */
  public MailTrashEmptyProgress(
      MailAccountJobRepository repo, TransactionTemplate txTemplate, MailJobHeartbeat heartbeat) {
    this.repo = repo;
    this.jobs =
        new MailJobTracker(Kind.TRASH_EMPTY, "휴지통 비우기 진행", TTL, repo, txTemplate, heartbeat);
  }

  /**
   * 작업을 시작 상태(RUNNING, 수 0)로 둔다. 이미 RUNNING(만료 전)이면 아무것도 바꾸지 않고 empty. 끝난 상태는 새 작업으로 덮는다. 성공하면 실행
   * 핸들을 하트비트에 넣고 돌려준다.
   */
  public Optional<MailJobRun> tryStart(long accountId) {
    return jobs.tryStart(accountId, null);
  }

  /** 시작 때 센 서버 휴지통 메일 수를 적는다. */
  public void setTotal(MailJobRun run, int total) {
    jobs.write(
        run,
        "setTotal",
        () -> repo.setTotal(Kind.TRASH_EMPTY, run.accountId(), run.runId(), total));
  }

  /** 지운(또는 이미 없던) 메일 수를 더한다. */
  public void addDeleted(MailJobRun run, int n) {
    jobs.write(
        run, "addDeleted", () -> repo.addDone(Kind.TRASH_EMPTY, run.accountId(), run.runId(), n));
  }

  /** 지우지 못한 메일 수를 더한다. */
  public void addFailed(MailJobRun run, int n) {
    jobs.write(
        run, "addFailed", () -> repo.addFailed(Kind.TRASH_EMPTY, run.accountId(), run.runId(), n));
  }

  /** 끝까지 돌았다 — DONE + 끝난 시각(failed 는 그대로). 먼저 하트비트에서 빼고 쓴다(쓰기가 실패해도 TTL 뒤 만료되게). */
  public void finish(MailJobRun run) {
    jobs.end(run, "finish", () -> repo.finish(Kind.TRASH_EMPTY, run.accountId(), run.runId()));
  }

  /**
   * 중간에 멈췄다 — FAILED + 사유 코드. total 을 알면 저장소가 아직 처리하지 않은 메일을 실패로 더해 {@code deleted + failed =
   * total} 을 맞춘다. 화면 문구는 저장하지 않고 조회 때 {@link MailTrashException#messageOf} 로 만든다. finish 처럼 먼저
   * 하트비트에서 뺀다.
   */
  public void fail(MailJobRun run, String code) {
    jobs.end(run, "fail", () -> repo.fail(Kind.TRASH_EMPTY, run.accountId(), run.runId(), code));
  }

  /**
   * 실행기가 작업을 거절했다 — 이 실행이 선점한 행을 지워 시작하지 않은 것으로 되돌린다(IDLE). 하트비트에서도 뺀다. 요청 스레드에서 부르며 엄격하다(DB 실패는
   * 던진다 — 호출자가 처리).
   */
  public void release(MailJobRun run) {
    jobs.release(run);
  }

  /** 테스트 정리 전용 — 계정의 비우기 진행 행을 실행 토큰과 상관없이 지운다. 살아 있는 비우기의 가드를 풀어 버리므로 운영 코드에서 부르면 안 된다. */
  public void discardForTest(long accountId) {
    jobs.discardForTest(accountId);
  }

  /** 지금 상태. 행 없음·만료면 IDLE(나머지 0·null). */
  public MailTrashEmptyStatus snapshot(long accountId) {
    Job job = jobs.find(accountId).orElse(null);
    if (job == null || job.expired()) {
      return MailTrashEmptyStatus.IDLE;
    }
    String code = job.errorCode();
    return new MailTrashEmptyStatus(
        job.state(),
        job.total(),
        job.done(),
        job.failed(),
        job.startedAt(),
        job.finishedAt(),
        code,
        code == null ? null : MailTrashException.messageOf(code));
  }
}
