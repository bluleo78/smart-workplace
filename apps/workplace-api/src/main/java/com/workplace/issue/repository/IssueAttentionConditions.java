package com.workplace.issue.repository;

import static com.workplace.jooq.Tables.AGENT_WORK;
import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_COMMENT;
import static com.workplace.jooq.Tables.ISSUE_DEPENDENCY;
import static com.workplace.jooq.Tables.ISSUE_HISTORY;
import static com.workplace.jooq.Tables.ISSUE_TYPE_DEF;

import com.workplace.issue.dto.AgentWorkState;
import com.workplace.issue.dto.IssueHistoryEventType;
import com.workplace.issue.dto.IssueStatuses;
import com.workplace.jooq.tables.Issue;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.List;
import org.jooq.Condition;
import org.jooq.Field;
import org.jooq.Record1;
import org.jooq.SelectConditionStep;
import org.jooq.SelectField;
import org.jooq.impl.DSL;

/**
 * 「살펴볼 이슈」 조건 모음(WP-1478) — 기한 지남·오래 멈춤·기다리는 중을 jOOQ {@link Condition} 으로 한곳에 둔다.
 *
 * <p>프로젝트 개요(살펴볼 이슈 숫자·상위 목록)와 이슈 검색({@code stale=true}·{@code waiting=true} 필터)이 이 함수를 함께 쓴다 — 개요의
 * 「n건 더 — 이슈 탭에서 보기」가 같은 이슈를 보이게, 정의가 두 곳에서 갈라지지 않게 하기 위함이다. 모든 조건은 바깥 쿼리의 {@code ISSUE}(별칭 없음) 행에
 * 상관(correlated)으로 걸린다.
 *
 * <p>「열린 이슈」는 범주 TODO·IN_PROGRESS 다 — 취소(CANCELED)는 완료가 아니지만 끝난 일이라 어느 묶음에도 들지 않는다.
 */
public final class IssueAttentionConditions {

  /** 오래 멈춤 기준(일) — 마지막 움직임이 이보다 오래되면 멈춘 것으로 본다(설계 「살펴볼 이슈」 N=7). */
  public static final int STALE_DAYS = 7;

  /** 이슈 탭 기본 범위에서 빠지는 유형 이름 — 에픽(묶음)과 하위 작업(부모 상세에서만 본다). */
  private static final List<String> NON_WORK_TYPES = List.of("SUBTASK", "EPIC");

  private IssueAttentionConditions() {}

  /** 열린 이슈 — 범주 TODO·IN_PROGRESS(취소·완료 제외). */
  public static Condition open() {
    return ISSUE.STATUS.in(IssueStatuses.OPEN);
  }

  /**
   * 작업 이슈 기본 범위 — 프로젝트의 SUBTASK·EPIC 유형을 뺀다. 이슈 탭 기본 범위(웹 {@code withDefaultIssueScope} 가 보내는
   * {@code excludeSubtasks=true&excludeEpics=true}, {@link IssueRepository#projectFilterCondition}
   * 의 유형 제외)와 같은 정의·같은 모양(NOT IN)이다 — 개요 숫자와 이슈 탭 결과가 같은 이슈 집합을 보게(WP-1478 결정). 프로젝트에 그 유형이 없으면
   * 아무것도 빼지 않는다.
   */
  public static Condition workScope(long projectId) {
    return excludeTypeNames(projectId, NON_WORK_TYPES);
  }

  /**
   * 프로젝트의 이름 붙은 유형(SUBTASK·EPIC 등)을 뺀다 — {@code type_id NOT IN (그 프로젝트의 그 이름 유형 id)}. 개요 작업
   * 범위({@link #workScope})와 이슈 검색 {@code excludeSubtasks}·{@code excludeEpics}(IssueRepository)가 같은
   * 모양을 쓰게 한곳에 둔다. 프로젝트에 그 유형이 없으면(PERSONAL 등) 서브쿼리가 비어 아무것도 빼지 않는다.
   */
  public static Condition excludeTypeNames(long projectId, Collection<String> typeNames) {
    return ISSUE.TYPE_ID.notIn(
        DSL.select(ISSUE_TYPE_DEF.ID)
            .from(ISSUE_TYPE_DEF)
            .where(ISSUE_TYPE_DEF.PROJECT_ID.eq(projectId))
            .and(ISSUE_TYPE_DEF.NAME.in(typeNames)));
  }

  /** 기한 지남 — 열린 이슈 중 마감일이 오늘(서울)보다 이르다. 이슈 탭에서는 {@code status=TODO,IN_PROGRESS&dueTo=<어제>} 와 같다. */
  public static Condition overdue(LocalDate today) {
    return open().and(ISSUE.DUE_DATE.lt(today));
  }

  /** 오래 멈춤의 기준 시각 — 지금보다 {@link #STALE_DAYS} 일 전. */
  public static OffsetDateTime staleCutoff(OffsetDateTime now) {
    return now.minusDays(STALE_DAYS);
  }

  /**
   * 마지막 움직임 시각 — 마지막 상태 변경(STATUS_CHANGED 이력)·마지막 댓글(삭제 제외)·생성 시각 중 가장 늦은 것. PostgreSQL {@code
   * GREATEST} 는 NULL 을 건너뛰므로 이력·댓글이 없으면 생성 시각이 된다. 오래 멈춤 판정과 「멈춘 일수」·정렬에 함께 쓴다.
   */
  public static Field<OffsetDateTime> lastMovedAt() {
    Field<OffsetDateTime> lastStatus =
        DSL.field(
            DSL.select(DSL.max(ISSUE_HISTORY.CREATED_AT))
                .from(ISSUE_HISTORY)
                .where(ISSUE_HISTORY.ISSUE_ID.eq(ISSUE.ID))
                .and(ISSUE_HISTORY.EVENT_TYPE.eq(IssueHistoryEventType.STATUS_CHANGED.name())));
    Field<OffsetDateTime> lastComment =
        DSL.field(
            DSL.select(DSL.max(ISSUE_COMMENT.CREATED_AT))
                .from(ISSUE_COMMENT)
                .where(ISSUE_COMMENT.ISSUE_ID.eq(ISSUE.ID))
                .and(ISSUE_COMMENT.DELETED_AT.isNull()));
    return DSL.greatest(ISSUE.CREATED_AT, lastStatus, lastComment);
  }

  /**
   * 오래 멈춤 — 진행 중(IN_PROGRESS 범주)인데 마지막 움직임({@link #lastMovedAt})이 cutoff 보다 전. 할 일(TODO)은 아직 시작하지
   * 않은 일이라 멈춤으로 보지 않는다.
   *
   * @param cutoff 보통 {@link #staleCutoff}(지금 − 7일)
   */
  public static Condition stale(OffsetDateTime cutoff) {
    return ISSUE.STATUS.eq(IssueStatuses.IN_PROGRESS).and(lastMovedAt().lt(cutoff));
  }

  /**
   * 사람 답을 기다리는 진행 중 AI 작업 — 답변 필요(INPUT_REQUIRED) 이고 끝나지 않았다. {@code AGENT_WORK} 를 바깥 {@code ISSUE}
   * 에 상관으로 거는 WHERE 조건이라 {@code select … from(AGENT_WORK).where(inputRequiredWork())} 로 쓴다. 내 작업 개요
   * (MeOverviewRepository)의 「AI 답변 기다림」도 이 정의 하나를 쓴다 — 두 화면의 기다림 기준이 갈라지지 않게.
   */
  public static Condition inputRequiredWork() {
    return AGENT_WORK
        .ISSUE_ID
        .eq(ISSUE.ID)
        .and(AGENT_WORK.STATE.eq(AgentWorkState.INPUT_REQUIRED))
        .and(AGENT_WORK.ENDED_AT.isNull());
  }

  /**
   * AI 작업이 사람 답을 기다리는 이슈 — {@link #inputRequiredWork} 행이 있다. 개요 「기다리는 중」({@link #waiting})과 내 작업 개요
   * (MeOverviewRepository)의 「AI 답변 기다림」이 같은 EXISTS 를 쓴다.
   */
  public static Condition awaitingAgentInput() {
    return DSL.exists(DSL.selectOne().from(AGENT_WORK).where(inputRequiredWork()));
  }

  /** 선행(차단하는) 이슈 별칭 — 바깥 {@code ISSUE} 와 같은 테이블을 서브쿼리에서 따로 읽으려고 자기 별칭을 둔다. */
  private static final Issue BLOCKER = ISSUE.as("blocker");

  /**
   * 바깥 이슈를 막는 의존 행 중 선행이 아직 열려 있는 것 — 선행이 종료(DONE·CANCELED)·삭제되면 차단 아님(#826). {@link
   * #blockedByOpen} (있는가)과 {@link #waitingSince}(언제부터)가 같은 집합을 보게 한곳에 둔다.
   */
  private static <T> SelectConditionStep<Record1<T>> openBlockerDependencies(SelectField<T> field) {
    return DSL.select(field)
        .from(ISSUE_DEPENDENCY)
        .join(BLOCKER)
        .on(BLOCKER.ID.eq(ISSUE_DEPENDENCY.ISSUE_ID))
        .where(ISSUE_DEPENDENCY.BLOCKS_ISSUE_ID.eq(ISSUE.ID))
        .and(BLOCKER.STATUS.notIn(IssueStatuses.CLOSED))
        .and(BLOCKER.DELETED_AT.isNull());
  }

  /**
   * 닫히지 않은 선행이 있는 차단 — 이슈 검색 {@code blocked=true}(IssueRepository 의 프로젝트·횡단 두 경로)와 「기다리는 중」이 함께 쓰는
   * 한 정의. 선행이 다른 프로젝트에 있어도 센다. 대상 이슈 자신이 닫혔는지는 보지 않는다 — 부르는 쪽이 열린 이슈 조건을 함께 건다.
   */
  public static Condition blockedByOpen() {
    return DSL.exists(openBlockerDependencies(DSL.one()));
  }

  /** 기다리는 중 — 열린 이슈 중 (AI 작업이 사람 답을 기다림) 또는 (닫히지 않은 선행에 막힘). 둘 다 「내가 아닌 무언가를 기다린다」라 한 묶음으로 본다. */
  public static Condition waiting() {
    return open().and(awaitingAgentInput().or(blockedByOpen()));
  }

  /**
   * 기다리기 시작한 시각 — 답변 필요로 바뀐 가장 이른 시각(agent_work.state_changed_at), 없으면(차단만) 아직 열린 선행 의존 중 가장 최근에 걸린
   * 것의 생성 시각(issue_dependency.created_at). 「기다린 일수」·오래 기다린 순 정렬에 쓴다.
   *
   * <p>agent_work.updated_at 이 아니라 state_changed_at 을 쓰는 것은 메모·진행률 보고만으로 updated_at 이 바뀌어 기다린 기간이
   * 줄어 보이지 않게 하기 위함이다(내 작업 개요 WP-1484 의 waitingSince 와 같은 기준). 차단도 같은 까닭으로 이슈 수정 시각(updated_at)을 쓰지
   * 않는다 — 막힌 이슈의 제목·설명만 고쳐도 기다린 일수가 0 으로 돌아가지 않게. 가장 최근 선행을 쓰는 것은 앞선 선행이 풀리고 새 선행이 걸렸다면 그때부터 다시
   * 기다리는 것이라서다. 두 값이 다 없으면(기다리는 중이 아닌 이슈) 이슈 수정 시각으로 둔다.
   */
  public static Field<OffsetDateTime> waitingSince() {
    Field<OffsetDateTime> agentSince =
        DSL.field(
            DSL.select(DSL.min(AGENT_WORK.STATE_CHANGED_AT))
                .from(AGENT_WORK)
                .where(inputRequiredWork()));
    Field<OffsetDateTime> blockedSince =
        DSL.field(openBlockerDependencies(DSL.max(ISSUE_DEPENDENCY.CREATED_AT)));
    return DSL.coalesce(agentSince, blockedSince, ISSUE.UPDATED_AT);
  }
}
