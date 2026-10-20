package com.workplace.issue.service;

import static com.workplace.jooq.Tables.AGENT_WORK;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.dto.CreateCommentRequest;
import com.workplace.issue.dto.UpdateCommentRequest;
import com.workplace.issue.outbound.IssueDomainEvents.IssueCommentDeletedEvent;
import com.workplace.issue.outbound.IssueDomainEvents.IssueCommentUpdatedEvent;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.repository.ProjectIssueSequenceRepository;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;
import org.springframework.transaction.annotation.Transactional;

/**
 * 코멘트 수정/삭제 시 도메인 이벤트 발행 검증(#717).
 *
 * <p>생성(create)만 {@code IssueCommentedEvent} 를 publish 하고 update()/delete() 는 이벤트를 전혀 발행하지 않아 다른
 * 탭/사용자에게 SSE 로 실시간 반영되지 않던 갭을 메운 수정을 검증한다.
 */
@RecordApplicationEvents
@Transactional
class IssueCommentServiceEventTest extends IntegrationTestBase {

  @Autowired IssueCommentService commentService;
  @Autowired IssueTypeService issueTypeService;
  @Autowired IssueRepository issueRepository;
  @Autowired ProjectIssueSequenceRepository sequenceRepository;
  @Autowired DSLContext dsl;
  @Autowired ApplicationEvents events;

  @BeforeEach
  void setTenant() {
    TenantContext.set(1L);
  }

  private OpenScenario.Result openScenario() {
    return OpenScenario.create(dsl, issueTypeService, issueRepository, sequenceRepository, 1L);
  }

  /** WP-564 — 프로젝트가 삭제된 이슈에 코멘트를 쓰면 404 안내에 내부 프로젝트 id 를 싣지 않는다. */
  @Test
  void create_onDeletedProject_messageHasNoInternalId() {
    var s = openScenario();
    dsl.update(com.workplace.jooq.Tables.PROJECT)
        .set(com.workplace.jooq.Tables.PROJECT.DELETED_AT, java.time.OffsetDateTime.now())
        .where(com.workplace.jooq.Tables.PROJECT.KEY.eq(s.projectKey()))
        .execute();

    org.assertj.core.api.Assertions.assertThatThrownBy(
            () ->
                commentService.create(
                    s.reporterId(), s.issueId(), new CreateCommentRequest("삭제 후")))
        // WP-588: 삭제된 프로젝트의 이슈도 없는 이슈와 같은 404·같은 문구.
        .isInstanceOf(com.workplace.issue.exception.IssueNotFoundException.class)
        .hasMessage("이슈를 찾을 수 없습니다");
  }

  /** 코멘트 수정 시 IssueCommentUpdatedEvent 가 정확한 issueId/commentId/body 로 발행돼야 한다. */
  @Test
  void update_publishesCommentUpdatedEvent() {
    var s = openScenario();
    var comment =
        commentService.create(s.reporterId(), s.issueId(), new CreateCommentRequest("원본"));

    commentService.update(
        s.reporterId(), s.issueId(), comment.id(), new UpdateCommentRequest("수정된 내용"));

    var updated = events.stream(IssueCommentUpdatedEvent.class).toList();
    assertThat(updated).hasSize(1);
    assertThat(updated.get(0).issueId()).isEqualTo(s.issueId());
    assertThat(updated.get(0).commentId()).isEqualTo(comment.id());
    assertThat(updated.get(0).commentBody()).isEqualTo("수정된 내용");
    assertThat(updated.get(0).projectKey()).isEqualTo(s.projectKey());
    assertThat(updated.get(0).issueNumber()).isEqualTo(s.issueNumber());
  }

  /** 코멘트 삭제 시 IssueCommentDeletedEvent 가 정확한 issueId/commentId 로 발행돼야 한다. */
  @Test
  void delete_publishesCommentDeletedEvent() {
    var s = openScenario();
    var comment =
        commentService.create(s.reporterId(), s.issueId(), new CreateCommentRequest("삭제될 코멘트"));

    commentService.delete(s.reporterId(), s.issueId(), comment.id());

    var deleted = events.stream(IssueCommentDeletedEvent.class).toList();
    assertThat(deleted).hasSize(1);
    assertThat(deleted.get(0).issueId()).isEqualTo(s.issueId());
    assertThat(deleted.get(0).commentId()).isEqualTo(comment.id());
    assertThat(deleted.get(0).projectKey()).isEqualTo(s.projectKey());
    assertThat(deleted.get(0).issueNumber()).isEqualTo(s.issueNumber());
  }

  /** 사람이 댓글로 답하면 답변 필요로 멈춘 AI 구성원 작업이 작업 중으로 돌아온다(WP-377 §4.3). */
  @Test
  void create_사람댓글은_AI구성원_INPUT_REQUIRED_작업을_WORKING으로() {
    var s = openScenario();
    long agentId = TestFixtures.createAgentNoToken(dsl);
    dsl.insertInto(AGENT_WORK)
        .set(AGENT_WORK.ISSUE_ID, s.issueId())
        .set(AGENT_WORK.WORKER_ID, agentId)
        .set(AGENT_WORK.TOOL, "claude-code")
        .set(AGENT_WORK.STATE, "INPUT_REQUIRED")
        .execute();

    commentService.create(s.reporterId(), s.issueId(), new CreateCommentRequest("이렇게 해주세요"));

    var state =
        dsl.select(AGENT_WORK.STATE)
            .from(AGENT_WORK)
            .where(AGENT_WORK.ISSUE_ID.eq(s.issueId()))
            .and(AGENT_WORK.WORKER_ID.eq(agentId))
            .fetchOne(AGENT_WORK.STATE);
    assertThat(state).isEqualTo("WORKING");
  }
}
