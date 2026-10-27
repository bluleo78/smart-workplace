package com.workplace.issue.dto;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.workplace.issue.dto.UpdateIssueFieldsRequest.FieldValueInput;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * 이슈 가져오기(WP-883·884) 요청 본문 — 다른 트래커의 이슈를 원작성자·원시각·댓글·변경 이력까지 보존해 들여온다. 사람 참조는 모두 username 이며 서버가 이
 * 프로젝트 멤버로 해석한다.
 */
public record ImportIssueRequest(
    // 상한 — 시퀀스를 number+1 로 올리므로 int 최댓값에서 넘쳐 시퀀스가 올라가지 않는 일을 막는다.
    @Positive(message = "이슈 번호는 1 이상이어야 합니다.")
        @Max(value = 1_000_000_000, message = "이슈 번호는 1,000,000,000 이하여야 합니다.")
        Integer number,
    @Size(max = 100, message = "원본 키는 100자 이하여야 합니다.") String sourceKey,
    @NotBlank(message = "제목은 필수입니다.") @Size(max = 200, message = "제목은 200자 이하여야 합니다.") String title,
    @Size(max = IssueTextLimits.BODY_MAX, message = "본문이 너무 깁니다.") String body,
    Long typeId,
    Long statusId,
    @Pattern(regexp = IssueStatuses.CATEGORY_REGEX, message = "상태 분류가 올바르지 않습니다.") String status,
    @Pattern(regexp = IssuePriorities.REGEX, message = "우선순위가 올바르지 않습니다.") String priority,
    LocalDate startDate,
    LocalDate dueDate,
    Integer parentNumber,
    Long milestoneId,
    List<@NotNull(message = "라벨 id 는 비울 수 없습니다.") Long> labelIds,
    List<String> labelNames,
    // WP-933 구성요소 이름 — 프로젝트에 이미 있는 것만(대소문자 무시, 보관된 것도 허용). 없는 이름은 만들지 않고 400 으로 거절한다.
    @Size(max = 100, message = "구성요소는 100개 이하여야 합니다.")
        List<@NotBlank(message = "구성요소 이름은 비울 수 없습니다.") String> componentNames,
    // WP-888 수정 버전·영향 버전 이름 — 프로젝트에 이미 있는 것만(대소문자 무시, 보관·출시된 것도 허용). 없는 이름은 만들지 않고 400 으로 거절한다.
    @Size(max = 100, message = "수정 버전은 100개 이하여야 합니다.")
        List<@NotBlank(message = "수정 버전 이름은 비울 수 없습니다.") String> fixVersionNames,
    @Size(max = 100, message = "영향 버전은 100개 이하여야 합니다.")
        List<@NotBlank(message = "영향 버전 이름은 비울 수 없습니다.") String> affectsVersionNames,
    List<@NotNull(message = "사이클 id 는 비울 수 없습니다.") Long> cycleIds,
    // 목록 원소의 null 은 서비스에서 NPE(500) 가 되므로 원소마다 막는다(아래 첨부·댓글·이력도 같다).
    List<@NotNull(message = "필드 값 항목은 비울 수 없습니다.") @Valid FieldValueInput> fields,
    @NotBlank(message = "보고자는 필수입니다.") String reporter,
    @Size(max = 50, message = "담당자는 50명 이하여야 합니다.")
        List<@NotBlank(message = "담당자 이름은 비울 수 없습니다.") String> assignees,
    List<@NotBlank(message = "워처 이름은 비울 수 없습니다.") String> watchers,
    @NotNull(message = "생성 시각은 필수입니다.") OffsetDateTime createdAt,
    OffsetDateTime updatedAt,
    OffsetDateTime closedAt,
    @Size(max = MAX_ATTACHMENTS, message = "첨부는 50개 이하여야 합니다.")
        List<@NotNull(message = "첨부 항목은 비울 수 없습니다.") @Valid Attachment> attachments,
    @Size(max = 500, message = "댓글은 500개 이하여야 합니다.")
        List<@NotNull(message = "댓글 항목은 비울 수 없습니다.") @Valid Comment> comments,
    @Size(max = 1000, message = "변경 이력은 1000개 이하여야 합니다.")
        List<@NotNull(message = "변경 이력 항목은 비울 수 없습니다.") @Valid HistoryEntry> history,
    @Size(max = 50, message = "외부 링크는 50개 이하여야 합니다.")
        List<@NotNull(message = "외부 링크 항목은 비울 수 없습니다.") @Valid ExternalLink> externalLinks,
    // WP-1038 부모 이슈 키(예: PLAN-12) — 다른 프로젝트의 에픽을 부모로 둘 때 쓴다. 같은 프로젝트 부모는 parentNumber 로도 된다(둘 다
    // 오면 같은 이슈여야 한다). 규칙은 일반 생성과 같다(하위 태스크·개인 프로젝트 불가, 부모는 에픽).
    @Size(max = 64, message = "부모 이슈 키는 64자 이하여야 합니다.") String parentKey) {

  /** 가져오기 한 번에 붙일 수 있는 첨부 상한 — 요청 검증(@Size)과 첨부 서비스가 같은 값을 쓴다. */
  public static final int MAX_ATTACHMENTS = 50;

  /** WP-1038 이전의 호환 생성자 — 부모 키 없이(같은 프로젝트 번호로만) 만든다(기존 테스트가 그대로 쓴다). */
  public ImportIssueRequest(
      Integer number,
      String sourceKey,
      String title,
      String body,
      Long typeId,
      Long statusId,
      String status,
      String priority,
      LocalDate startDate,
      LocalDate dueDate,
      Integer parentNumber,
      Long milestoneId,
      List<Long> labelIds,
      List<String> labelNames,
      List<String> componentNames,
      List<String> fixVersionNames,
      List<String> affectsVersionNames,
      List<Long> cycleIds,
      List<FieldValueInput> fields,
      String reporter,
      List<String> assignees,
      List<String> watchers,
      OffsetDateTime createdAt,
      OffsetDateTime updatedAt,
      OffsetDateTime closedAt,
      List<Attachment> attachments,
      List<Comment> comments,
      List<HistoryEntry> history,
      List<ExternalLink> externalLinks) {
    this(
        number,
        sourceKey,
        title,
        body,
        typeId,
        statusId,
        status,
        priority,
        startDate,
        dueDate,
        parentNumber,
        milestoneId,
        labelIds,
        labelNames,
        componentNames,
        fixVersionNames,
        affectsVersionNames,
        cycleIds,
        fields,
        reporter,
        assignees,
        watchers,
        createdAt,
        updatedAt,
        closedAt,
        attachments,
        comments,
        history,
        externalLinks,
        null);
  }

  /** 이미 업로드된 파일을 원 첨부자·원 시각으로 붙인다. */
  public record Attachment(
      @NotNull(message = "파일 id 는 필수입니다.") Long fileId,
      @NotBlank(message = "첨부자는 필수입니다.") String attachedBy,
      @NotNull(message = "첨부 시각은 필수입니다.") OffsetDateTime attachedAt) {}

  /**
   * 다른 시스템에 남는 이슈로 가는 외부 링크 한 줄(WP-887) — 가져오는 이슈와 같은 트랜잭션에 이력 없이 넣는다.
   *
   * @param type 관계 유형 코드(기본 유형, 예: RELATES·PARENT_EPIC) 또는 사용자 정의 유형 이름 — 숨긴 유형도 받는다
   * @param side 방향 있는 유형에서 이 이슈의 쪽 — {@code source}(기본, 이 이슈가 A) 또는 {@code target}
   * @param key 상대 시스템의 키(예: CLIM-12), 선택
   */
  public record ExternalLink(
      @NotBlank(message = "외부 링크 유형은 필수입니다.") String type,
      String side,
      @NotBlank(message = "외부 링크 주소는 필수입니다.")
          @Size(max = 2000, message = "외부 링크 주소는 2000자 이하여야 합니다.")
          String url,
      @Size(max = 50, message = "외부 링크 키는 50자 이하여야 합니다.") String key,
      @NotBlank(message = "외부 링크 제목은 필수입니다.") @Size(max = 300, message = "외부 링크 제목은 300자 이하여야 합니다.")
          String title) {}

  /** 원작성자·원시각을 가진 댓글. */
  public record Comment(
      @NotBlank(message = "댓글 작성자는 필수입니다.") String author,
      @NotNull(message = "댓글 작성 시각은 필수입니다.") OffsetDateTime createdAt,
      OffsetDateTime updatedAt,
      @NotBlank(message = "댓글 본문은 필수입니다.")
          @Size(max = IssueTextLimits.BODY_MAX, message = "댓글 본문이 너무 깁니다.")
          String body) {}

  /** 변경 이력 한 건 — type 별로 쓰는 필드가 다르다(검증은 서비스에서). */
  public record HistoryEntry(
      @NotBlank(message = "이력 유형은 필수입니다.") String type,
      @NotBlank(message = "이력 행위자는 필수입니다.") String actor,
      @NotNull(message = "이력 시각은 필수입니다.") OffsetDateTime at,
      @Size(max = 200, message = "이전 값은 200자 이하여야 합니다.") String from,
      @Size(max = 200, message = "이후 값은 200자 이하여야 합니다.") String to,
      Long fromStatusId,
      Long toStatusId,
      Long fromTypeId,
      Long toTypeId,
      List<@NotBlank(message = "이름은 비울 수 없습니다.") String> added,
      List<@NotBlank(message = "이름은 비울 수 없습니다.") String> removed) {}

  /**
   * 요청에 나온 모든 username — 보고자·담당자·워처·댓글 작성자·첨부자·이력 행위자, 그리고 ASSIGNEES_CHANGED 이력의 added/removed(그 외
   * 유형의 added/removed 는 라벨 이름 등이라 제외). 한 번에 해석해 맞지 않은 사용자를 모두 알리려는 용도.
   */
  @JsonIgnore
  public Set<String> referencedUsernames() {
    Set<String> names = new LinkedHashSet<>();
    if (reporter != null) names.add(reporter);
    addAll(names, assignees);
    addAll(names, watchers);
    if (comments != null) comments.forEach(c -> names.add(c.author()));
    if (attachments != null) attachments.forEach(a -> names.add(a.attachedBy()));
    if (history != null) {
      for (HistoryEntry h : history) {
        names.add(h.actor());
        if (IssueHistoryEventType.ASSIGNEES_CHANGED.name().equals(h.type())) {
          addAll(names, h.added());
          addAll(names, h.removed());
        }
      }
    }
    names.remove(null);
    return names;
  }

  private static void addAll(Set<String> target, List<String> source) {
    if (source != null) target.addAll(source);
  }
}
