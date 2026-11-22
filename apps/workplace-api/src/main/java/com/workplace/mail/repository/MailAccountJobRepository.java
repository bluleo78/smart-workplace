package com.workplace.mail.repository;

import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.Optional;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;

/**
 * mail_account_job(계정별 메일 작업 진행 상태) 리포지토리(WP-1977).
 *
 * <p>동기화(SYNC)·휴지통 비우기(TRASH_EMPTY)의 진행을 JVM 메모리 대신 DB 에 둬 파드가 여럿이거나 재기동돼도 일관되게 한다. 계정당 종류별 한 행이며,
 * 시작은 원자적 upsert 로 선점한다. 시각 비교(만료·갱신)는 모두 DB 시계({@code now()})로 해 파드 간 시계 차이를 피한다. tenant_id 는 컬럼
 * 기본값(GUC)으로 채워지고 RLS 가 다른 테넌트의 행을 가린다 — 호출은 테넌트 문맥의 트랜잭션 안에서 해야 한다.
 *
 * <p>선점할 때마다 새 실행 토큰(run_id)을 발급하고, 이후 쓰기·하트비트는 그 토큰이 일치할 때만 적용한다 — 죽은 줄 알고 다른 파드가 만료 행을 다시 선점한 뒤에
 * 옛 실행(실제로는 느렸을 뿐인)이 늦게 와서 새 실행의 진행을 덮어쓰지 못하게 한다.
 */
@Repository
@RequiredArgsConstructor
public class MailAccountJobRepository {

  /** 작업 종류 — DB kind 컬럼 값과 같은 이름. */
  public enum Kind {
    SYNC,
    TRASH_EMPTY
  }

  /**
   * 작업 한 건의 조회 결과.
   *
   * @param expired state 가 RUNNING 이고 updated_at 이 ttl 보다 오래됐으면 true(DB 에서 계산) — 죽은 작업 판정.
   */
  public record Job(
      String state,
      String phase,
      Integer total,
      int done,
      int failed,
      Instant startedAt,
      Instant finishedAt,
      String errorCode,
      boolean expired) {}

  private final DSLContext dsl;

  /**
   * 작업을 선점한다. 행이 없으면 INSERT, 있으면 RUNNING 이 아니거나(끝난 작업) ttl 이 지난 RUNNING(죽은 작업)일 때만 처음 상태로 덮어쓴다. 조건에
   * 안 맞으면 영향 행이 0 이라 동시에 시작한 쪽 중 하나만 선점한다. 선점하면 새 실행 토큰을 행에 적고 돌려준다 — 이후 쓰기는 이 토큰으로 한정된다.
   *
   * @return 선점에 성공하면 이번 실행의 토큰(run_id), 실패하면 empty
   */
  public Optional<UUID> tryStart(Kind kind, long accountId, String initialPhase, Duration ttl) {
    UUID runId = UUID.randomUUID();
    int n =
        dsl.execute(
            "INSERT INTO mail_account_job (account_id, kind, state, phase, total, done, failed,"
                + " started_at, updated_at, run_id) VALUES (?, ?, 'RUNNING', ?, NULL, 0, 0, now(),"
                + " now(), ?) ON CONFLICT (account_id, kind) DO UPDATE SET state = 'RUNNING',"
                + " phase = EXCLUDED.phase, total = NULL, done = 0, failed = 0,"
                + " started_at = now(), updated_at = now(), finished_at = NULL, error_code = NULL,"
                + " run_id = EXCLUDED.run_id"
                + " WHERE mail_account_job.state <> 'RUNNING'"
                + " OR mail_account_job.updated_at < now() - make_interval(secs => ?)",
            accountId,
            kind.name(),
            initialPhase,
            runId,
            seconds(ttl));
    return n == 1 ? Optional.of(runId) : Optional.empty();
  }

  /** 단계와 전체 건수를 정하고 done 을 0 으로 되돌린다(다음 단계 시작). */
  public void setPhaseTotal(Kind kind, long accountId, UUID runId, String phase, int total) {
    updateRunning("phase = ?, total = ?, done = 0", kind, accountId, runId, phase, total);
  }

  /** 전체 건수만 정한다. */
  public void setTotal(Kind kind, long accountId, UUID runId, int total) {
    updateRunning("total = ?", kind, accountId, runId, total);
  }

  /** 처리 완료 건수를 n 만큼 늘린다. */
  public void addDone(Kind kind, long accountId, UUID runId, int n) {
    updateRunning("done = done + ?", kind, accountId, runId, n);
  }

  /** 실패 건수를 n 만큼 늘린다. */
  public void addFailed(Kind kind, long accountId, UUID runId, int n) {
    updateRunning("failed = failed + ?", kind, accountId, runId, n);
  }

  /** 정상 종료로 표시한다. */
  public void finish(Kind kind, long accountId, UUID runId) {
    updateRunning("state = 'DONE', finished_at = now()", kind, accountId, runId);
  }

  /** 실패로 종료한다. total 이 있으면 아직 처리 못 한 나머지(total - done - failed, 음수면 0)를 실패로 채워 합계가 맞게 한다. */
  public void fail(Kind kind, long accountId, UUID runId, String errorCode) {
    updateRunning(
        "state = 'FAILED', finished_at = now(), error_code = ?,"
            + " failed = failed + CASE WHEN total IS NULL THEN 0"
            + " ELSE greatest(0, total - done - failed) END",
        kind,
        accountId,
        runId,
        errorCode);
  }

  /**
   * 하트비트 — 이 실행이 아직 살아 있음을 알린다. RUNNING 이고 run_id 가 일치하면 updated_at 만 DB 시각으로 갱신해 만료(ttl)를 늦춘다. 오래
   * 걸리는 작업이 진행 쓰기 없이도 다른 파드에 빼앗기지 않게 하려는 것이다.
   *
   * @return 갱신했으면 true — false 면 이 실행은 이미 끝났거나 다른 실행에 넘어갔거나 행이 지워졌다
   */
  public boolean heartbeat(Kind kind, long accountId, UUID runId) {
    return updateRunning("state = state", kind, accountId, runId) == 1;
  }

  /**
   * 이 실행이 선점한 RUNNING 행을 지운다(시작하지 않은 것으로 되돌림) — run_id 가 일치할 때만 지워, 그새 다른 실행이 다시 선점한 행을 옛 실행이 지우지
   * 못하게 한다.
   */
  public void deleteRun(Kind kind, long accountId, UUID runId) {
    dsl.execute(
        "DELETE FROM mail_account_job WHERE account_id = ? AND kind = ? AND state = 'RUNNING'"
            + " AND run_id = ?",
        accountId,
        kind.name(),
        runId);
  }

  /** 작업 행을 실행 토큰과 상관없이 지운다(진행 행 정리 — 테스트·복구용). */
  public void delete(Kind kind, long accountId) {
    dsl.execute(
        "DELETE FROM mail_account_job WHERE account_id = ? AND kind = ?", accountId, kind.name());
  }

  /** 작업 한 건을 조회한다. expired 는 ttl 기준으로 DB 에서 계산한다. */
  public Optional<Job> find(Kind kind, long accountId, Duration ttl) {
    return dsl
        .fetch(
            "SELECT state, phase, total, done, failed, started_at, finished_at, error_code,"
                + " (state = 'RUNNING' AND updated_at < now() - make_interval(secs => ?))"
                + " AS expired FROM mail_account_job WHERE account_id = ? AND kind = ?",
            seconds(ttl),
            accountId,
            kind.name())
        .stream()
        .findFirst()
        .map(
            r ->
                new Job(
                    r.get("state", String.class),
                    r.get("phase", String.class),
                    r.get("total", Integer.class),
                    r.get("done", Integer.class),
                    r.get("failed", Integer.class),
                    toInstant(r.get("started_at", OffsetDateTime.class)),
                    toInstant(r.get("finished_at", OffsetDateTime.class)),
                    r.get("error_code", String.class),
                    r.get("expired", Boolean.class)));
  }

  /**
   * RUNNING 이고 run_id 가 일치하는 행에만 set 절을 적용하고 updated_at 을 갱신한다 — 끝난 작업을 늦게 온 갱신이 되살리지 못하고, 만료로 다른
   * 실행에 넘어간 행을 옛 실행이 덮어쓰지 못하게 한다. args 는 set 절 바인드 값이다.
   *
   * @return 영향 행 수(0 또는 1)
   */
  private int updateRunning(
      String setClause, Kind kind, long accountId, UUID runId, Object... args) {
    Object[] binds = new Object[args.length + 3];
    System.arraycopy(args, 0, binds, 0, args.length);
    binds[args.length] = accountId;
    binds[args.length + 1] = kind.name();
    binds[args.length + 2] = runId;
    return dsl.execute(
        "UPDATE mail_account_job SET "
            + setClause
            + ", updated_at = now() WHERE account_id = ? AND kind = ? AND state = 'RUNNING'"
            + " AND run_id = ?",
        binds);
  }

  /** ttl 을 초(소수 포함)로 바꾼다 — make_interval(secs =&gt; ?) 인자. */
  private static double seconds(Duration ttl) {
    return ttl.toMillis() / 1000.0;
  }

  /** DB 시각(OffsetDateTime, null 가능)을 Instant 로 바꾼다 — 조회 결과 record 가 시각을 Instant 로 들기 때문. */
  private static Instant toInstant(OffsetDateTime t) {
    return t == null ? null : t.toInstant();
  }
}
