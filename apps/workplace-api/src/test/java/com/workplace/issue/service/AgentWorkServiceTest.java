package com.workplace.issue.service;

import static com.workplace.jooq.Tables.AGENT_WORK;
import static com.workplace.jooq.Tables.ISSUE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.issue.dto.AgentWorkPatch;
import com.workplace.issue.dto.AgentWorkView;
import com.workplace.issue.exception.AgentWorkIssueClosedException;
import com.workplace.issue.outbound.IssueHumanReplyPosted;
import com.workplace.issue.repository.AgentWorkRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** AgentWorkService 통합 테스트(WP-377) — 보고 생성/갱신·급한 순 정렬과 무소식·사람 응답 복귀·일괄 종료. */
@Transactional
class AgentWorkServiceTest extends IntegrationTestBase {

  @Autowired AgentWorkService service;
  @Autowired AgentWorkRepository repo;
  @Autowired DSLContext dsl;
  @Autowired IssueRepository issueRepository;
  @Autowired ProjectService projectService;

  long humanId;
  long agentId;
  long issueId;

  /** 사람·AI 구성원과 프로젝트의 이슈 1건을 만든다. */
  @BeforeEach
  void setUp() {
    humanId = TestFixtures.createHuman(dsl);
    agentId = TestFixtures.createAgentNoToken(dsl);
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 6);
    var project =
        projectService.create(humanId, new CreateProjectRequest("W" + suffix, "PW-" + suffix, "x"));
    issueId = issueRepository.insert(project.id(), 1, "i1", null, "MID", null, humanId).id();
  }

  @Test
  void startOrUpdate_없으면_WORKING_생성_있으면_보낸필드만() {
    var v = service.startOrUpdate(issueId, humanId, "claude-code", AgentWorkPatch.empty());
    assertThat(v.state()).isEqualTo("WORKING");
    var v2 =
        service.startOrUpdate(
            issueId,
            humanId,
            "cursor",
            new AgentWorkPatch(null, "REVIEW", "PR 올림", false, 100, null, null));
    assertThat(v2.state()).isEqualTo("REVIEW");
    assertThat(v2.tool()).isEqualTo("cursor");
    assertThat(v2.note()).isEqualTo("PR 올림");
  }

  @Test
  void viewsByIssueIds_급한순_정렬과_무소식() {
    service.startOrUpdate(issueId, humanId, "claude-code", AgentWorkPatch.empty());
    service.startOrUpdate(
        issueId,
        agentId,
        "claude-code",
        new AgentWorkPatch(null, "WAITING", "질문", false, null, null, null));
    // 사람 작업을 3시간 전으로 — 무소식
    dsl.update(AGENT_WORK)
        .set(AGENT_WORK.UPDATED_AT, OffsetDateTime.now().minusHours(3))
        .where(AGENT_WORK.WORKER_ID.eq(humanId))
        .execute();
    var list = service.viewsByIssueIds(List.of(issueId)).get(issueId);
    assertThat(list).extracting(AgentWorkView::state).containsExactly("WAITING", "WORKING");
    assertThat(list.get(1).stale()).isTrue();
    assertThat(list.get(0).stale()).isFalse(); // WAITING 은 무소식 경고 없음
  }

  @Test
  void onHumanReply_는_AI구성원_답변필요를_작업중으로() {
    service.startOrUpdate(
        issueId,
        agentId,
        "claude-code",
        new AgentWorkPatch(null, "WAITING", null, false, null, null, null));
    service.onHumanReply(new IssueHumanReplyPosted(issueId));
    assertThat(repo.findActive(issueId, agentId).orElseThrow().state()).isEqualTo("WORKING");
  }

  @Test
  void startOrUpdate_종료된_이슈면_NPE_대신_AgentWorkIssueClosedException() {
    // 보고 검증을 우회해 서비스를 직접 호출 — 동시 종료로 조회에서 이슈가 빠지는 경합과 같은 상황.
    dsl.update(ISSUE).set(ISSUE.STATUS, "DONE").where(ISSUE.ID.eq(issueId)).execute();
    assertThatThrownBy(
            () -> service.startOrUpdate(issueId, humanId, "claude-code", AgentWorkPatch.empty()))
        .isInstanceOf(AgentWorkIssueClosedException.class);
  }

  @Test
  void end_는_진행중이면_true_없으면_false() {
    service.startOrUpdate(issueId, humanId, "claude-code", AgentWorkPatch.empty());
    assertThat(service.end(issueId, humanId)).isTrue();
    assertThat(service.end(issueId, humanId)).isFalse();
  }

  @Test
  void endAllForIssue_진행중_전부_종료() {
    service.startOrUpdate(issueId, humanId, "claude-code", AgentWorkPatch.empty());
    service.startOrUpdate(issueId, agentId, "claude-code", AgentWorkPatch.empty());
    service.endAllForIssues(List.of(issueId));
    assertThat(service.viewsByIssueIds(List.of(issueId))).doesNotContainKey(issueId);
  }
}
