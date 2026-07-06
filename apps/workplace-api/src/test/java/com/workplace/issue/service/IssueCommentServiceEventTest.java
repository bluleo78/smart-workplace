package com.workplace.issue.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.dto.CreateCommentRequest;
import com.workplace.issue.dto.UpdateCommentRequest;
import com.workplace.issue.outbound.IssueDomainEvents.IssueCommentDeletedEvent;
import com.workplace.issue.outbound.IssueDomainEvents.IssueCommentUpdatedEvent;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.repository.ProjectIssueSequenceRepository;
import com.workplace.support.IntegrationTestBase;
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
}
