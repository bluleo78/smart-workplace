package com.workplace.issue.repository;

import static com.workplace.jooq.Tables.ISSUE_COMMENT;
import static com.workplace.jooq.Tables.ISSUE_COMMENT_REACTION;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.dto.CommentReactionResponse;
import com.workplace.issue.repository.IssueCommentReactionRepository.Cursor;
import com.workplace.issue.repository.IssueCommentReactionRepository.ReactorRow;
import com.workplace.issue.service.IssueTypeService;
import com.workplace.issue.service.OpenScenario;
import com.workplace.project.repository.ProjectIssueSequenceRepository;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-504 이슈 코멘트 반응 리포지토리 통합 테스트. 멱등 추가·집계(개수·내가 눌렀는지·먼저 달린 순)·없는 반응 취소·반응자 키셋 페이지· 코멘트 실삭제 시
 * CASCADE 를 실제 DB(RLS 테넌트 1)로 확인한다. @Transactional 롤백으로 격리.
 */
@Transactional
class IssueCommentReactionRepositoryTest extends IntegrationTestBase {

  @Autowired IssueCommentReactionRepository reactions;
  @Autowired IssueCommentRepository comments;
  @Autowired IssueTypeService issueTypeService;
  @Autowired IssueRepository issueRepository;
  @Autowired ProjectIssueSequenceRepository sequenceRepository;
  @Autowired DSLContext dsl;

  private OpenScenario.Result s;
  private long commentId;

  /** 테넌트 1 아래에서 이슈 하나와 코멘트 하나를 준비한다. */
  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    s = OpenScenario.create(dsl, issueTypeService, issueRepository, sequenceRepository, 1L);
    commentId = comments.insert(s.issueId(), s.ownerId(), "코멘트").id();
  }

  /** 같은 (코멘트, 사람, 이모지) 를 두 번 넣으면 두 번째는 아무것도 하지 않는다. */
  @Test
  void add_is_idempotent() {
    assertThat(reactions.add(commentId, s.ownerId(), "👍")).isTrue();
    assertThat(reactions.add(commentId, s.ownerId(), "👍")).isFalse();
    assertThat(reactions.countByUser(commentId, s.ownerId())).isEqualTo(1);
    assertThat(reactions.exists(commentId, s.ownerId(), "👍")).isTrue();
    assertThat(reactions.hasEmoji(commentId, "👍")).isTrue();
    assertThat(reactions.countDistinctEmojis(commentId)).isEqualTo(1);
  }

  /** 이모지별 개수와 호출자가 눌렀는지를 모으고, 먼저 달린 이모지가 앞에 온다. */
  @Test
  void summaries_aggregate_count_and_reacted() {
    long a = s.ownerId();
    long b = s.memberId();
    reactions.add(commentId, a, "👍");
    reactions.add(commentId, b, "👍");
    reactions.add(commentId, b, "🎉");
    // 한 트랜잭션 안의 now() 는 같아 순서가 정해지지 않으므로 🎉 를 1초 뒤로 민다.
    dsl.update(ISSUE_COMMENT_REACTION)
        .set(
            ISSUE_COMMENT_REACTION.CREATED_AT,
            ISSUE_COMMENT_REACTION.CREATED_AT.plus(DSL.field("interval '1 second'")))
        .where(ISSUE_COMMENT_REACTION.EMOJI.eq("🎉"))
        .execute();

    var map = reactions.summariesFor(List.of(commentId), a);

    assertThat(map.get(commentId))
        .containsExactly(
            new CommentReactionResponse("👍", 2, true),
            new CommentReactionResponse("🎉", 1, false));
    assertThat(reactions.countDistinctEmojis(commentId)).isEqualTo(2);
    assertThat(reactions.summariesFor(List.of(), a)).isEmpty();
  }

  /** 없는 반응을 지우면 false, 있는 반응을 지우면 true. */
  @Test
  void remove_returns_false_when_absent() {
    assertThat(reactions.remove(commentId, s.ownerId(), "👍")).isFalse();
    reactions.add(commentId, s.ownerId(), "👍");
    assertThat(reactions.remove(commentId, s.ownerId(), "👍")).isTrue();
    assertThat(reactions.exists(commentId, s.ownerId(), "👍")).isFalse();
  }

  /** 세 명이 👍 — limit 2 면 두 명과 hasMore 판정용 한 건을 더 주고, 커서로 남은 한 명을 받는다. */
  @Test
  void find_reactors_paginates() {
    reactions.add(commentId, s.ownerId(), "👍");
    reactions.add(commentId, s.memberId(), "👍");
    reactions.add(commentId, s.reporterId(), "👍");

    List<ReactorRow> first = reactions.findReactors(commentId, "👍", null, 2);
    assertThat(first).hasSize(3); // limit+1 — 호출자가 3번째로 hasMore 를 안다
    List<ReactorRow> page = first.subList(0, 2);
    ReactorRow last = page.get(1);
    String next = new Cursor(last.reactedAt(), last.userId()).encode();

    List<ReactorRow> second = reactions.findReactors(commentId, "👍", Cursor.decode(next), 2);
    assertThat(second).hasSize(1);
    assertThat(second.get(0).userId()).isNotIn(page.get(0).userId(), page.get(1).userId());
    assertThat(second.get(0).name()).isNotBlank();
    assertThat(second.get(0).kind()).isNotBlank();
  }

  /** 깨진 커서는 안내 문구의 IllegalArgumentException(→ 400). */
  @Test
  void broken_cursor_is_rejected() {
    assertThatThrownBy(() -> Cursor.decode("@@깨짐")).isInstanceOf(IllegalArgumentException.class);
  }

  /** 코멘트 행을 실제로 지우면 반응도 함께 지워진다(ON DELETE CASCADE). */
  @Test
  void cascade_on_comment_hard_delete() {
    reactions.add(commentId, s.ownerId(), "👍");
    dsl.deleteFrom(ISSUE_COMMENT).where(ISSUE_COMMENT.ID.eq(commentId)).execute();
    assertThat(
            dsl.fetchCount(ISSUE_COMMENT_REACTION, ISSUE_COMMENT_REACTION.COMMENT_ID.eq(commentId)))
        .isZero();
  }
}
