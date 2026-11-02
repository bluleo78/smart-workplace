package com.workplace.issue.repository;

import static com.workplace.jooq.Tables.ISSUE_RECURRENCE;

import com.workplace.issue.dto.IssueRecurrenceRow;
import com.workplace.jooq.tables.records.IssueRecurrenceRecord;
import java.time.Instant;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.impl.DSL;
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

  /**
   * 답을 기다리는 질문의 열(WP-1312) — 질문을 비울 때 함께 비운다. 테스트 질문의 답할 사람·멈춘 쓰기(WP-1313)도 질문과 한 묶음이다 — 정기 회차 질문으로
   * 바뀌거나 질문이 비면 같이 비어야, 예전 테스트 질문의 허락이 다른 질문으로 새지 않는다.
   */
  private static final List<Field<?>> QUESTION_FIELDS =
      List.of(
          ISSUE_RECURRENCE.PENDING_QUESTION_MESSAGE_ID,
          ISSUE_RECURRENCE.PENDING_QUESTION_TEXT,
          ISSUE_RECURRENCE.PENDING_QUESTION_ASKED_AT,
          ISSUE_RECURRENCE.PENDING_QUESTION_ANSWERER,
          ISSUE_RECURRENCE.PENDING_QUESTION_ACTIONS);

  /** 결과를 기다리는 이어 처리의 열(WP-1312) — 이어 처리 대기를 비울 때 함께 비운다(테스트 이어 처리 표시 WP-1313 포함). */
  private static final List<Field<?>> FOLLOW_UP_FIELDS =
      List.of(
          ISSUE_RECURRENCE.FOLLOW_UP_RUN_ID,
          ISSUE_RECURRENCE.FOLLOW_UP_DISPATCHED_AT,
          ISSUE_RECURRENCE.FOLLOW_UP_TEST_BY);

  /** 결과를 기다리는 테스트 실행의 열(WP-1313) — 테스트 실행 대기를 비울 때 함께 비운다. */
  private static final List<Field<?>> TEST_RUN_FIELDS =
      List.of(
          ISSUE_RECURRENCE.TEST_RUN_ID,
          ISSUE_RECURRENCE.TEST_RUN_DISPATCHED_AT,
          ISSUE_RECURRENCE.TEST_RUN_REQUESTED_BY);

  private final DSLContext dsl;

  /** 이슈의 반복 행. 없으면 빈 값. */
  public Optional<IssueRecurrenceRow> find(long issueId) {
    return dsl.selectFrom(ISSUE_RECURRENCE)
        .where(ISSUE_RECURRENCE.ISSUE_ID.eq(issueId))
        .fetchOptional()
        .map(IssueRecurrenceRepository::toRow);
  }

  /**
   * 이 글이 그 이슈 반복의 답을 기다리는 질문에 대한 답일 수 있는지 — 잠그지 않는 좁은 존재 확인(WP-1312). 사람의 이슈 챗 글마다 불리므로 행 전체를 읽지
   * 않는다. 지우지 않은 반복이고, 질문이 있고, 글쓴이가 그 질문에 답할 사람(테스트 질문은 「지금 실행」을 누른 사람 — WP-1313, 아니면 소유자
   * created_by)이고, 질문 뒤의 글이어야 한다. 질문 기한은 보지 않는다 — 기한이 지난 질문은 잠근 뒤의 판정이 비운다({@code
   * IssueRecurrenceFollowUpService}).
   */
  public boolean mayAnswerQuestion(long issueId, long messageId, long actorId) {
    return dsl.fetchExists(
        dsl.selectOne()
            .from(ISSUE_RECURRENCE)
            .where(ISSUE_RECURRENCE.ISSUE_ID.eq(issueId))
            .and(ISSUE_RECURRENCE.DELETED.isFalse())
            .and(
                DSL.coalesce(
                        ISSUE_RECURRENCE.PENDING_QUESTION_ANSWERER, ISSUE_RECURRENCE.CREATED_BY)
                    .eq(actorId))
            .and(ISSUE_RECURRENCE.PENDING_QUESTION_MESSAGE_ID.lt(messageId)));
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

  /**
   * 예전 AI 의 진행 중인 일을 모두 비운다 — 실행 AI 가 바뀌어 예전 AI 의 진행 중 회차·이어 처리·테스트 실행(WP-1313) 결과를 받지 않고, 예전 AI 가
   * 남긴 질문의 답으로 새 AI 를 깨우지 않게(WP-1312).
   */
  public void clearPending(long issueId) {
    dsl.update(ISSUE_RECURRENCE)
        .setNull(ISSUE_RECURRENCE.PENDING_RUN_ID)
        .set(cleared(QUESTION_FIELDS, FOLLOW_UP_FIELDS, TEST_RUN_FIELDS))
        .set(ISSUE_RECURRENCE.UPDATED_AT, OffsetDateTime.now(ZoneOffset.UTC))
        .where(ISSUE_RECURRENCE.ISSUE_ID.eq(issueId))
        .execute();
  }

  /**
   * 회차 실행 중에 지운 반복을 묘비로 남긴다 — 끄고(enabled=false) 지움 표시를 해 조회·목록·스케줄러에서 빠지지만, 결과 대기 회차 id 는 남겨 진행 중
   * 회차의 결과 보고를 받아 글로 남길 수 있게 한다. 답을 기다리는 질문(WP-1312)은 비운다 — 지운 반복의 질문은 답으로 이어 가지 않고, 같은 이슈에 반복을 다시
   * 저장해 묘비가 되살아나도 예전 질문이 답으로 이어지지 않게.
   */
  public void tombstone(long issueId) {
    dsl.update(ISSUE_RECURRENCE)
        .set(ISSUE_RECURRENCE.DELETED, true)
        .set(ISSUE_RECURRENCE.ENABLED, false)
        .set(cleared(QUESTION_FIELDS))
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
    Condition scope = ISSUE_RECURRENCE.ISSUE_ID.in(issueIds);
    if (agentIds != null) scope = scope.and(ISSUE_RECURRENCE.AGENT_USER_ID.in(agentIds));
    return retireWhere(scope);
  }

  /**
   * (이슈, AI) 쌍마다 그 AI 가 그 이슈에서 돌리던 반복만 거둔다 — 여러 사람이 담당에서 한꺼번에 빠질 때(WP-1129). {@link #retire} 에
   * 이슈·AI 목록을 따로 넘기면 곱집합이 되어, 빠지지 않은 이슈의 다른 AI 반복까지 거둘 수 있다.
   *
   * @param pairs 이슈 id → AI(사람) id 쌍
   */
  public int retirePairs(Collection<Map.Entry<Long, Long>> pairs) {
    if (pairs.isEmpty()) return 0;
    // 쌍을 배열 둘로 넘긴다 — 쌍마다 바인드 변수를 두면 부서가 빠져 쌍이 수만 개일 때 PostgreSQL 바인드 상한을 넘는다.
    var rows =
        DSL.table(
            "unnest({0}::bigint[], {1}::bigint[]) as rp(issue_id, user_id)",
            DSL.val(pairs.stream().map(Map.Entry::getKey).toArray(Long[]::new)),
            DSL.val(pairs.stream().map(Map.Entry::getValue).toArray(Long[]::new)));
    return retireWhere(
        DSL.row(ISSUE_RECURRENCE.ISSUE_ID, ISSUE_RECURRENCE.AGENT_USER_ID)
            .in(
                dsl.select(
                        DSL.field("rp.issue_id", Long.class), DSL.field("rp.user_id", Long.class))
                    .from(rows)));
  }

  /**
   * 이 AI 가 돌리던 반복을 이슈와 상관없이 모두 거둔다 — 개인 비서를 해제해 더 실행할 수 없을 때(WP-1190). 규칙은 {@link #retire} 와 같다.
   *
   * @return 거둔 행 수
   */
  public int retireForAgent(long agentId) {
    return retireWhere(ISSUE_RECURRENCE.AGENT_USER_ID.eq(agentId));
  }

  /** 조건에 맞는 살아 있는 반복 행을 잠그고 하나씩 거둔다({@link #retireLocked}). */
  private int retireWhere(Condition where) {
    var scope = where.and(ISSUE_RECURRENCE.DELETED.isFalse());
    // 먼저 행을 잠그고 행마다 판정한다 — 지우기·묘비를 조건부 문장 둘로 나누면 그 사이 결과 보고(findForUpdate → 결과 대기 비움)가 끼어
    // 어느 쪽에도 걸리지 않고 살아남을 수 있다. 이슈 id 순으로 잠가 여러 이슈를 한꺼번에 거둘 때의 교착을 피한다.
    var rows =
        dsl.select(
                ISSUE_RECURRENCE.ISSUE_ID,
                ISSUE_RECURRENCE.PENDING_RUN_ID,
                ISSUE_RECURRENCE.FOLLOW_UP_RUN_ID,
                ISSUE_RECURRENCE.TEST_RUN_ID)
            .from(ISSUE_RECURRENCE)
            .where(scope)
            .orderBy(ISSUE_RECURRENCE.ISSUE_ID)
            .forUpdate()
            .fetch();
    // 정기 회차든 이어 처리(WP-1312)든 테스트 실행(WP-1313)이든 결과를 기다리는 일이 있으면 묘비로 남겨 그 결과를 받는다.
    for (var row : rows) {
      retireLocked(
          row.value1(), row.value2() != null || row.value3() != null || row.value4() != null);
    }
    return rows.size();
  }

  /**
   * 이미 잠근 반복 행 하나를 거둔다 — 결과를 기다리는 회차가 없으면 지우고, 있으면 묘비(deleted, 꺼짐)로 남긴다. 묘비의 그 회차 결과는 도착하면 이슈 챗에
   * 남기고 그때 행을 지운다(끝내 안 오면 대기 시간 초과 정리가 지운다). 이슈 종료·담당 해제({@link #retire}), 사람의 삭제와 스케줄러의 안전망
   * ({@code IssueRecurrenceService#cancel})이 이 한 규칙을 쓴다.
   *
   * @param running 결과를 기다리는 회차가 있는지(pending_run_id 나 이어 처리 follow_up_run_id 가 있음 — WP-1312)
   */
  public void retireLocked(long issueId, boolean running) {
    if (running) tombstone(issueId);
    else delete(issueId);
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

  // ───────────────────────────── 질문·이어 처리(WP-1312) ─────────────────────────────

  /**
   * 답을 기다리는 질문을 남긴다 — 반복당 하나라 예전 질문이 있으면 바꾼다. 테스트 질문(WP-1313)이면 답할 사람과 멈춘 쓰기 목록을 함께 남기고, 정기 회차 질문이면
   * 둘을 비운다(예전 테스트 질문의 허락이 정기 회차 질문의 답으로 새지 않게).
   *
   * @param answerer 테스트 질문에 답할 사람. 정기 회차 질문은 null(반복을 저장한 사람이 답한다)
   * @param actions 테스트 실행이 멈춘 되돌릴 수 없는 쓰기(JSON 배열). 없으면 null
   */
  public void setPendingQuestion(
      long issueId, long messageId, String text, Instant askedAt, Long answerer, String actions) {
    dsl.update(ISSUE_RECURRENCE)
        .set(ISSUE_RECURRENCE.PENDING_QUESTION_MESSAGE_ID, messageId)
        .set(ISSUE_RECURRENCE.PENDING_QUESTION_TEXT, text)
        .set(ISSUE_RECURRENCE.PENDING_QUESTION_ASKED_AT, utc(askedAt))
        .set(ISSUE_RECURRENCE.PENDING_QUESTION_ANSWERER, answerer)
        .set(ISSUE_RECURRENCE.PENDING_QUESTION_ACTIONS, actions)
        .set(ISSUE_RECURRENCE.UPDATED_AT, OffsetDateTime.now(ZoneOffset.UTC))
        .where(ISSUE_RECURRENCE.ISSUE_ID.eq(issueId))
        .execute();
  }

  /** 답을 기다리는 질문을 비운다 — 기한(7일)이 지난 질문을 답으로 보지 않을 때, 질문 없이 끝난 뒤 회차가 앞선 질문을 낡게 만들 때. */
  public void clearPendingQuestion(long issueId) {
    dsl.update(ISSUE_RECURRENCE)
        .set(cleared(QUESTION_FIELDS))
        .set(ISSUE_RECURRENCE.UPDATED_AT, OffsetDateTime.now(ZoneOffset.UTC))
        .where(ISSUE_RECURRENCE.ISSUE_ID.eq(issueId))
        .execute();
  }

  /**
   * 질문을 답으로 소비하고 이어 처리를 보냈다고 기록한다 — 질문을 비우고 이어 처리 실행 id·보낸 시각을 남긴다. 호출자가 행을 잠근 채로 불러, 빠르게 두 번 답해도
   * 이어 처리가 하나만 나간다. 도는 이어 처리가 있으면(follow_up_run_id 가 이미 있음) 덮어쓰지 않고 false 를 돌려준다 — 앞선 이어 처리 결과를 버리지
   * 않게(WP-1313). 호출자는 그 전에 거절하지만, 덮어쓰기를 쿼리에서도 막아 둔다.
   *
   * @param testBy 테스트 질문(WP-1313)의 답으로 보낸 이어 처리면 답한 사람, 정기 회차 질문의 답이면 null
   * @return 기록했으면 true, 도는 이어 처리가 있어 기록하지 않았으면 false
   */
  public boolean markFollowUpDispatched(
      long issueId, String followUpRunId, Instant dispatchedAt, Long testBy) {
    return dsl.update(ISSUE_RECURRENCE)
            .set(cleared(QUESTION_FIELDS))
            .set(ISSUE_RECURRENCE.FOLLOW_UP_RUN_ID, followUpRunId)
            .set(ISSUE_RECURRENCE.FOLLOW_UP_DISPATCHED_AT, utc(dispatchedAt))
            .set(ISSUE_RECURRENCE.FOLLOW_UP_TEST_BY, testBy)
            .set(ISSUE_RECURRENCE.UPDATED_AT, OffsetDateTime.now(ZoneOffset.UTC))
            .where(ISSUE_RECURRENCE.ISSUE_ID.eq(issueId))
            .and(ISSUE_RECURRENCE.FOLLOW_UP_RUN_ID.isNull())
            .execute()
        > 0;
  }

  /**
   * 정기 회차의 결과 대기만 비운다 — 묘비의 회차 결과가 끝났는데 이어 처리(WP-1312) 결과를 아직 기다려 행을 지울 수 없을 때. 연속 실패 수·켜짐은 그대로 둔다.
   */
  public void clearPendingRun(long issueId) {
    dsl.update(ISSUE_RECURRENCE)
        .setNull(ISSUE_RECURRENCE.PENDING_RUN_ID)
        .set(ISSUE_RECURRENCE.UPDATED_AT, OffsetDateTime.now(ZoneOffset.UTC))
        .where(ISSUE_RECURRENCE.ISSUE_ID.eq(issueId))
        .execute();
  }

  /** 이어 처리 결과를 받았거나(또는 오래 못 받아) 이어 처리 대기를 비운다. 연속 실패 수·다음 회차는 건드리지 않는다. */
  public void clearFollowUp(long issueId) {
    dsl.update(ISSUE_RECURRENCE)
        .set(cleared(FOLLOW_UP_FIELDS))
        .set(ISSUE_RECURRENCE.UPDATED_AT, OffsetDateTime.now(ZoneOffset.UTC))
        .where(ISSUE_RECURRENCE.ISSUE_ID.eq(issueId))
        .execute();
  }

  /**
   * 결과를 오래 못 받은 이어 처리 — 보낸 지 cutoff 보다 오래된 행을 잠그고 읽는다(묘비 포함). 다른 트랜잭션이 잡고 있으면 건너뛴다({@link
   * #lockStalePending} 와 같은 규칙).
   */
  public List<IssueRecurrenceRow> lockStaleFollowUps(Instant cutoff) {
    return dsl.selectFrom(ISSUE_RECURRENCE)
        .where(ISSUE_RECURRENCE.FOLLOW_UP_RUN_ID.isNotNull())
        .and(ISSUE_RECURRENCE.FOLLOW_UP_DISPATCHED_AT.lt(utc(cutoff)))
        .orderBy(ISSUE_RECURRENCE.FOLLOW_UP_DISPATCHED_AT)
        .limit(BATCH_LIMIT)
        .forUpdate()
        .skipLocked()
        .fetch()
        .map(IssueRecurrenceRepository::toRow);
  }

  // ───────────────────────────── 테스트 실행(WP-1313) ─────────────────────────────

  /**
   * 「지금 실행」(테스트 실행)을 보냈다고 기록한다 — 테스트 실행 id·보낸 시각·누른 사람만 남긴다. 회차 수·다음 회차·마지막 실행 시각·연속 실패 수는 정기 회차의
   * 것이라 건드리지 않는다. 호출자가 행을 잠근 채로 불러, 빠르게 두 번 눌러도 하나만 나간다.
   */
  public void markTestDispatched(
      long issueId, String testRunId, Instant dispatchedAt, long requestedBy) {
    dsl.update(ISSUE_RECURRENCE)
        .set(ISSUE_RECURRENCE.TEST_RUN_ID, testRunId)
        .set(ISSUE_RECURRENCE.TEST_RUN_DISPATCHED_AT, utc(dispatchedAt))
        .set(ISSUE_RECURRENCE.TEST_RUN_REQUESTED_BY, requestedBy)
        .set(ISSUE_RECURRENCE.UPDATED_AT, OffsetDateTime.now(ZoneOffset.UTC))
        .where(ISSUE_RECURRENCE.ISSUE_ID.eq(issueId))
        .execute();
  }

  /** 테스트 실행 결과를 받았거나(또는 오래 못 받아) 테스트 실행 대기를 비운다. 정기 회차의 상태는 건드리지 않는다. */
  public void clearTestRun(long issueId) {
    dsl.update(ISSUE_RECURRENCE)
        .set(cleared(TEST_RUN_FIELDS))
        .set(ISSUE_RECURRENCE.UPDATED_AT, OffsetDateTime.now(ZoneOffset.UTC))
        .where(ISSUE_RECURRENCE.ISSUE_ID.eq(issueId))
        .execute();
  }

  /**
   * 결과를 오래 못 받은 테스트 실행 — 보낸 지 cutoff 보다 오래된 행을 잠그고 읽는다(묘비 포함, {@link #lockStalePending} 와 같은 규칙).
   */
  public List<IssueRecurrenceRow> lockStaleTestRuns(Instant cutoff) {
    return dsl.selectFrom(ISSUE_RECURRENCE)
        .where(ISSUE_RECURRENCE.TEST_RUN_ID.isNotNull())
        .and(ISSUE_RECURRENCE.TEST_RUN_DISPATCHED_AT.lt(utc(cutoff)))
        .orderBy(ISSUE_RECURRENCE.TEST_RUN_DISPATCHED_AT)
        .limit(BATCH_LIMIT)
        .forUpdate()
        .skipLocked()
        .fetch()
        .map(IssueRecurrenceRepository::toRow);
  }

  /**
   * 답 기한이 지난 끝난 「한 번만」 예약의 질문(WP-1315) — 꺼진 한 번만 규칙이고 다음 회차가 없으며, 정기 회차 질문(테스트 질문 아님)을 cutoff 전에 남긴
   * 행을 잠그고 읽는다(묘비 제외). 다른 트랜잭션이 잡고 있으면 건너뛴다({@link #lockStalePending} 와 같은 규칙).
   */
  public List<IssueRecurrenceRow> lockExpiredOnceQuestions(Instant cutoff) {
    return dsl.selectFrom(ISSUE_RECURRENCE)
        .where(ISSUE_RECURRENCE.RRULE.startsWith("FREQ=ONCE"))
        .and(ISSUE_RECURRENCE.ENABLED.isFalse())
        .and(ISSUE_RECURRENCE.DELETED.isFalse())
        .and(ISSUE_RECURRENCE.NEXT_RUN_AT.isNull())
        .and(ISSUE_RECURRENCE.PENDING_QUESTION_MESSAGE_ID.isNotNull())
        .and(ISSUE_RECURRENCE.PENDING_QUESTION_ANSWERER.isNull())
        .and(ISSUE_RECURRENCE.PENDING_QUESTION_ASKED_AT.lt(utc(cutoff)))
        .orderBy(ISSUE_RECURRENCE.PENDING_QUESTION_ASKED_AT)
        .limit(BATCH_LIMIT)
        .forUpdate()
        .skipLocked()
        .fetch()
        .map(IssueRecurrenceRepository::toRow);
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

  /** 주어진 열 묶음을 모두 null 로 두는 SET 맵 — 질문·이어 처리 열을 비우는 여러 문장이 같은 열 목록을 쓰게. */
  @SafeVarargs
  private static Map<Field<?>, Object> cleared(List<Field<?>>... groups) {
    Map<Field<?>, Object> m = new HashMap<>();
    for (List<Field<?>> g : groups) for (Field<?> f : g) m.put(f, null);
    return m;
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
        Boolean.TRUE.equals(r.getAssistantEnrolled()),
        r.getPendingQuestionMessageId(),
        r.getPendingQuestionText(),
        instant(r.getPendingQuestionAskedAt()),
        r.getFollowUpRunId(),
        instant(r.getFollowUpDispatchedAt()),
        r.getTestRunId(),
        instant(r.getTestRunDispatchedAt()),
        r.getTestRunRequestedBy(),
        r.getPendingQuestionAnswerer(),
        r.getPendingQuestionActions(),
        r.getFollowUpTestBy());
  }
}
