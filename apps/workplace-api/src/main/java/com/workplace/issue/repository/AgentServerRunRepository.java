package com.workplace.issue.repository;

import static com.workplace.jooq.Tables.AGENT_SERVER_RUN;

import java.time.Duration;
import java.util.Collection;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;

/**
 * 서버 AI 의 도는 이슈 실행(agent_server_run, WP-1986). ai-agent 가 실행마다 만든 runId 를 STARTED 에 넣고 FINISHED 에
 * 지워, 끝 보고가 그 (이슈, AI) 의 마지막 도는 실행의 것인지 가른다. 시각은 서버 시계(DB now())만 쓴다 — ai-agent 시계와 비교하지 않는다.
 */
@Repository
@RequiredArgsConstructor
public class AgentServerRunRepository {

  private final DSLContext dsl;

  /**
   * 실행 시작을 넣는다 — 같은 실행이 이미 있으면(보고 재시도) 아무것도 하지 않는다. 그 (이슈, AI) 의 오래된 행({@code staleAfter} 보다 오래전에
   * 시작 — FINISHED 없이 죽은 실행)도 함께 지워 표에 쌓이지 않게 한다.
   */
  public void insertStarted(long issueId, long agentId, UUID runId, Duration staleAfter) {
    dsl.deleteFrom(AGENT_SERVER_RUN)
        .where(AGENT_SERVER_RUN.ISSUE_ID.eq(issueId))
        .and(AGENT_SERVER_RUN.AGENT_ID.eq(agentId))
        .and(AGENT_SERVER_RUN.STARTED_AT.le(AgentWorkRepository.staleBefore(staleAfter)))
        .execute();
    dsl.insertInto(AGENT_SERVER_RUN)
        .set(AGENT_SERVER_RUN.ISSUE_ID, issueId)
        .set(AGENT_SERVER_RUN.AGENT_ID, agentId)
        .set(AGENT_SERVER_RUN.RUN_ID, runId)
        .onConflictDoNothing()
        .execute();
  }

  /** 실행 끝 — 그 실행의 행을 지운다(모르는 실행·이미 지운 실행이면 아무것도 하지 않는다). */
  public void deleteFinished(long issueId, long agentId, UUID runId) {
    dsl.deleteFrom(AGENT_SERVER_RUN)
        .where(AGENT_SERVER_RUN.ISSUE_ID.eq(issueId))
        .and(AGENT_SERVER_RUN.AGENT_ID.eq(agentId))
        .and(AGENT_SERVER_RUN.RUN_ID.eq(runId))
        .execute();
  }

  /**
   * (이슈, AI) 에 아직 도는 실행이 있는지 — {@code staleAfter} 보다 오래전에 시작한 행은 FINISHED 없이 죽은 실행으로 보고 세지 않는다. 기준
   * 시각은 DB 의 now() 다(같은 서버 시계로 넣은 started_at 과 비교).
   */
  public boolean hasLiveRun(long issueId, long agentId, Duration staleAfter) {
    return dsl.fetchExists(
        AGENT_SERVER_RUN,
        AGENT_SERVER_RUN
            .ISSUE_ID
            .eq(issueId)
            .and(AGENT_SERVER_RUN.AGENT_ID.eq(agentId))
            .and(AGENT_SERVER_RUN.STARTED_AT.gt(AgentWorkRepository.staleBefore(staleAfter))));
  }

  /** 이슈에서 지정한 AI 들의 도는 실행 행을 지운다 — 담당에서 빠질 때(그 뒤의 끝 보고는 담당 확인에서 넘어간다). */
  public void deleteForWorkers(long issueId, Collection<Long> agentIds) {
    if (agentIds == null || agentIds.isEmpty()) return;
    dsl.deleteFrom(AGENT_SERVER_RUN)
        .where(AGENT_SERVER_RUN.ISSUE_ID.eq(issueId))
        .and(AGENT_SERVER_RUN.AGENT_ID.in(agentIds))
        .execute();
  }

  /** 이슈들의 도는 실행 행을 모두 지운다 — 이슈 완료·취소·삭제 때(그 뒤의 끝 보고는 모르는 실행으로 넘어간다). */
  public void deleteByIssues(Collection<Long> issueIds) {
    if (issueIds == null || issueIds.isEmpty()) return;
    dsl.deleteFrom(AGENT_SERVER_RUN).where(AGENT_SERVER_RUN.ISSUE_ID.in(issueIds)).execute();
  }
}
