package com.workplace.issue.workflow.repository;

import com.workplace.jooq.tables.records.NodeRunRecord;
import com.workplace.jooq.tables.records.WorkflowRunEventRecord;
import com.workplace.jooq.tables.records.WorkflowRunRecord;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.Arrays;
import java.util.List;
import org.jooq.JSONB;

/**
 * 실행 저장소의 jOOQ 레코드 → 행 record 변환 모음(WP-1985). 행 record({@link RunRow}·{@link NodeRunRow}·{@link
 * RunEventRow}·{@link IdempotentRow})는 각자 파일에 있고, 변환(시각은 Instant, JSONB 는 글, 배열은 List)만 여기에 모아 저장소가
 * 같은 규칙을 한 곳에서 쓴다.
 */
final class WorkflowRunRows {

  private WorkflowRunRows() {}

  /** 실행 레코드를 행으로. */
  static RunRow toRun(WorkflowRunRecord r) {
    return new RunRow(
        r.getId(),
        r.getIssueId(),
        r.getWorkflowVersionId(),
        r.getStatus(),
        r.getCurrentNode(),
        r.getContext().data(),
        r.getRevision(),
        r.getStartedBy(),
        r.getStartedAt().toInstant(),
        instant(r.getEndedAt()));
  }

  /** 노드 방문 레코드를 행으로 — 배열 칸은 순서 그대로 불변 List 로. */
  static NodeRunRow toNodeRun(NodeRunRecord r) {
    return new NodeRunRow(
        r.getId(),
        r.getRunId(),
        r.getNodeKey(),
        r.getVisitNo(),
        r.getStatus(),
        list(r.getAssigneeIds()),
        list(r.getWorkflowAssignedIds()),
        r.getOutcome(),
        text(r.getOutputs()),
        r.getCommentId(),
        r.getWaitingReason(),
        r.getError(),
        r.getEnteredAt().toInstant(),
        instant(r.getLeftAt()),
        r.getActorId(),
        r.getViaReturn());
  }

  /** 이벤트 레코드를 행으로. */
  static RunEventRow toEvent(WorkflowRunEventRecord r) {
    return new RunEventRow(
        r.getId(),
        r.getRunId(),
        r.getType(),
        r.getPayload().data(),
        r.getActorId(),
        r.getAt().toInstant());
  }

  private static List<Long> list(Long[] a) {
    return a == null ? List.of() : List.copyOf(Arrays.asList(a));
  }

  private static String text(JSONB j) {
    return j == null ? null : j.data();
  }

  private static Instant instant(OffsetDateTime t) {
    return t == null ? null : t.toInstant();
  }
}
