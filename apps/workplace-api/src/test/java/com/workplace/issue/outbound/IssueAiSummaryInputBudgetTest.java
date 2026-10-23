package com.workplace.issue.outbound;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.issue.dto.IssueCommentResponse;
import com.workplace.issue.outbound.IssueAiSummaryService.Selected;
import com.workplace.issue.outbound.dto.ChatExcerpt;
import com.workplace.issue.outbound.dto.IssueSummaryRequest;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * WP-885 — AI 진행 요약 입력 예산 규칙(본문 2만자·코멘트 건당 4천자·코멘트 합계 4만자, 최신순 채움) 단위 테스트. 순수 로직이라 DB·스프링 없이 검증한다.
 */
class IssueAiSummaryInputBudgetTest {

  @Test
  void 상한_이하_텍스트는_그대로_둔다() {
    String text = "가".repeat(IssueAiInputText.AI_BODY_MAX_CHARS);
    assertThat(IssueAiInputText.truncate(text, IssueAiInputText.AI_BODY_MAX_CHARS)).isEqualTo(text);
  }

  @Test
  void 상한을_넘으면_앞부분만_남기고_생략_글자수_표식을_붙인다() {
    String text = "가".repeat(26_000);
    String cut = IssueAiInputText.truncate(text, IssueAiInputText.AI_BODY_MAX_CHARS);
    assertThat(cut).isEqualTo("가".repeat(20_000) + "…(이하 6000자 생략)");
  }

  @Test
  void 서로게이트_쌍_한가운데에서는_자르지_않는다() {
    // 😀 = 서로게이트 2글자. 경계(3번째 글자)가 쌍의 한가운데면 한 글자 앞에서 자른다.
    String text = "ab😀cd";
    String cut = IssueAiInputText.truncate(text, 3);
    assertThat(cut).startsWith("ab").doesNotContain("😀");
    assertThat(cut).endsWith("…(이하 4자 생략)");
  }

  @Test
  void 코멘트_한_건은_4천자로_자른다() {
    Selected<IssueSummaryRequest.CommentLine> r =
        IssueAiSummaryService.selectComments(List.of(comment(1, "나".repeat(31_000))));
    assertThat(r.omittedCount()).isZero();
    assertThat(r.lines()).hasSize(1);
    assertThat(r.lines().get(0).body()).isEqualTo("나".repeat(4_000) + "…(이하 27000자 생략)");
  }

  @Test
  void 합계_4만자까지_최신순으로_담고_오래된_것을_빼며_출력은_시간순() {
    // 4천자짜리 코멘트 12건(시간순 1..12): 최신 10건 = 4만자까지, 오래된 2건 생략.
    List<IssueCommentResponse> all = new ArrayList<>();
    for (int i = 1; i <= 12; i++) all.add(comment(i, ("" + (char) ('A' + i)).repeat(4_000)));

    Selected<IssueSummaryRequest.CommentLine> r = IssueAiSummaryService.selectComments(all);

    assertThat(r.lines()).hasSize(10);
    assertThat(r.omittedCount()).isEqualTo(2);
    // 가장 오래된 포함 건은 3번째, 마지막은 12번째 — 시간 오름차순 유지
    assertThat(r.lines().get(0).body()).startsWith("" + (char) ('A' + 3));
    assertThat(r.lines().get(9).body()).startsWith("" + (char) ('A' + 12));
  }

  @Test
  void 예산_안이면_전부_담고_생략_0건() {
    Selected<IssueSummaryRequest.CommentLine> r =
        IssueAiSummaryService.selectComments(List.of(comment(1, "짧은 글"), comment(2, "또 짧은 글")));
    assertThat(r.lines()).hasSize(2);
    assertThat(r.omittedCount()).isZero();
    assertThat(r.lines().get(0).body()).isEqualTo("짧은 글");
  }

  @Test
  void 코멘트_합계_예산은_생략_표식까지_센_실제_전송_글자_수_기준() {
    // 5천자 코멘트 12건 → 각 4천자 + 표식(「…(이하 1000자 생략)」 = 12자) = 4012자. 표식을 빼고 세면 10건이 들어가 40,120자가 되어
    // 상한(4만자)을 넘는다 — 표식까지 세면 9건(36,108자)에서 멈춘다.
    List<IssueCommentResponse> all = new ArrayList<>();
    for (int i = 1; i <= 12; i++) all.add(comment(i, "다".repeat(5_000)));

    Selected<IssueSummaryRequest.CommentLine> r = IssueAiSummaryService.selectComments(all);

    int sent = r.lines().stream().mapToInt(l -> l.body().length()).sum();
    assertThat(sent).isLessThanOrEqualTo(IssueAiSummaryService.COMMENTS_TOTAL_MAX_CHARS);
    assertThat(r.lines()).hasSize(9);
    assertThat(r.omittedCount()).isEqualTo(3);
  }

  @Test
  void 채팅은_합계_2만자까지_최신순으로_담고_오래된_것을_빼며_출력은_시간순() {
    // 4천자 채팅 7건(시간순 1..7): 최신 5건 = 2만자까지, 오래된 2건 생략.
    List<ChatExcerpt> all = new ArrayList<>();
    for (int i = 1; i <= 7; i++) all.add(chat(i, ("" + (char) ('A' + i)).repeat(4_000)));

    Selected<IssueSummaryRequest.ChatLine> r = IssueAiSummaryService.selectChat(all);

    assertThat(r.lines()).hasSize(5);
    assertThat(r.omittedCount()).isEqualTo(2);
    assertThat(r.lines().get(0).body()).startsWith("" + (char) ('A' + 3));
    assertThat(r.lines().get(4).body()).startsWith("" + (char) ('A' + 7));
  }

  @Test
  void 채팅_한_건은_4천자로_자르고_예산_안이면_전부_담는다() {
    Selected<IssueSummaryRequest.ChatLine> r =
        IssueAiSummaryService.selectChat(List.of(chat(1, "짧은 말"), chat(2, "라".repeat(9_000))));
    assertThat(r.omittedCount()).isZero();
    assertThat(r.lines()).hasSize(2);
    assertThat(r.lines().get(0).body()).isEqualTo("짧은 말");
    assertThat(r.lines().get(1).body()).isEqualTo("라".repeat(4_000) + "…(이하 5000자 생략)");
  }

  private static ChatExcerpt chat(long id, String body) {
    return new ChatExcerpt(
        "작성자", "USER", body, Instant.parse("2026-01-01T00:00:00Z").plusSeconds(id));
  }

  private static IssueCommentResponse comment(long id, String body) {
    return new IssueCommentResponse(
        id,
        1L,
        1L,
        "작성자",
        "USER",
        body,
        Instant.parse("2026-01-01T00:00:00Z").plusSeconds(id),
        null,
        "writer",
        List.of());
  }
}
