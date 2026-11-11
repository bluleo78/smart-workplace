package com.workplace.issue.repository;

import static com.workplace.jooq.Tables.AGENT_WORK;
import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_ASSIGNEE;
import static com.workplace.jooq.Tables.ISSUE_COMMENT;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.USER;

import com.workplace.issue.dto.AgentWorkState;
import com.workplace.issue.dto.IssueStatuses;
import com.workplace.issue.metrics.IssueMetricsRepository;
import com.workplace.user.dto.UserKind;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/**
 * 「내 작업 · 개요」(WP-1484) 전용 조회 — 지표 모듈({@code IssueMetricsService})이 주지 않는 값만 가져온다: 열린 이슈(오늘 할 일·앞으로
 * 할 일), 끝낸 이슈의 표시 정보(키·제목·본문 앞부분)·마지막 코멘트·함께한 AI 이름, 멘션 이름.
 *
 * <p>읽을 수 있는 범위는 지표 모듈과 같은 {@link IssueMetricsRepository#readableBy} 를 쓴다 — 두 숫자가 다른 범위에서 나오면 「오늘
 * 기한 지남」과 「끝낸 이슈」가 서로 다른 프로젝트 집합을 보게 된다. 쿼리 수는 이슈 수와 무관하게 고정이고, id 목록은 {@code = ANY(?)} 배열 하나로
 * 바인딩한다.
 */
@Repository
@RequiredArgsConstructor
public class MeOverviewRepository {

  /** 본문·코멘트를 DB 에서 미리 자르는 길이 — 화면은 앞부분 한두 줄만 보이므로 5만자 본문을 통째로 옮기지 않는다. 평문화·최종 자르기는 서비스 몫. */
  private static final int RAW_HEAD_CHARS = 1_000;

  private final DSLContext dsl;
  private final IssueMetricsRepository metricsRepository;

  /**
   * 열린 이슈 한 건 — 「오늘 할 일」·「앞으로 할 일」 계산 원재료.
   *
   * @param assignedToMe 내가 지금 담당인가(아니면 보고자로만 걸린 「나를 기다림」 이슈)
   * @param waiting AI 작업이 답변 필요 상태로 진행 중인가
   * @param waitingSince 답변 필요로 바뀐 가장 이른 시각(waiting 일 때)
   */
  public record OpenIssueRow(
      long issueId,
      String projectKey,
      int number,
      String title,
      LocalDate dueDate,
      OffsetDateTime updatedAt,
      boolean assignedToMe,
      boolean waiting,
      OffsetDateTime waitingSince) {}

  /** 끝낸 이슈 표시 정보 — 본문은 앞부분 원문({@link #RAW_HEAD_CHARS}). */
  public record IssueDisplay(
      long issueId, String projectKey, int number, String title, String bodyHead) {}

  /** 이슈의 마지막 코멘트 — 본문은 앞부분 원문. */
  public record CommentHead(long issueId, String authorName, String bodyHead) {}

  /**
   * 살아 있는 이슈 — 이슈도 소속 프로젝트도 삭제되지 않았다. 지표 모듈 조회와 같은 규칙(프로젝트 soft-delete 는 소속 이슈를 정리하지 않는다, WP-786).
   */
  private static Condition alive() {
    return ISSUE.DELETED_AT.isNull().and(PROJECT.DELETED_AT.isNull());
  }

  /** 답변 필요로 진행 중인 AI 작업 — 끝난 작업(ended_at)은 보지 않는다. */
  private static Condition waitingWork() {
    return AGENT_WORK
        .ISSUE_ID
        .eq(ISSUE.ID)
        .and(AGENT_WORK.STATE.eq(AgentWorkState.INPUT_REQUIRED))
        .and(AGENT_WORK.ENDED_AT.isNull());
  }

  /**
   * 내 열린 이슈 — 지금 담당인 열린 이슈 전부와, 보고자이면서 AI 답변을 기다리는 열린 이슈. 한 사람이 맡은 열린 이슈는 많아야 수백 건이라 전부 가져와 자바에서
   * 타일·상위 목록을 나눈다(타일 넷 × 상위 3건을 쿼리 넷으로 나누지 않게).
   */
  public List<OpenIssueRow> findOpenIssues(long userId) {
    Field<Boolean> assigned =
        DSL.field(
            DSL.exists(
                DSL.selectOne()
                    .from(ISSUE_ASSIGNEE)
                    .where(ISSUE_ASSIGNEE.ISSUE_ID.eq(ISSUE.ID))
                    .and(ISSUE_ASSIGNEE.USER_ID.eq(userId))));
    Field<OffsetDateTime> waitingSince =
        DSL.field(
            DSL.select(DSL.min(AGENT_WORK.STATE_CHANGED_AT)).from(AGENT_WORK).where(waitingWork()));
    Field<Boolean> waiting =
        DSL.field(DSL.exists(DSL.selectOne().from(AGENT_WORK).where(waitingWork())));
    return dsl.select(
            ISSUE.ID,
            PROJECT.KEY,
            ISSUE.NUMBER,
            ISSUE.TITLE,
            ISSUE.DUE_DATE,
            ISSUE.UPDATED_AT,
            assigned,
            waiting,
            waitingSince)
        .from(ISSUE)
        .join(PROJECT)
        .on(PROJECT.ID.eq(ISSUE.PROJECT_ID))
        .where(metricsRepository.readableBy(userId))
        .and(alive())
        .and(ISSUE.STATUS.in(IssueStatuses.OPEN))
        .and(
            DSL.condition(assigned)
                .or(
                    ISSUE
                        .REPORTER_ID
                        .eq(userId)
                        .and(DSL.exists(DSL.selectOne().from(AGENT_WORK).where(waitingWork())))))
        .fetch(
            r ->
                new OpenIssueRow(
                    r.get(ISSUE.ID),
                    r.get(PROJECT.KEY),
                    r.get(ISSUE.NUMBER),
                    r.get(ISSUE.TITLE),
                    r.get(ISSUE.DUE_DATE),
                    r.get(ISSUE.UPDATED_AT),
                    Boolean.TRUE.equals(r.get(assigned)),
                    Boolean.TRUE.equals(r.get(waiting)),
                    r.get(waitingSince)));
  }

  /**
   * 끝낸 이슈들의 키·제목·본문 앞부분. 권한은 지표 모듈이 이미 거른 id 만 들어온다. 지표 모듈이 센 뒤 이슈·프로젝트가 지워진 경합이면 그 id 는 빠진다 — 서비스가
   * 표시 정보 없는 건을 목록에서 뺀다.
   */
  public Map<Long, IssueDisplay> findDisplays(Collection<Long> issueIds) {
    Map<Long, IssueDisplay> out = new HashMap<>();
    if (issueIds.isEmpty()) return out;
    Field<String> head = DSL.left(ISSUE.BODY, RAW_HEAD_CHARS);
    dsl.select(ISSUE.ID, PROJECT.KEY, ISSUE.NUMBER, ISSUE.TITLE, head)
        .from(ISSUE)
        .join(PROJECT)
        .on(PROJECT.ID.eq(ISSUE.PROJECT_ID))
        .where(ISSUE.ID.eq(DSL.any(issueIds.toArray(Long[]::new))))
        .and(alive())
        .forEach(
            r ->
                out.put(
                    r.get(ISSUE.ID),
                    new IssueDisplay(
                        r.get(ISSUE.ID),
                        r.get(PROJECT.KEY),
                        r.get(ISSUE.NUMBER),
                        r.get(ISSUE.TITLE),
                        r.get(head))));
    return out;
  }

  /**
   * 이슈별 마지막(가장 최근) 활성 코멘트 — PostgreSQL {@code DISTINCT ON (issue_id)} 한 문장. 같은 시각이면 나중에 넣은 것(id 큰
   * 것)이 마지막이다.
   */
  public Map<Long, CommentHead> findLastComments(Collection<Long> issueIds) {
    Map<Long, CommentHead> out = new HashMap<>();
    if (issueIds.isEmpty()) return out;
    Field<String> head = DSL.left(ISSUE_COMMENT.BODY, RAW_HEAD_CHARS);
    dsl.selectDistinct(ISSUE_COMMENT.ISSUE_ID, USER.NAME, head)
        .on(ISSUE_COMMENT.ISSUE_ID)
        .from(ISSUE_COMMENT)
        .join(USER)
        .on(USER.ID.eq(ISSUE_COMMENT.AUTHOR_ID))
        .where(ISSUE_COMMENT.ISSUE_ID.eq(DSL.any(issueIds.toArray(Long[]::new))))
        .and(ISSUE_COMMENT.DELETED_AT.isNull())
        .orderBy(ISSUE_COMMENT.ISSUE_ID, ISSUE_COMMENT.CREATED_AT.desc(), ISSUE_COMMENT.ID.desc())
        .forEach(
            r ->
                out.put(
                    r.get(ISSUE_COMMENT.ISSUE_ID),
                    new CommentHead(r.get(ISSUE_COMMENT.ISSUE_ID), r.get(USER.NAME), r.get(head))));
    return out;
  }

  /**
   * 이슈별 함께한 AI 이름 — 지금 담당인 AI 와 그 이슈에서 작업 기록(agent_work)을 남긴 AI 의 합집합. 이름 순으로 중복 없이.
   *
   * @param currentOnly true 면 지금 담당인 AI 만(앞으로 할 일 — 지금 누가 함께 하는지)
   */
  public Map<Long, List<String>> findAiNames(Collection<Long> issueIds, boolean currentOnly) {
    Map<Long, List<String>> out = new HashMap<>();
    if (issueIds.isEmpty()) return out;
    Long[] ids = issueIds.toArray(Long[]::new);
    Field<Long> issueId = DSL.field("pair_issue_id", Long.class);
    Field<Long> userId = DSL.field("pair_user_id", Long.class);
    var assignees =
        DSL.select(
                ISSUE_ASSIGNEE.ISSUE_ID.as("pair_issue_id"),
                ISSUE_ASSIGNEE.USER_ID.as("pair_user_id"))
            .from(ISSUE_ASSIGNEE)
            .where(ISSUE_ASSIGNEE.ISSUE_ID.eq(DSL.any(ids)));
    var pairs =
        currentOnly
            ? assignees
            : assignees.union(
                DSL.select(AGENT_WORK.ISSUE_ID, AGENT_WORK.WORKER_ID)
                    .from(AGENT_WORK)
                    .where(AGENT_WORK.ISSUE_ID.eq(DSL.any(ids))));
    var t = pairs.asTable("ai_pairs");
    Map<Long, Set<String>> names = new LinkedHashMap<>();
    dsl.select(t.field(issueId), USER.NAME)
        .from(t)
        .join(USER)
        .on(USER.ID.eq(t.field(userId)))
        .where(USER.KIND.eq(UserKind.AGENT))
        .orderBy(USER.NAME)
        .forEach(
            r ->
                names
                    .computeIfAbsent(r.get(t.field(issueId)), k -> new LinkedHashSet<>())
                    .add(r.get(USER.NAME)));
    names.forEach((k, v) -> out.put(k, new ArrayList<>(v)));
    return out;
  }

  /** 사람 id → 이름 — 본문·코멘트의 멘션 토큰({@code <@id>})을 이름으로 바꿀 때 한 번에 조회한다. */
  public Map<Long, String> findNames(Collection<Long> userIds) {
    Map<Long, String> out = new HashMap<>();
    if (userIds.isEmpty()) return out;
    dsl.select(USER.ID, USER.NAME)
        .from(USER)
        .where(USER.ID.eq(DSL.any(userIds.toArray(Long[]::new))))
        .forEach(r -> out.put(r.get(USER.ID), r.get(USER.NAME)));
    return out;
  }
}
