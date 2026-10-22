package com.workplace.issue.integration;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.NOTIFICATION;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;

import com.workplace.global.realtime.SseRegistry;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.repository.IssueCommentRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.issue.service.IssueCommentReactionService;
import com.workplace.issue.service.IssueTypeService;
import com.workplace.issue.service.OpenScenario;
import com.workplace.project.repository.ProjectIssueSequenceRepository;
import com.workplace.support.IntegrationTestBase;
import com.workplace.watcher.repository.IssueWatcherRepository;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 이슈 코멘트 반응 → SSE fan-out 통합 테스트(WP-504).
 *
 * <p>커밋 뒤에만 보내는(AfterCommit) 경로라 @Transactional 을 붙이지 않는다 — 채팅 ReactionSseFanOutTest 와 같은 방식.
 * SseRegistry 를 mock 으로 가로채 watcher 에게 {@code issue.comment_reactions_changed} 가 가는지, watcher 가 아닌
 * 반응자는 받지 않는지(반응은 watcher 로 등록하지 않는다), 알림이 생기지 않는지 확인한다. 커밋된 시드는 @AfterEach 에서 이 테스트가 만든 것만 지운다.
 */
class IssueCommentReactionSseTest extends IntegrationTestBase {

  /** 실제 SSE 연결 없이 fan-out 호출을 캡처한다. */
  @MockitoBean SseRegistry registry;

  @Autowired DSLContext dsl;
  @Autowired IssueCommentReactionService reactionService;
  @Autowired IssueCommentRepository commentRepository;
  @Autowired IssueWatcherRepository watcherRepository;
  @Autowired IssueTypeService issueTypeService;
  @Autowired IssueRepository issueRepository;
  @Autowired ProjectIssueSequenceRepository sequenceRepository;

  private OpenScenario.Result s;
  private long commentId;

  /** 테넌트 1 에 OPEN 프로젝트·이슈·OWNER 코멘트를 커밋하고, OWNER 만 watcher 로 둔다. */
  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    new TransactionTemplate(txManager)
        .executeWithoutResult(
            status -> {
              s =
                  OpenScenario.create(
                      dsl, issueTypeService, issueRepository, sequenceRepository, 1L);
              commentId = commentRepository.insert(s.issueId(), s.ownerId(), "코멘트").id();
              watcherRepository.add(s.issueId(), s.ownerId());
            });
  }

  /** 이 테스트가 만든 이슈(코멘트·반응·watcher CASCADE)·프로젝트·사용자만 지운다. */
  @AfterEach
  void cleanup() {
    if (s != null) {
      List<Long> users = List.of(s.ownerId(), s.memberId(), s.reporterId(), s.strangerId());
      cleanupInTenant(
          1L,
          () -> {
            dsl.deleteFrom(ISSUE).where(ISSUE.PROJECT_ID.eq(s.project().id())).execute();
            dsl.deleteFrom(PROJECT).where(PROJECT.ID.eq(s.project().id())).execute();
            dsl.deleteFrom(USER).where(USER.ID.in(users)).execute();
          });
    }
    TenantContext.clear();
  }

  /** 멤버가 반응을 달면 watcher(OWNER)에게 commentId·actorId 가 담긴 이벤트가 가고, watcher 가 아닌 반응자는 받지 않는다. */
  @Test
  void reaction_fans_out_to_watchers_only() {
    reactionService.add(s.memberId(), s.issueId(), commentId, "👍");

    @SuppressWarnings("unchecked")
    ArgumentCaptor<Collection<Long>> ids = ArgumentCaptor.forClass(Collection.class);
    @SuppressWarnings("unchecked")
    ArgumentCaptor<Map<String, Object>> payload = ArgumentCaptor.forClass(Map.class);
    verify(registry, timeout(2000))
        .fanOut(ids.capture(), eq("issue.comment_reactions_changed"), payload.capture());
    assertThat(ids.getValue()).containsExactly(s.ownerId());
    assertThat(payload.getValue())
        .containsEntry("projectKey", s.projectKey())
        .containsEntry("issueNumber", s.issueNumber())
        .containsEntry("issueId", s.issueId())
        .containsEntry("issueKey", s.projectKey() + "-" + s.issueNumber())
        .containsEntry("commentId", commentId)
        .containsEntry("actorId", s.memberId());

    // 커밋 뒤에도 반응자는 watcher 가 아니고, 코멘트 작성자에게 알림이 생기지 않는다.
    assertThat(watcherRepository.findUserIdsByIssue(s.issueId())).containsExactly(s.ownerId());
    assertThat(
            dsl.fetchCount(NOTIFICATION, NOTIFICATION.RECIPIENT_ID.in(s.ownerId(), s.memberId())))
        .isZero();
  }

  /** 반응 취소도 같은 이벤트로 watcher 에게 간다. */
  @Test
  void removal_fans_out_same_event() {
    reactionService.add(s.memberId(), s.issueId(), commentId, "🎉");
    verify(registry, timeout(2000))
        .fanOut(
            org.mockito.ArgumentMatchers.any(),
            eq("issue.comment_reactions_changed"),
            org.mockito.ArgumentMatchers.any());
    org.mockito.Mockito.reset(registry);

    reactionService.remove(s.memberId(), s.issueId(), commentId, "🎉");

    @SuppressWarnings("unchecked")
    ArgumentCaptor<Map<String, Object>> payload = ArgumentCaptor.forClass(Map.class);
    verify(registry, timeout(2000))
        .fanOut(eq(List.of(s.ownerId())), eq("issue.comment_reactions_changed"), payload.capture());
    assertThat(payload.getValue()).containsEntry("commentId", commentId);
  }
}
