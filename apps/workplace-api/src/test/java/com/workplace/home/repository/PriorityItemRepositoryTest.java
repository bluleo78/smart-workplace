package com.workplace.home.repository;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.home.dto.PriorityItemRow;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** PriorityItemRepository — upsert/diff(재계산 시 사라진 후보 정리) 검증. */
class PriorityItemRepositoryTest extends IntegrationTestBase {

  @Autowired private PriorityItemRepository repo;

  @Test
  @Transactional
  void replaceForUser_은_사라진_후보를_삭제하고_새_후보를_저장한다() {
    TenantContext.set(1L);
    // user_priority_item.user_id 는 "user" FK 참조 — 실존 사용자 필요(고정 리터럴 ID는 FK 위반).
    long userId = createAgentUser("priority-item-test");

    repo.replaceForUser(
        userId,
        List.of(
            new PriorityItemRow(
                "ISSUE_DUE", "1", "이슈 A", "/projects/A/issues/1", 80, 90, "고객 마감 오늘"),
            new PriorityItemRow("MENTION", "2", "멘션 B", "/chat", 30, 40, "낮은 신호")));
    assertThat(repo.findForUser(userId)).hasSize(2);

    // 재계산: ISSUE_DUE-1 은 사라지고(완료됨), MENTION-2 는 점수 갱신, MAIL_NEEDS_REPLY-3 신규.
    repo.replaceForUser(
        userId,
        List.of(
            new PriorityItemRow("MENTION", "2", "멘션 B", "/chat", 60, 60, "갱신된 이유"),
            new PriorityItemRow("MAIL_NEEDS_REPLY", "3", "메일 C", "/mail/1", 20, 90, "긴급 회신")));

    List<PriorityItemRow> after = repo.findForUser(userId);
    assertThat(after).hasSize(2);
    assertThat(after).extracting(PriorityItemRow::sourceId).containsExactlyInAnyOrder("2", "3");
    assertThat(after)
        .filteredOn(r -> r.sourceId().equals("2"))
        .first()
        .extracting(PriorityItemRow::importanceScore)
        .isEqualTo(60);
  }

  @Test
  @Transactional
  void replaceForUser_은_빈_리스트를_전달하면_사용자의_모든_후보를_삭제한다() {
    TenantContext.set(1L);
    long userId = createAgentUser("priority-item-empty-test");

    repo.replaceForUser(
        userId,
        List.of(
            new PriorityItemRow(
                "ISSUE_DUE", "1", "이슈 A", "/projects/A/issues/1", 80, 90, "고객 마감 오늘")));
    assertThat(repo.findForUser(userId)).hasSize(1);

    // 이번 배치에 후보가 하나도 없으면(빈 리스트) 기존 후보 전량 삭제.
    repo.replaceForUser(userId, List.of());

    assertThat(repo.findForUser(userId)).isEmpty();
  }
}
