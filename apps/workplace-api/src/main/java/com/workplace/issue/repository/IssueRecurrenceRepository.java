package com.workplace.issue.repository;

import static com.workplace.jooq.Tables.ISSUE_RECURRENCE;

import com.workplace.issue.dto.IssueRecurrenceRow;
import com.workplace.jooq.tables.records.IssueRecurrenceRecord;
import java.time.Instant;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;

/**
 * 이슈 반복(WP-989) 리포지토리. 테넌트 격리는 RLS + tenant_id GUC DEFAULT 로 보장된다(애플리케이션은 tenant_id 를 넣지 않는다).
 * 스케줄러·결과 보고가 같은 행을 동시에 바꾸지 않게 쓰기 경로는 행을 잠그고 읽는다.
 */
@Repository
@RequiredArgsConstructor
public class IssueRecurrenceRepository {

  /** 스케줄러가 한 번에 잠그는 행 수 — 남은 행은 다음 폴링(1분 뒤)이 가져간다. */
  static final int BATCH_LIMIT = 100;

  private final DSLContext dsl;

  /** 이슈의 반복 행. 없으면 빈 값. */
  public Optional<IssueRecurrenceRow> find(long issueId) {
    return dsl.selectFrom(ISSUE_RECURRENCE)
        .where(ISSUE_RECURRENCE.ISSUE_ID.eq(issueId))
        .fetchOptional()
        .map(IssueRecurrenceRepository::toRow);
  }

  /** 이슈의 반복 행을 잠그고 읽는다 — 결과 보고가 같은 회차를 두 번 반영하지 않게(같은 runId 동시 보고). */
  public Optional<IssueRecurrenceRow> findForUpdate(long issueId) {
    return dsl.selectFrom(ISSUE_RECURRENCE)
        .where(ISSUE_RECURRENCE.ISSUE_ID.eq(issueId))
        .forUpdate()
        .fetchOptional()
        .map(IssueRecurrenceRepository::toRow);
  }

  /**
   * 반복을 저장한다 — 없으면 만들고 있으면 규칙·시각·실행 AI 를 바꾼다. 저장하면 켜지고(enabled=true) 연속 실패 수는 0 으로 돌아간다(꺼진 반복을 다시
   * 켜는 길). 지금까지의 회차 수·결과 대기 중인 회차 id 는 그대로 둔다 — 실행 중인 회차의 결과 보고를 잃지 않게.
   *
   * @param assistantEnrolled 이 반복이 실행 AI 를 담당에 직접 넣었는지 — 서비스가 계산해 넘긴다(WP-1119)
   */
  public void upsert(
      long issueId,
      String rrule,
      LocalTime runTime,
      long agentUserId,
      long createdBy,
      Instant nextRunAt,
      boolean assistantEnrolled) {
    OffsetDateTime next = utc(nextRunAt);
    dsl.insertInto(ISSUE_RECURRENCE)
        .set(ISSUE_RECURRENCE.ISSUE_ID, issueId)
        .set(ISSUE_RECURRENCE.RRULE, rrule)
        .set(ISSUE_RECURRENCE.RUN_TIME, runTime)
        .set(ISSUE_RECURRENCE.AGENT_USER_ID, agentUserId)
        .set(ISSUE_RECURRENCE.CREATED_BY, createdBy)
        .set(ISSUE_RECURRENCE.ENABLED, true)
        .set(ISSUE_RECURRENCE.NEXT_RUN_AT, next)
        .set(ISSUE_RECURRENCE.CONSECUTIVE_FAILURES, 0)
        .set(ISSUE_RECURRENCE.DELETED, false)
        .set(ISSUE_RECURRENCE.ASSISTANT_ENROLLED, assistantEnrolled)
        .onConflict(ISSUE_RECURRENCE.ISSUE_ID)
        .doUpdate()
        .set(ISSUE_RECURRENCE.RRULE, rrule)
        .set(ISSUE_RECURRENCE.RUN_TIME, runTime)
        .set(ISSUE_RECURRENCE.AGENT_USER_ID, agentUserId)
        .set(ISSUE_RECURRENCE.ENABLED, true)
        .set(ISSUE_RECURRENCE.NEXT_RUN_AT, next)
        .set(ISSUE_RECURRENCE.CONSECUTIVE_FAILURES, 0)
        // 묘비(실행 중에 지운 반복)를 다시 저장하면 새 반복으로 되살린다.
        .set(ISSUE_RECURRENCE.DELETED, false)
        .set(ISSUE_RECURRENCE.ASSISTANT_ENROLLED, assistantEnrolled)
        .set(ISSUE_RECURRENCE.UPDATED_AT, OffsetDateTime.now(ZoneOffset.UTC))
        .execute();
  }

  /** 결과 대기 회차 id 만 비운다 — 실행 AI 가 바뀌어 예전 AI 의 진행 중 회차 결과를 받지 않을 때. */
  public void clearPending(long issueId) {
    dsl.update(ISSUE_RECURRENCE)
        .setNull(ISSUE_RECURRENCE.PENDING_RUN_ID)
        .set(ISSUE_RECURRENCE.UPDATED_AT, OffsetDateTime.now(ZoneOffset.UTC))
        .where(ISSUE_RECURRENCE.ISSUE_ID.eq(issueId))
        .execute();
  }

  /**
   * 회차 실행 중에 지운 반복을 묘비로 남긴다 — 끄고(enabled=false) 지움 표시를 해 조회·목록·스케줄러에서 빠지지만, 결과 대기 회차 id 는 남겨 진행 중
   * 회차의 결과 보고를 받아 글로 남길 수 있게 한다.
   */
  public void tombstone(long issueId) {
    dsl.update(ISSUE_RECURRENCE)
        .set(ISSUE_RECURRENCE.DELETED, true)
        .set(ISSUE_RECURRENCE.ENABLED, false)
        .set(ISSUE_RECURRENCE.UPDATED_AT, OffsetDateTime.now(ZoneOffset.UTC))
        .where(ISSUE_RECURRENCE.ISSUE_ID.eq(issueId))
        .execute();
  }

  /**
   * 결과를 오래 못 받은 회차 — 결과 대기 중이고 보낸 지(last_run_at) cutoff 보다 오래된 행을 잠그고 읽는다(묘비 포함). 다른 트랜잭션이 잡고 있으면
   * 건너뛴다.
   */
  public List<IssueRecurrenceRow> lockStalePending(Instant cutoff) {
    return dsl.selectFrom(ISSUE_RECURRENCE)
        .where(ISSUE_RECURRENCE.PENDING_RUN_ID.isNotNull())
        .and(ISSUE_RECURRENCE.LAST_RUN_AT.lt(utc(cutoff)))
        .orderBy(ISSUE_RECURRENCE.LAST_RUN_AT)
        .limit(BATCH_LIMIT)
        .forUpdate()
        .skipLocked()
        .fetch()
        .map(IssueRecurrenceRepository::toRow);
  }

  /** 반복을 지운다. 지운 행이 있었으면 true. */
  public boolean delete(long issueId) {
    return dsl.deleteFrom(ISSUE_RECURRENCE).where(ISSUE_RECURRENCE.ISSUE_ID.eq(issueId)).execute()
        > 0;
  }

  /**
   * 이슈가 끝났거나(완료·취소·삭제) 반복을 돌리던 AI 가 담당에서 빠졌을 때 반복을 그 자리에서 거둔다(WP-1114) — 회차 시각까지 기다리면 그 사이 상세에 「다음
   * 실행 …」이 남아 실행될 것처럼 보였다. 결과를 기다리는 회차가 없으면 지우고, 있으면 묘비(deleted, 꺼짐)로 남겨 사람이 지울 때와 같이 그 회차의 결과는
   * 받는다({@code IssueRecurrenceService#delete}).
   *
   * @param agentIds 이 AI 들이 돌리던 반복만(담당 해제). null 이면 이슈의 반복 모두(이슈 종료·삭제)
   * @return 거둔 행 수
   */
  public int retire(Collection<Long> issueIds, Collection<Long> agentIds) {
    if (issueIds.isEmpty() || (agentIds != null && agentIds.isEmpty())) return 0;
    var scope = ISSUE_RECURRENCE.ISSUE_ID.in(issueIds).and(ISSUE_RECURRENCE.DELETED.isFalse());
    if (agentIds != null) scope = scope.and(ISSUE_RECURRENCE.AGENT_USER_ID.in(agentIds));
    // 먼저 행을 잠그고 행마다 판정한다 — 지우기·묘비를 조건부 문장 둘로 나누면 그 사이 결과 보고(findForUpdate → 결과 대기 비움)가 끼어
    // 어느 쪽에도 걸리지 않고 살아남을 수 있다. 이슈 id 순으로 잠가 여러 이슈를 한꺼번에 거둘 때의 교착을 피한다.
    var rows =
        dsl.select(ISSUE_RECURRENCE.ISSUE_ID, ISSUE_RECURRENCE.PENDING_RUN_ID)
            .from(ISSUE_RECURRENCE)
            .where(scope)
            .orderBy(ISSUE_RECURRENCE.ISSUE_ID)
            .forUpdate()
            .fetch();
    for (var row : rows) {
      long issueId = row.value1();
      if (row.value2() == null) delete(issueId);
      else tombstone(issueId);
    }
    return rows.size();
  }

  /**
   * 지금 실행할 회차 — 켜져 있고 다음 회차 시각이 지난 행을 잠그고 읽는다. 다른 인스턴스가 같은 행을 잡고 있으면 건너뛴다(SKIP LOCKED — ShedLock 이
   * 한 인스턴스만 돌리지만 결과 보고와도 겹칠 수 있다).
   */
  public List<IssueRecurrenceRow> lockDue(Instant now) {
    return dsl.selectFrom(ISSUE_RECURRENCE)
        .where(ISSUE_RECURRENCE.ENABLED.isTrue())
        .and(ISSUE_RECURRENCE.DELETED.isFalse())
        .and(ISSUE_RECURRENCE.NEXT_RUN_AT.le(utc(now)))
        .orderBy(ISSUE_RECURRENCE.NEXT_RUN_AT)
        .limit(BATCH_LIMIT)
        .forUpdate()
        .skipLocked()
        .fetch()
        .map(IssueRecurrenceRepository::toRow);
  }

  /**
   * 회차를 보냈다고 기록한다 — 회차 수 +1, 결과 대기 회차 id, 마지막 실행 시각, 다음 회차 시각(지금 이후의 첫 회차 — 밀린 회차를 몰아서 돌리지 않는다).
   */
  public void markDispatched(long issueId, String runId, Instant ranAt, Instant nextRunAt) {
    dsl.update(ISSUE_RECURRENCE)
        .set(ISSUE_RECURRENCE.RUN_COUNT, ISSUE_RECURRENCE.RUN_COUNT.plus(1))
        .set(ISSUE_RECURRENCE.PENDING_RUN_ID, runId)
        .set(ISSUE_RECURRENCE.LAST_RUN_AT, utc(ranAt))
        .set(ISSUE_RECURRENCE.NEXT_RUN_AT, utc(nextRunAt))
        .set(ISSUE_RECURRENCE.UPDATED_AT, OffsetDateTime.now(ZoneOffset.UTC))
        .where(ISSUE_RECURRENCE.ISSUE_ID.eq(issueId))
        .execute();
  }

  /** 회차 결과를 반영한다 — 결과 대기 회차 id 를 비우고 연속 실패 수·켜짐 여부를 바꾼다. */
  public void recordResult(long issueId, int consecutiveFailures, boolean enabled) {
    dsl.update(ISSUE_RECURRENCE)
        .setNull(ISSUE_RECURRENCE.PENDING_RUN_ID)
        .set(ISSUE_RECURRENCE.CONSECUTIVE_FAILURES, consecutiveFailures)
        .set(ISSUE_RECURRENCE.ENABLED, enabled)
        .set(ISSUE_RECURRENCE.UPDATED_AT, OffsetDateTime.now(ZoneOffset.UTC))
        .where(ISSUE_RECURRENCE.ISSUE_ID.eq(issueId))
        .execute();
  }

  /** 반복을 끈다 — 다음 회차를 정할 수 없을 때. 연속 실패 수·결과 대기는 그대로 둔다. */
  public void disable(long issueId) {
    dsl.update(ISSUE_RECURRENCE)
        .set(ISSUE_RECURRENCE.ENABLED, false)
        .set(ISSUE_RECURRENCE.UPDATED_AT, OffsetDateTime.now(ZoneOffset.UTC))
        .where(ISSUE_RECURRENCE.ISSUE_ID.eq(issueId))
        .execute();
  }

  /** 이슈들의 반복 행을 이슈 id 로(AI 위임 작업 목록의 반복 표시). 반복 없는 이슈·묘비(실행 중에 지운 반복)는 키가 없다. */
  public Map<Long, IssueRecurrenceRow> findByIssueIds(Collection<Long> issueIds) {
    if (issueIds.isEmpty()) return Map.of();
    return dsl
        .selectFrom(ISSUE_RECURRENCE)
        .where(ISSUE_RECURRENCE.ISSUE_ID.in(issueIds))
        .and(ISSUE_RECURRENCE.DELETED.isFalse())
        .fetch()
        .stream()
        .map(IssueRecurrenceRepository::toRow)
        .collect(Collectors.toMap(IssueRecurrenceRow::issueId, r -> r));
  }

  private static OffsetDateTime utc(Instant t) {
    return t == null ? null : t.atOffset(ZoneOffset.UTC);
  }

  private static Instant instant(OffsetDateTime t) {
    return t == null ? null : t.toInstant();
  }

  private static IssueRecurrenceRow toRow(IssueRecurrenceRecord r) {
    return new IssueRecurrenceRow(
        r.getIssueId(),
        r.getRrule(),
        r.getRunTime(),
        r.getAgentUserId(),
        r.getCreatedBy(),
        Boolean.TRUE.equals(r.getEnabled()),
        instant(r.getNextRunAt()),
        r.getConsecutiveFailures(),
        r.getRunCount(),
        r.getPendingRunId(),
        instant(r.getLastRunAt()),
        Boolean.TRUE.equals(r.getDeleted()),
        Boolean.TRUE.equals(r.getAssistantEnrolled()));
  }
}
