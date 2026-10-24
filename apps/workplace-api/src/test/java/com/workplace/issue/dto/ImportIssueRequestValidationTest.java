package com.workplace.issue.dto;

import static org.assertj.core.api.Assertions.assertThat;

import jakarta.validation.Validation;
import jakarta.validation.Validator;
import java.time.OffsetDateTime;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Set;
import java.util.stream.IntStream;
import org.junit.jupiter.api.Test;

/** 가져오기 요청의 Bean Validation 과 {@code referencedUsernames()} (WP-883). */
class ImportIssueRequestValidationTest {

  private static final Validator V = Validation.buildDefaultValidatorFactory().getValidator();
  private static final OffsetDateTime T = OffsetDateTime.parse("2024-01-02T03:04:05+09:00");

  private static ImportIssueRequest req(
      OffsetDateTime createdAt,
      List<ImportIssueRequest.Comment> comments,
      List<ImportIssueRequest.HistoryEntry> history) {
    return new ImportIssueRequest(
        null,
        null,
        "제목",
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        "rep",
        List.of("as1"),
        List.of("w1"),
        createdAt,
        null,
        null,
        List.of(new ImportIssueRequest.Attachment(1L, "att", T)),
        comments,
        history);
  }

  /** 번호·필드·첨부·댓글·이력을 정해 만든 요청 — 목록 원소·번호 상한 검증용. */
  private static ImportIssueRequest reqWith(
      Integer number,
      List<UpdateIssueFieldsRequest.FieldValueInput> fields,
      List<ImportIssueRequest.Attachment> attachments,
      List<ImportIssueRequest.Comment> comments,
      List<ImportIssueRequest.HistoryEntry> history) {
    return new ImportIssueRequest(
        number,
        null,
        "제목",
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        fields,
        "rep",
        null,
        null,
        T,
        null,
        null,
        attachments,
        comments,
        history);
  }

  /** 목록 안의 null 원소는 서비스에서 NPE(500) 가 나므로 검증에서 막는다. */
  @Test
  void nullListElements_areViolations() {
    assertThat(
            V.validate(
                reqWith(
                    null,
                    Arrays.asList((UpdateIssueFieldsRequest.FieldValueInput) null),
                    null,
                    null,
                    null)))
        .hasSize(1);
    assertThat(
            V.validate(
                reqWith(
                    null, null, Arrays.asList((ImportIssueRequest.Attachment) null), null, null)))
        .hasSize(1);
    assertThat(
            V.validate(
                reqWith(null, null, null, Arrays.asList((ImportIssueRequest.Comment) null), null)))
        .hasSize(1);
    assertThat(
            V.validate(
                reqWith(
                    null, null, null, null, Arrays.asList((ImportIssueRequest.HistoryEntry) null))))
        .hasSize(1);
  }

  /** 번호는 10억까지 — number+1 로 시퀀스를 올리므로 int 최댓값에서 넘치지 않게. */
  @Test
  void number_overMax_isViolation() {
    assertThat(V.validate(reqWith(Integer.MAX_VALUE, null, null, null, null))).hasSize(1);
    assertThat(V.validate(reqWith(1_000_000_001, null, null, null, null))).hasSize(1);
    assertThat(V.validate(reqWith(1_000_000_000, null, null, null, null))).isEmpty();
  }

  @Test
  void createdAt_missing_isViolation() {
    assertThat(V.validate(req(null, null, null))).hasSize(1);
  }

  @Test
  void valid_hasNoViolation() {
    assertThat(V.validate(req(T, null, null))).isEmpty();
  }

  @Test
  void comments_over500_isViolation() {
    var c = new ImportIssueRequest.Comment("a", T, null, "x");
    var many = Collections.nCopies(501, c);
    assertThat(V.validate(req(T, many, null))).hasSize(1);
    assertThat(V.validate(req(T, many.subList(0, 500), null))).isEmpty();
  }

  @Test
  void commentBody_over50000_isViolation() {
    var c = new ImportIssueRequest.Comment("a", T, null, "x".repeat(50_001));
    assertThat(V.validate(req(T, List.of(c), null))).hasSize(1);
  }

  @Test
  void referencedUsernames_collectsAllPeopleButNotLabelNames() {
    var comments = List.of(new ImportIssueRequest.Comment("cm", T, null, "x"));
    var assigneeChange =
        new ImportIssueRequest.HistoryEntry(
            "ASSIGNEES_CHANGED",
            "act1",
            T,
            null,
            null,
            null,
            null,
            null,
            null,
            List.of("addedUser"),
            List.of("removedUser"));
    var labelChange =
        new ImportIssueRequest.HistoryEntry(
            "LABELS_CHANGED",
            "act2",
            T,
            null,
            null,
            null,
            null,
            null,
            null,
            List.of("버그라벨"),
            List.of("옛라벨"));
    Set<String> names =
        req(T, comments, List.of(assigneeChange, labelChange)).referencedUsernames();
    assertThat(names)
        .containsExactlyInAnyOrder(
            "rep", "as1", "w1", "cm", "att", "act1", "act2", "addedUser", "removedUser");
    assertThat(IntStream.of(1)).hasSize(1);
  }
}
