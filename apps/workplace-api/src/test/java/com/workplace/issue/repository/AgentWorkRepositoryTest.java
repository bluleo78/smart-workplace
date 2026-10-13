package com.workplace.issue.repository;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.issue.dto.AgentWorkPatch;
import com.workplace.issue.dto.AgentWorkState;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** AgentWorkRepository 통합 테스트(WP-377) — 진행 중 1건 유니크·부분 갱신·일괄 조회·답변 필요 복귀·DB 제약. */
@Transactional
class AgentWorkRepositoryTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired AgentWorkRepository repo;
  @Autowired IssueRepository issueRepository;
  @Autowired ProjectService projectService;

  long humanId;
  long agentId;
  long issueId;
  long otherIssueId;

  /** 사람·AI 사용자와 같은 프로젝트의 이슈 2건을 만든다. */
  @BeforeEach
  void setUp() {
    humanId = TestFixtures.createHuman(dsl);
    agentId = TestFixtures.createAgentNoToken(dsl);
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 6);
    var project =
        projectService.create(humanId, new CreateProjectRequest("W" + suffix, "PW-" + suffix, "x"));
    issueId = issueRepository.insert(project.id(), 1, "i1", null, "MID", null, humanId).id();
    otherIssueId = issueRepository.insert(project.id(), 2, "i2", null, "MID", null, humanId).id();
  }

  @Test
  void insertIfAbsent_같은_이슈_작업자는_진행중_한건만() {
    var a =
        repo.insertIfAbsent(issueId, humanId, "claude-code", AgentWorkState.WORKING).orElseThrow();
    var b = repo.insertIfAbsent(issueId, humanId, "cursor", AgentWorkState.WAITING).orElseThrow();
    assertThat(b.id()).isEqualTo(a.id());
    assertThat(b.tool()).isEqualTo("claude-code"); // 경합 시 기존 행 그대로
  }

  @Test
  void endActive_후_다시_만들면_새_행() {
    var a = repo.insertIfAbsent(issueId, humanId, "claude-code", "WORKING").orElseThrow();
    assertThat(repo.endActive(List.of(issueId))).isEqualTo(1);
    assertThat(repo.findActive(issueId, humanId)).isEmpty();
    var b = repo.insertIfAbsent(issueId, humanId, "claude-code", "WORKING").orElseThrow();
    assertThat(b.id()).isNotEqualTo(a.id());
  }

  @Test
  void update_null_은_유지_clearNote_는_지움() {
    var a = repo.insertIfAbsent(issueId, humanId, "claude-code", "WORKING").orElseThrow();
    repo.update(a.id(), new AgentWorkPatch(null, null, "헤더 처리 중", false, 40, null, null));
    repo.update(a.id(), new AgentWorkPatch(null, "REVIEW", null, false, null, 3, 5));
    var r = repo.findActive(issueId, humanId).orElseThrow();
    assertThat(r.note()).isEqualTo("헤더 처리 중");
    assertThat(r.progress()).isEqualTo(40);
    assertThat(r.stepsDone()).isEqualTo(3);
    assertThat(r.state()).isEqualTo("REVIEW");
    repo.update(a.id(), new AgentWorkPatch(null, null, null, true, null, null, null));
    assertThat(repo.findActive(issueId, humanId).orElseThrow().note()).isNull();
  }

  @Test
  void findActiveByIssueIds_한번에_작업자_포함() {
    repo.insertIfAbsent(issueId, humanId, "claude-code", "WORKING");
    repo.insertIfAbsent(issueId, agentId, "claude-code", "WAITING");
    repo.insertIfAbsent(otherIssueId, humanId, "cursor", "PAUSED");
    var m = repo.findActiveByIssueIds(List.of(issueId, otherIssueId));
    assertThat(m.get(issueId)).hasSize(2);
    assertThat(m.get(issueId))
        .extracting(w -> w.worker().kind())
        .containsExactlyInAnyOrder("HUMAN", "AGENT");
    assertThat(m.get(otherIssueId))
        .singleElement()
        .extracting(w -> w.work().tool())
        .isEqualTo("cursor");
  }

  @Test
  void resumeWaitingAgents_는_AI_구성원의_답변필요만_되돌림() {
    repo.insertIfAbsent(issueId, humanId, "claude-code", "WAITING");
    repo.insertIfAbsent(issueId, agentId, "claude-code", "WAITING");
    assertThat(repo.resumeWaitingAgents(issueId)).isEqualTo(1);
    assertThat(repo.findActive(issueId, agentId).orElseThrow().state()).isEqualTo("WORKING");
    assertThat(repo.findActive(issueId, humanId).orElseThrow().state()).isEqualTo("WAITING");
  }

  @Test
  void 단계_제약_위반은_DB_가_거절() {
    var a = repo.insertIfAbsent(issueId, humanId, "claude-code", "WORKING").orElseThrow();
    assertThatThrownBy(
            () -> repo.update(a.id(), new AgentWorkPatch(null, null, null, false, null, 6, 5)))
        .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
  }
}
