package com.workplace.issue.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;
import java.util.List;

/**
 * 이슈 생성 요청. priority 기본값(MID)은 서비스에서 적용. assigneeIds 는 다중 담당자(선택). typeId 미지정 시 프로젝트의 TASK 시스템 유형으로
 * fallback. parentNumber 는 SUBTASK 생성 시 필수, 비SUBTASK 면 null 이어야 한다 (Phase 4a).
 *
 * <p>WP-356: labelIds·milestoneId·cycleIds 는 생성과 같은 트랜잭션에서 붙인다 — 생성 후 PUT 을 따로 부르면 중간 실패 시 라벨 없는
 * 이슈만 남는다(비원자적). 모두 같은 프로젝트 소속이어야 하고, 프로젝트 멤버(또는 ADMIN)만 지정할 수 있다(수정 경로와 같은 규칙).
 *
 * <p>WP-422: fileIds 는 먼저 올려 둔 스테이징 파일(WP-421) — 이슈를 만드는 같은 트랜잭션에서 첨부로 묶는다(잘못된 id 면 이슈도 생기지 않는다).
 * 생성 뒤 따로 클레임하면 그 클레임이 작업 쓰기라 담당 AI 작업을 시작해 버려서 생성 요청 안에 둔다. 한 요청은 10개까지(400), 이슈당 한도(10개)를 넘으면
 * 409.
 *
 * <p>WP-464: status 는 처음 상태(미지정이면 할 일) — 보드 컬럼의 「이슈 추가」가 그 컬럼 상태로 만든다. 종료 상태면 closed_at 도 함께 채운다. 할
 * 일이 아닌 상태 지정은 멤버 전용(WP-477 — 상태 변경이 멤버 전용이라 생성이 우회로가 되면 안 된다).
 *
 * <p>WP-394: labelNames 는 이름으로 붙일 라벨 — 프로젝트에 없는 이름은 같은 트랜잭션에서 기본 색으로 만들어 붙인다(labelIds 와 합친다).
 *
 * <p>WP-807: statusId 는 처음 프로젝트 상태 — status(범주)보다 우선한다. 범주만 오면 그 범주의 기본 상태로 만든다.
 *
 * <p>WP-933: componentIds 는 붙일 구성요소 — 담당자(assigneeIds)가 비어 있으면 서버가 목록 순서로 처음 유효한 구성요소 담당자를 붙인다.
 *
 * <p>WP-1038: parentKey 는 부모 이슈 키 — 일반 이슈가 다른 프로젝트 에픽을 부모로 둘 때 쓴다(하위 태스크·개인 프로젝트는 불가).
 */
public record CreateIssueRequest(
    @NotBlank(message = "이슈 제목을 입력해 주세요") @Size(max = 200) String title,
    @Size(max = IssueTextLimits.BODY_MAX) String body,
    @Pattern(regexp = IssuePriorities.REGEX) String priority,
    LocalDate dueDate,
    // 같은 id 를 수만 번 넣으면 요청 하나가 수 초 걸렸다(WP-794).
    @Size(max = 50, message = "담당자는 50명까지 지정할 수 있습니다") List<Long> assigneeIds,
    Long typeId,
    Integer parentNumber,
    LocalDate startDate,
    // labelIds·cycleIds 원소 null 은 400 — 500 이 났다(WP-743).
    List<@NotNull Long> labelIds,
    Long milestoneId,
    List<@NotNull Long> cycleIds,
    List<String> labelNames,
    @Size(max = 10) List<Long> fileIds,
    @Pattern(regexp = IssueStatuses.CATEGORY_REGEX) String status,
    Long statusId,
    // WP-933 구성요소 — 같은 프로젝트의 사용 중(보관 안 됨) 구성요소만, 구성원만 지정할 수 있다. 담당자 없이 만들면 고른 구성요소 담당자가
    // 자동으로 붙는다. 원소 null 은 400.
    @Size(max = 100) List<@NotNull Long> componentIds,
    // WP-1038 부모 이슈 키(예: PLAN-12) — 다른 프로젝트의 에픽을 부모로 둘 때 쓴다. parentNumber 와 함께 오면 같은 이슈여야 한다.
    @Size(max = 64) String parentKey) {

  /** WP-1038 이전의 16-인자 호환 생성자 — 부모 키 없이(같은 프로젝트 번호로만) 만든다(가져오기·기존 테스트가 그대로 쓴다). */
  public CreateIssueRequest(
      String title,
      String body,
      String priority,
      LocalDate dueDate,
      List<Long> assigneeIds,
      Long typeId,
      Integer parentNumber,
      LocalDate startDate,
      List<Long> labelIds,
      Long milestoneId,
      List<Long> cycleIds,
      List<String> labelNames,
      List<Long> fileIds,
      String status,
      Long statusId,
      List<Long> componentIds) {
    this(
        title,
        body,
        priority,
        dueDate,
        assigneeIds,
        typeId,
        parentNumber,
        startDate,
        labelIds,
        milestoneId,
        cycleIds,
        labelNames,
        fileIds,
        status,
        statusId,
        componentIds,
        null);
  }

  /** WP-933 이전의 15-인자 호환 생성자 — 구성요소 없이 만든다(메일 승격·가져오기·기존 테스트가 그대로 쓴다). */
  public CreateIssueRequest(
      String title,
      String body,
      String priority,
      LocalDate dueDate,
      List<Long> assigneeIds,
      Long typeId,
      Integer parentNumber,
      LocalDate startDate,
      List<Long> labelIds,
      Long milestoneId,
      List<Long> cycleIds,
      List<String> labelNames,
      List<Long> fileIds,
      String status,
      Long statusId) {
    this(
        title,
        body,
        priority,
        dueDate,
        assigneeIds,
        typeId,
        parentNumber,
        startDate,
        labelIds,
        milestoneId,
        cycleIds,
        labelNames,
        fileIds,
        status,
        statusId,
        null);
  }

  /** WP-422 이전의 12-인자 호환 생성자 — 첨부(fileIds) 없이 만든다. 기존 호출부(JSON 역직렬화는 정식 생성자)가 그대로 쓴다. */
  public CreateIssueRequest(
      String title,
      String body,
      String priority,
      LocalDate dueDate,
      List<Long> assigneeIds,
      Long typeId,
      Integer parentNumber,
      LocalDate startDate,
      List<Long> labelIds,
      Long milestoneId,
      List<Long> cycleIds,
      List<String> labelNames) {
    this(
        title,
        body,
        priority,
        dueDate,
        assigneeIds,
        typeId,
        parentNumber,
        startDate,
        labelIds,
        milestoneId,
        cycleIds,
        labelNames,
        null,
        null,
        null,
        null);
  }

  /** 라벨·마일스톤·사이클 없이 만드는 기존 8-인자 호환 생성자 — 기존 호출부(메일 승격 외 시드·테스트)가 그대로 쓴다. */
  public CreateIssueRequest(
      String title,
      String body,
      String priority,
      LocalDate dueDate,
      List<Long> assigneeIds,
      Long typeId,
      Integer parentNumber,
      LocalDate startDate) {
    this(
        title,
        body,
        priority,
        dueDate,
        assigneeIds,
        typeId,
        parentNumber,
        startDate,
        null,
        null,
        null,
        null);
  }
}
