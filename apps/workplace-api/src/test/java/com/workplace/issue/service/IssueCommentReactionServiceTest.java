package com.workplace.issue.service;

import static com.workplace.jooq.Tables.NOTIFICATION;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.dto.CommentReactionResponse;
import com.workplace.issue.dto.UpdateCommentRequest;
import com.workplace.issue.exception.IssueCommentNotFoundException;
import com.workplace.issue.exception.IssueNotFoundException;
import com.workplace.issue.outbound.IssueDomainEvents.IssueCommentReactionsChangedEvent;
import com.workplace.issue.repository.IssueCommentReactionRepository;
import com.workplace.issue.repository.IssueCommentRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.issue.support.IssueSeeds;
import com.workplace.project.exception.ProjectAccessDeniedException;
import com.workplace.project.repository.ProjectIssueSequenceRepository;
import com.workplace.support.IntegrationTestBase;
import com.workplace.watcher.repository.IssueWatcherRepository;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-504 이슈 코멘트 반응 서비스 통합 테스트. 권한(작성 권한=추가·취소, 읽기 권한=반응자 조회)·이모지 검증·멱등·상한·대상 코멘트 소속·알림/watcher 미발생·
 * 코멘트 응답(상세·목록)에 보는 사람별 reacted 를 실제 DB(RLS 테넌트 1)로 확인한다. @Transactional 롤백으로 격리.
 */
@Transactional
@RecordApplicationEvents
class IssueCommentReactionServiceTest extends IntegrationTestBase {

  @Autowired IssueCommentReactionService reactionService;
  @Autowired IssueCommentService commentService;
  @Autowired IssueService issueService;
  @Autowired IssueCommentReactionRepository reactionRepository;
  @Autowired IssueCommentRepository commentRepository;
  @Autowired IssueWatcherRepository watcherRepository;
  @Autowired IssueTypeService issueTypeService;
  @Autowired IssueRepository issueRepository;
  @Autowired ProjectIssueSequenceRepository sequenceRepository;
  @Autowired DSLContext dsl;
  @Autowired ApplicationEvents events;

  private OpenScenario.Result s;
  private long commentId;

  /** OPEN 프로젝트 이슈 하나와 OWNER 가 쓴 코멘트 하나를 준비한다(서비스 create 를 거치지 않아 watcher 가 생기지 않는다). */
  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    s = OpenScenario.create(dsl, issueTypeService, issueRepository, sequenceRepository, 1L);
    commentId = commentRepository.insert(s.issueId(), s.ownerId(), "코멘트").id();
  }

  /** 반응 변경 이벤트 수. */
  private long changedEvents() {
    return events.stream(IssueCommentReactionsChangedEvent.class).count();
  }

  /** 0x1F600(😀)부터 i 번째 이모지 — 상한 테스트에서 서로 다른 이모지를 만든다. */
  private static String emojiAt(int i) {
    return new String(Character.toChars(0x1F600 + i));
  }

  /** 멤버가 반응을 달면 집계에 [👍 1 내가 누름] 이 보이고, 취소하면 사라진다. 각각 이벤트를 하나씩 낸다. */
  @Test
  void member_adds_and_removes_reaction() {
    reactionService.add(s.memberId(), s.issueId(), commentId, "👍");
    var enriched =
        reactionService.enrich(commentService.list(s.memberId(), s.issueId()), s.memberId());
    assertThat(enriched.getFirst().reactions())
        .containsExactly(new CommentReactionResponse("👍", 1, true));

    reactionService.remove(s.memberId(), s.issueId(), commentId, "👍");
    assertThat(commentService.list(s.memberId(), s.issueId()).getFirst().reactions()).isEmpty();
    assertThat(changedEvents()).isEqualTo(2);

    var e = events.stream(IssueCommentReactionsChangedEvent.class).findFirst().orElseThrow();
    assertThat(e.issueId()).isEqualTo(s.issueId());
    assertThat(e.commentId()).isEqualTo(commentId);
    assertThat(e.actorId()).isEqualTo(s.memberId());
    assertThat(e.projectKey()).isEqualTo(s.projectKey());
    assertThat(e.issueNumber()).isEqualTo(s.issueNumber());
    assertThat(e.issueKey()).isEqualTo(s.projectKey() + "-" + s.issueNumber());
  }

  /** 같은 반응을 두 번 눌러도 한 번만 저장되고 이벤트도 한 번. 없는 반응 취소는 이벤트를 내지 않는다. */
  @Test
  void add_twice_is_idempotent_and_publishes_once() {
    reactionService.add(s.memberId(), s.issueId(), commentId, "👍");
    reactionService.add(s.memberId(), s.issueId(), commentId, "👍");
    assertThat(reactionRepository.countByUser(commentId, s.memberId())).isEqualTo(1);
    assertThat(changedEvents()).isEqualTo(1);

    reactionService.remove(s.memberId(), s.issueId(), commentId, "🎉");
    assertThat(changedEvents()).isEqualTo(1);
  }

  /** OPEN 프로젝트의 읽기만 가능한 사람은 반응을 달 수 없다(403). 반응자 목록은 볼 수 있다. */
  @Test
  void reader_cannot_react() {
    reactionService.add(s.memberId(), s.issueId(), commentId, "👍");

    assertThatThrownBy(() -> reactionService.add(s.strangerId(), s.issueId(), commentId, "👍"))
        .isInstanceOf(ProjectAccessDeniedException.class);
    assertThatThrownBy(() -> reactionService.remove(s.strangerId(), s.issueId(), commentId, "👍"))
        .isInstanceOf(ProjectAccessDeniedException.class);

    var page = reactionService.listReactors(s.strangerId(), s.issueId(), commentId, "👍", null, 20);
    assertThat(page.items())
        .singleElement()
        .satisfies(r -> assertThat(r.userId()).isEqualTo(s.memberId()));
    assertThat(page.hasMore()).isFalse();
    assertThat(page.nextCursor()).isNull();
  }

  /** 프로젝트를 볼 수 없는 사람에게는 이슈가 없는 것과 같은 404 — 추가·취소·반응자 조회 모두. */
  @Test
  void non_reader_gets_not_found() {
    var team =
        OpenScenario.createTeam(dsl, issueTypeService, issueRepository, sequenceRepository, 1L);
    long teamComment = commentRepository.insert(team.issueId(), team.ownerId(), "팀 코멘트").id();

    assertThatThrownBy(
            () -> reactionService.add(team.strangerId(), team.issueId(), teamComment, "👍"))
        .isInstanceOf(IssueNotFoundException.class);
    assertThatThrownBy(
            () -> reactionService.remove(team.strangerId(), team.issueId(), teamComment, "👍"))
        .isInstanceOf(IssueNotFoundException.class);
    assertThatThrownBy(
            () ->
                reactionService.listReactors(
                    team.strangerId(), team.issueId(), teamComment, "👍", null, 20))
        .isInstanceOf(IssueNotFoundException.class);
  }

  /** 이모지 하나가 아닌 값은 400(IllegalArgumentException). */
  @Test
  void rejects_non_emoji() {
    assertThatThrownBy(() -> reactionService.add(s.memberId(), s.issueId(), commentId, "abc"))
        .isInstanceOf(IllegalArgumentException.class);
    assertThat(changedEvents()).isZero();
  }

  /** 지워진 코멘트, 다른 이슈의 코멘트에는 반응할 수 없다 — 없는 코멘트와 같은 404. */
  @Test
  void rejects_deleted_or_foreign_comment() {
    commentRepository.softDelete(commentId);
    assertThatThrownBy(() -> reactionService.add(s.memberId(), s.issueId(), commentId, "👍"))
        .isInstanceOf(IssueCommentNotFoundException.class);

    int otherNumber = sequenceRepository.allocateNext(s.project().id());
    var other =
        IssueSeeds.insert(
            issueRepository,
            baseDsl,
            s.project().id(),
            otherNumber,
            "다른 이슈",
            "본문",
            "MID",
            null,
            s.ownerId());
    long foreign = commentRepository.insert(other.id(), s.ownerId(), "다른 이슈 코멘트").id();
    assertThatThrownBy(() -> reactionService.add(s.memberId(), s.issueId(), foreign, "👍"))
        .isInstanceOf(IssueCommentNotFoundException.class);
    assertThatThrownBy(
            () -> reactionService.listReactors(s.memberId(), s.issueId(), foreign, "👍", null, 20))
        .isInstanceOf(IssueCommentNotFoundException.class);
  }

  /** 한 사람은 코멘트 하나에 20개까지. 이미 단 것을 다시 누르는 건 상한과 무관하게 통과. */
  @Test
  void per_user_limit_20() {
    for (int i = 0; i < 20; i++) {
      reactionService.add(s.memberId(), s.issueId(), commentId, emojiAt(i));
    }
    reactionService.add(s.memberId(), s.issueId(), commentId, emojiAt(0));
    assertThatThrownBy(() -> reactionService.add(s.memberId(), s.issueId(), commentId, emojiAt(20)))
        .isInstanceOf(IllegalArgumentException.class);
    assertThat(reactionRepository.countByUser(commentId, s.memberId())).isEqualTo(20);
  }

  /** 코멘트 하나에 서로 다른 이모지는 50종까지. 이미 달린 이모지에 더하는 것은 된다. */
  @Test
  void distinct_limit_50() {
    // 1인 상한(20)을 피해 세 사람이 20+20+10 종을 미리 단다.
    long[] seeders = {s.ownerId(), s.memberId(), s.reporterId()};
    for (int i = 0; i < 50; i++) {
      reactionRepository.add(commentId, seeders[i / 20], emojiAt(i));
    }
    // 마지막 사람(reporter)은 10개만 달았으니 1인 상한이 아니라 종류 상한에 걸린다.
    assertThatThrownBy(
            () -> reactionService.add(s.reporterId(), s.issueId(), commentId, emojiAt(50)))
        .isInstanceOf(IllegalArgumentException.class);
    reactionService.add(s.reporterId(), s.issueId(), commentId, emojiAt(0));
    assertThat(reactionRepository.countDistinctEmojis(commentId)).isEqualTo(50);
  }

  /** 반응은 알림을 만들지 않고, 반응한 사람을 watcher 로 등록하지 않는다. */
  @Test
  void reaction_creates_no_notification_and_no_watcher() {
    int before = dsl.fetchCount(NOTIFICATION);
    reactionService.add(s.memberId(), s.issueId(), commentId, "👍");
    assertThat(dsl.fetchCount(NOTIFICATION)).isEqualTo(before);
    assertThat(watcherRepository.findUserIdsByIssue(s.issueId())).doesNotContain(s.memberId());
  }

  /** AI(AGENT) 가 쓴 코멘트에도 반응할 수 있다. */
  @Test
  void ai_comment_is_reactable() {
    long agentId = createAgentUser("rx-agent");
    long aiComment = commentRepository.insert(s.issueId(), agentId, "AI 답변").id();

    reactionService.add(s.memberId(), s.issueId(), aiComment, "🙏");

    assertThat(reactionRepository.exists(aiComment, s.memberId(), "🙏")).isTrue();
  }

  /** 이슈 상세·코멘트 목록 모두 반응을 싣고, reacted 는 보는 사람마다 다르다. */
  @Test
  void detail_and_list_include_reactions_per_caller() {
    reactionService.add(s.ownerId(), s.issueId(), commentId, "👍");

    var ownerDetail = issueService.get(s.ownerId(), s.projectKey(), s.issueNumber());
    var memberDetail = issueService.get(s.memberId(), s.projectKey(), s.issueNumber());
    assertThat(ownerDetail.comments().getFirst().reactions())
        .containsExactly(new CommentReactionResponse("👍", 1, true));
    assertThat(memberDetail.comments().getFirst().reactions())
        .containsExactly(new CommentReactionResponse("👍", 1, false));

    assertThat(commentService.list(s.ownerId(), s.issueId()).getFirst().reactions())
        .containsExactly(new CommentReactionResponse("👍", 1, true));
    assertThat(commentService.list(s.memberId(), s.issueId()).getFirst().reactions())
        .containsExactly(new CommentReactionResponse("👍", 1, false));
  }

  /** 반응이 달린 코멘트를 고쳐도 반응은 남는다 — 수정 응답·목록 모두. */
  @Test
  void update_keeps_reactions() {
    reactionService.add(s.memberId(), s.issueId(), commentId, "🎉");

    var updated =
        commentService.update(
            s.ownerId(), s.issueId(), commentId, new UpdateCommentRequest("고친 코멘트"));

    var expected = new CommentReactionResponse("🎉", 1, false);
    assertThat(updated.reactions()).containsExactly(expected);
    assertThat(commentService.list(s.ownerId(), s.issueId()).getFirst())
        .satisfies(
            c -> {
              assertThat(c.body()).isEqualTo("고친 코멘트");
              assertThat(c.reactions()).containsExactly(expected);
            });
  }

  /** 반응자 목록은 limit 로 잘리고 커서로 이어 받는다. limit 은 1~50 으로 맞춘다. */
  @Test
  void list_reactors_paginates_and_clamps_limit() {
    reactionService.add(s.ownerId(), s.issueId(), commentId, "👍");
    reactionService.add(s.memberId(), s.issueId(), commentId, "👍");

    var first = reactionService.listReactors(s.memberId(), s.issueId(), commentId, "👍", null, 0);
    assertThat(first.items()).hasSize(1);
    assertThat(first.hasMore()).isTrue();
    var second =
        reactionService.listReactors(
            s.memberId(), s.issueId(), commentId, "👍", first.nextCursor(), 1);
    assertThat(second.items()).hasSize(1);
    assertThat(second.hasMore()).isFalse();
    assertThat(List.of(first.items().getFirst().userId(), second.items().getFirst().userId()))
        .containsExactlyInAnyOrder(s.ownerId(), s.memberId());

    assertThatThrownBy(
            () ->
                reactionService.listReactors(
                    s.memberId(), s.issueId(), commentId, "👍", "@@깨짐", 20))
        .isInstanceOf(IllegalArgumentException.class);
  }

  /** 다른 테넌트에서는 이 이슈·반응이 보이지 않는다(RLS fail-closed) — 추가는 404, 집계는 빈 값. */
  @Test
  void other_tenant_cannot_see_or_add_reactions() {
    reactionService.add(s.memberId(), s.issueId(), commentId, "👍");

    useTenant(ensureFixtureTenant("wp504-reaction-other"));

    assertThatThrownBy(() -> reactionService.add(s.memberId(), s.issueId(), commentId, "🎉"))
        .isInstanceOf(IssueNotFoundException.class);
    assertThatThrownBy(
            () ->
                reactionService.listReactors(s.memberId(), s.issueId(), commentId, "👍", null, 20))
        .isInstanceOf(IssueNotFoundException.class);
    assertThat(reactionRepository.summariesFor(List.of(commentId), s.memberId())).isEmpty();
    assertThat(reactionRepository.findReactors(commentId, "👍", null, 20)).isEmpty();
  }
}
