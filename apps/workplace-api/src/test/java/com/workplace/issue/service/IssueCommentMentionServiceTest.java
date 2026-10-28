package com.workplace.issue.service;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.dto.MentionResponse;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.dto.CreateCommentRequest;
import com.workplace.issue.dto.IssueCommentResponse;
import com.workplace.issue.repository.IssueCommentRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.repository.ProjectIssueSequenceRepository;
import com.workplace.support.IntegrationTestBase;
import com.workplace.tenant.repository.MembershipRepository;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-1095 이슈 코멘트 응답의 멘션 사용자. 화면이 프로젝트 멤버 목록만으로 이름을 찾아, 프로젝트에서 빠진 사람을 멘션한 지난 코멘트가 「알 수 없음」으로 보였다.
 * 코멘트 목록·작성 응답이 본문 멘션 토큰을 사용자로 풀어 싣는지, 다른 워크스페이스 사용자는 싣지 않는지 실제 DB(RLS 테넌트 1)로 확인한다.
 */
@Transactional
class IssueCommentMentionServiceTest extends IntegrationTestBase {

  @Autowired IssueCommentService commentService;
  @Autowired IssueCommentRepository comments;
  @Autowired IssueTypeService issueTypeService;
  @Autowired IssueRepository issueRepository;
  @Autowired ProjectIssueSequenceRepository sequenceRepository;
  @Autowired MembershipRepository memberships;
  @Autowired DSLContext dsl;

  private OpenScenario.Result s;

  /** 시나리오 사용자(소유자·멤버·제보자·외부인)를 모두 테넌트 1 의 활성 멤버로 둔다 — 외부인·제보자는 프로젝트 멤버가 아니다. */
  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    s = OpenScenario.create(dsl, issueTypeService, issueRepository, sequenceRepository, 1L);
    for (long id : List.of(s.ownerId(), s.memberId(), s.reporterId(), s.strangerId())) {
      memberships.create(id, 1L, "ACTIVE");
    }
  }

  /** 사용자 id 의 응답 모양 — 이름·username·kind 는 사용자 테이블의 현재 값. */
  private MentionResponse mentionOf(long userId) {
    var u = dsl.selectFrom(USER).where(USER.ID.eq(userId)).fetchSingle();
    return new MentionResponse(userId, u.getUsername(), u.getName(), u.getKind());
  }

  /** 프로젝트 멤버가 아닌 사람도 멘션 사용자로 실린다 — 본문 토큰 순서대로, 중복 없이. */
  @Test
  void list_resolves_mentions_of_non_project_members_in_token_order() {
    comments.insert(
        s.issueId(),
        s.ownerId(),
        "<@" + s.strangerId() + "> 와 <@" + s.memberId() + "> 확인 — 다시 <@" + s.strangerId() + ">");

    List<IssueCommentResponse> list = commentService.list(s.ownerId(), s.issueId());

    assertThat(list).hasSize(1);
    assertThat(list.getFirst().mentions())
        .containsExactly(mentionOf(s.strangerId()), mentionOf(s.memberId()));
  }

  /**
   * 다른 워크스페이스 사용자·없는 id 는 싣지 않는다 — 누구나 본문에 토큰을 쓸 수 있어, 거르지 않으면 다른 워크스페이스 사용자의 이름이 보인다. 멘션 없는 코멘트는 빈
   * 목록이고, 여러 코멘트가 각자 자기 멘션만 갖는다.
   */
  @Test
  void foreign_and_unknown_ids_are_dropped_and_each_comment_keeps_its_own() {
    long foreign =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "other-ws-" + System.nanoTime())
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, "다른 워크스페이스")
            .set(USER.EMAIL, "other-ws-" + System.nanoTime() + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    comments.insert(
        s.issueId(), s.ownerId(), "<@" + foreign + "> <@999999999> <@" + s.reporterId() + ">");
    comments.insert(s.issueId(), s.ownerId(), "멘션 없음");

    List<IssueCommentResponse> list = commentService.list(s.ownerId(), s.issueId());

    assertThat(list.get(0).mentions()).containsExactly(mentionOf(s.reporterId()));
    assertThat(list.get(1).mentions()).isEmpty();
  }

  /** 작성 응답도 멘션을 싣는다 — 작성 직후 캐시에 붙여도 이름이 바로 보이게. */
  @Test
  void create_response_carries_mentions() {
    IssueCommentResponse created =
        commentService.create(
            s.ownerId(), s.issueId(), new CreateCommentRequest("<@" + s.strangerId() + "> 봐 주세요"));

    assertThat(created.mentions()).containsExactly(mentionOf(s.strangerId()));
  }
}
