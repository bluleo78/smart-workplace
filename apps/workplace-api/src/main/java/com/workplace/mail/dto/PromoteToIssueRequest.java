package com.workplace.mail.dto;

import com.workplace.issue.dto.IssuePriorities;
import com.workplace.issue.dto.IssueTextLimits;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.List;

/**
 * #520 메일→이슈 승격 요청(사용자 최종 수정값). projectKey/담당은 사용자가 모달에서 확정.
 *
 * <p>WP-356: typeId·labelIds(선택)는 MCP {@code create_issue_from_mail} 이 이름을 해석해 보낸다 — 이슈 생성 요청에 그대로
 * 실어 한 트랜잭션에서 붙인다(검증은 IssueService.planCreate). 웹 모달은 보내지 않는다(null = 기본 유형·라벨 없음).
 *
 * <p>WP-394: labelNames 는 이름으로 붙일 라벨 — 없으면 이슈와 같은 트랜잭션에서 만든다(이미 승격된 메일이면 이슈도 라벨도 만들지 않는다).
 */
public record PromoteToIssueRequest(
    @NotBlank String projectKey,
    @NotBlank @Size(max = 200) String title,
    @Size(max = IssueTextLimits.BODY_MAX) String body,
    @Pattern(regexp = IssuePriorities.REGEX) String priority,
    List<Long> assigneeIds,
    Long typeId,
    List<Long> labelIds,
    List<String> labelNames,
    /** 보고자(WP-954) — ME(나, 기본) 또는 SENDER(보낸 사람). null 은 ME. */
    @Pattern(regexp = "ME|SENDER", message = "보고자는 ME 또는 SENDER 여야 합니다") String reporter) {

  /** 유형·라벨 없이 승격하는 기존 5-인자 호환 생성자. */
  public PromoteToIssueRequest(
      String projectKey, String title, String body, String priority, List<Long> assigneeIds) {
    this(projectKey, title, body, priority, assigneeIds, null, null, null, null);
  }

  /** 보고자 지정 없이(나) 유형·라벨까지 싣는 8-인자 호환 생성자(WP-954 이전 호출부). */
  public PromoteToIssueRequest(
      String projectKey,
      String title,
      String body,
      String priority,
      List<Long> assigneeIds,
      Long typeId,
      List<Long> labelIds,
      List<String> labelNames) {
    this(projectKey, title, body, priority, assigneeIds, typeId, labelIds, labelNames, null);
  }

  /** 보고자를 보낸 사람으로 하는지 — null·ME 는 나. */
  public boolean reporterIsSender() {
    return "SENDER".equals(reporter);
  }
}
