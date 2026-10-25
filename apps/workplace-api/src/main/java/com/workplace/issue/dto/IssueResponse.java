package com.workplace.issue.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.workplace.component.dto.ComponentSummary;
import com.workplace.cycle.dto.CycleSummary;
import com.workplace.global.dto.UserSummary;
import com.workplace.label.dto.LabelSummary;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

/**
 * 이슈 목록·요약 응답 DTO. projectKey 는 컨텍스트(프로젝트)에서 주입한다. labels/attachmentCount/type/assignees 는 호출자가 채우지
 * 않으면 빈 값. Phase 4a 부터 parent/childCount/childDoneCount 가 추가됨. Phase 4b 부터 blockedBy/blocks/blocked
 * 가 추가됨 — 기존 6 factory 는 default (List.of(), List.of(), false) 로 유지. Phase 4c 부터 customFields 추가 —
 * 기존 7 factory 는 default List.of() 로 유지하며 신규 fromWithCustomFields 가 풀버전.
 */
public record IssueResponse(
    Long id,
    String projectKey,
    int number,
    String title,
    // 상태 범주(TODO/IN_PROGRESS/DONE/CANCELED) — 예전 클라이언트·범주 판정용으로 유지(WP-807).
    String status,
    // WP-807 프로젝트 상태 — id·이름.
    Long statusId,
    String statusName,
    // WP-870 상태 색 토큰 — 배지 색. 예전 클라이언트는 무시한다.
    String statusColor,
    String priority,
    LocalDate dueDate,
    LocalDate startDate,
    Long milestoneId,
    // 마일스톤 이름 — milestoneId 와 함께 내려 AI 도구가 목록 조회 없이 이름을 쓴다(WP-307). 없으면 null.
    String milestoneName,
    Long reporterId,
    Instant createdAt,
    Instant updatedAt,
    // 종료(DONE·CANCELED) 진입 시각 — 재오픈 시 null(WP-307). 완료/취소 구분은 status 로 한다.
    Instant closedAt,
    List<LabelSummary> labels,
    int attachmentCount,
    IssueTypeSummary type,
    List<UserSummary> assignees,
    ParentRef parent,
    int childCount,
    int childDoneCount,
    List<IssueLinkSummary> blockedBy,
    List<IssueLinkSummary> blocks,
    boolean blocked,
    List<IssueFieldEntry> customFields,
    // #611 낙관적 동시성 토큰 — PATCH 에 그대로 실어 보내면 그 사이 다른 편집이 있었는지 서버가 판정한다.
    int version,
    // WP-377 진행 중 AI 작업(급한 순). 없으면 JSON 에서 생략.
    @JsonInclude(JsonInclude.Include.NON_EMPTY) List<AgentWorkView> agentWork,
    // WP-375 AI 위임 작업 행의 에픽 묶음 — /me/ai-tasks 만 채운다. 없으면 JSON 에서 생략.
    @JsonInclude(JsonInclude.Include.NON_NULL) AiTaskGroup aiGroup,
    // WP-426 AI 위임 작업 행의 프로젝트 이름·건수 — /me/ai-tasks 만 채운다. 없으면 JSON 에서 생략.
    @JsonInclude(JsonInclude.Include.NON_NULL) AiTaskProject aiProject,
    // WP-915 /me/issues 프로젝트 묶음 정렬(group=due|recent) 행의 프로젝트 이름·건수 — 그 요청만 채운다. 없으면 JSON 에서 생략.
    @JsonInclude(JsonInclude.Include.NON_NULL) AiTaskProject projectGroup,
    // WP-270 목록 열(보고자) — 검색 목록 조립(assembleItems)만 채운다. reporterId 와 함께 이름·종류를 내려 목록이 상세 조회 없이 그린다.
    // 없으면 JSON 에서 생략.
    @JsonInclude(JsonInclude.Include.NON_NULL) UserSummary reporter,
    // WP-270 목록 열(사이클) — 검색 목록 조립만 채운다(시작일 최신순). 연결이 없으면 빈 배열, 목록 조립 밖 경로는 null 이라 생략.
    @JsonInclude(JsonInclude.Include.NON_NULL) List<CycleSummary> cycles,
    // WP-933 붙은 구성요소(목록 순서 — 이름 대소문자 무시 오름차순). 상세·목록·생성 응답이 채우고, 없으면 빈 배열(null 아님).
    List<ComponentSummary> components) {

  /** 진행 중 AI 작업 목록을 채운 사본을 돌려준다(목록·상세 조립 단계에서 한 번에 조회해 주입). */
  public IssueResponse withAgentWork(List<AgentWorkView> list) {
    return copyWith(
        list == null ? List.of() : list,
        aiGroup,
        aiProject,
        projectGroup,
        reporter,
        cycles,
        components);
  }

  /** AI 위임 작업 묶음 정보를 채운 사본(WP-375 — /me/ai-tasks 조립 단계). */
  public IssueResponse withAiGroup(AiTaskGroup g) {
    return copyWith(agentWork, g, aiProject, projectGroup, reporter, cycles, components);
  }

  /** AI 위임 작업 프로젝트 정보(이름·건수)를 채운 사본(WP-426 — /me/ai-tasks 조립 단계). */
  public IssueResponse withAiProject(AiTaskProject p) {
    return copyWith(agentWork, aiGroup, p, projectGroup, reporter, cycles, components);
  }

  /** /me/issues 프로젝트 묶음 정보(이름·건수)를 채운 사본(WP-915 — group 요청 조립 단계). */
  public IssueResponse withProjectGroup(AiTaskProject p) {
    return copyWith(agentWork, aiGroup, aiProject, p, reporter, cycles, components);
  }

  /** 보고자·사이클을 채운 사본(WP-270 — 검색 목록 조립 단계에서 일괄 조회해 주입). */
  public IssueResponse withListExtras(UserSummary newReporter, List<CycleSummary> newCycles) {
    return copyWith(
        agentWork, aiGroup, aiProject, projectGroup, newReporter, newCycles, components);
  }

  /** 붙은 구성요소를 채운 사본(WP-933 — 상세·목록 조립 단계에서 일괄 조회해 주입). null 은 빈 배열로. */
  public IssueResponse withComponents(List<ComponentSummary> list) {
    return copyWith(
        agentWork,
        aiGroup,
        aiProject,
        projectGroup,
        reporter,
        cycles,
        list == null ? List.of() : list);
  }

  /**
   * 나머지 필드는 그대로 두고 agentWork·aiGroup·aiProject·projectGroup·reporter·cycles·components 만 바꾼 사본 — 필드
   * 복사를 한 곳에 둔다.
   */
  private IssueResponse copyWith(
      List<AgentWorkView> newAgentWork,
      AiTaskGroup newAiGroup,
      AiTaskProject newAiProject,
      AiTaskProject newProjectGroup,
      UserSummary newReporter,
      List<CycleSummary> newCycles,
      List<ComponentSummary> newComponents) {
    return new IssueResponse(
        id,
        projectKey,
        number,
        title,
        status,
        statusId,
        statusName,
        statusColor,
        priority,
        dueDate,
        startDate,
        milestoneId,
        milestoneName,
        reporterId,
        createdAt,
        updatedAt,
        closedAt,
        labels,
        attachmentCount,
        type,
        assignees,
        parent,
        childCount,
        childDoneCount,
        blockedBy,
        blocks,
        blocked,
        customFields,
        version,
        newAgentWork,
        newAiGroup,
        newAiProject,
        newProjectGroup,
        newReporter,
        newCycles,
        newComponents);
  }

  /**
   * projectKey + 내부 row → 응답 변환. labels/type/assignees null, attachmentCount 0 — Phase 1·2 호출자 호환.
   * parent/childCount/childDoneCount/blockedBy/blocks/blocked 는 default.
   */
  public static IssueResponse from(String projectKey, IssueRow r) {
    return new IssueResponse(
        r.id(),
        projectKey,
        r.number(),
        r.title(),
        r.status(),
        r.statusId(),
        r.statusName(),
        r.statusColor(),
        r.priority(),
        r.dueDate(),
        r.startDate(),
        r.milestoneId(),
        r.milestoneName(),
        r.reporterId(),
        r.createdAt(),
        r.updatedAt(),
        r.closedAt(),
        List.of(),
        0,
        null,
        List.of(),
        null,
        0,
        0,
        List.of(),
        List.of(),
        false,
        List.of(),
        r.version(),
        List.of(),
        null,
        null,
        null,
        null,
        null,
        List.of());
  }

  /**
   * projectKey + 내부 row + 라벨 → 응답 변환. attachmentCount 0, type null, assignees 빈 리스트 — Phase 3a 호출자
   * 호환.
   */
  public static IssueResponse fromWithLabels(
      String projectKey, IssueRow r, List<LabelSummary> labels) {
    return new IssueResponse(
        r.id(),
        projectKey,
        r.number(),
        r.title(),
        r.status(),
        r.statusId(),
        r.statusName(),
        r.statusColor(),
        r.priority(),
        r.dueDate(),
        r.startDate(),
        r.milestoneId(),
        r.milestoneName(),
        r.reporterId(),
        r.createdAt(),
        r.updatedAt(),
        r.closedAt(),
        labels == null ? List.of() : labels,
        0,
        null,
        List.of(),
        null,
        0,
        0,
        List.of(),
        List.of(),
        false,
        List.of(),
        r.version(),
        List.of(),
        null,
        null,
        null,
        null,
        null,
        List.of());
  }

  /** 라벨 + 첨부 카운트까지 채운 버전 — Phase 3b 호출자 호환. type null, assignees 빈 리스트. */
  public static IssueResponse fromWithDetails(
      String projectKey, IssueRow r, List<LabelSummary> labels, int attachmentCount) {
    return new IssueResponse(
        r.id(),
        projectKey,
        r.number(),
        r.title(),
        r.status(),
        r.statusId(),
        r.statusName(),
        r.statusColor(),
        r.priority(),
        r.dueDate(),
        r.startDate(),
        r.milestoneId(),
        r.milestoneName(),
        r.reporterId(),
        r.createdAt(),
        r.updatedAt(),
        r.closedAt(),
        labels == null ? List.of() : labels,
        attachmentCount,
        null,
        List.of(),
        null,
        0,
        0,
        List.of(),
        List.of(),
        false,
        List.of(),
        r.version(),
        List.of(),
        null,
        null,
        null,
        null,
        null,
        List.of());
  }

  /** 라벨 + 첨부 카운트 + 담당자까지 채운 풀버전 — Phase 3c 호출자 호환. type null. */
  public static IssueResponse fromWithFullDetails(
      String projectKey,
      IssueRow r,
      List<LabelSummary> labels,
      int attachmentCount,
      List<UserSummary> assignees) {
    return new IssueResponse(
        r.id(),
        projectKey,
        r.number(),
        r.title(),
        r.status(),
        r.statusId(),
        r.statusName(),
        r.statusColor(),
        r.priority(),
        r.dueDate(),
        r.startDate(),
        r.milestoneId(),
        r.milestoneName(),
        r.reporterId(),
        r.createdAt(),
        r.updatedAt(),
        r.closedAt(),
        labels == null ? List.of() : labels,
        attachmentCount,
        null,
        assignees == null ? List.of() : assignees,
        null,
        0,
        0,
        List.of(),
        List.of(),
        false,
        List.of(),
        r.version(),
        List.of(),
        null,
        null,
        null,
        null,
        null,
        List.of());
  }

  /** Phase 4 — 라벨 + 첨부 카운트 + 유형 + 담당자 모두 채운 풀버전. */
  public static IssueResponse fromWithType(
      String projectKey,
      IssueRow r,
      List<LabelSummary> labels,
      int attachmentCount,
      IssueTypeSummary type,
      List<UserSummary> assignees) {
    return new IssueResponse(
        r.id(),
        projectKey,
        r.number(),
        r.title(),
        r.status(),
        r.statusId(),
        r.statusName(),
        r.statusColor(),
        r.priority(),
        r.dueDate(),
        r.startDate(),
        r.milestoneId(),
        r.milestoneName(),
        r.reporterId(),
        r.createdAt(),
        r.updatedAt(),
        r.closedAt(),
        labels == null ? List.of() : labels,
        attachmentCount,
        type,
        assignees == null ? List.of() : assignees,
        null,
        0,
        0,
        List.of(),
        List.of(),
        false,
        List.of(),
        r.version(),
        List.of(),
        null,
        null,
        null,
        null,
        null,
        List.of());
  }

  /**
   * Phase 4a — 부모/자식 트리 정보까지 채운 풀버전. parent 는 SUBTASK 일 때만 non-null, childCount/childDoneCount 는
   * 비SUBTASK 의 자식 집계. (의존성 default 유지)
   */
  public static IssueResponse fromWithSubtasks(
      String projectKey,
      IssueRow r,
      List<LabelSummary> labels,
      int attachmentCount,
      IssueTypeSummary type,
      List<UserSummary> assignees,
      ParentRef parent,
      int childCount,
      int childDoneCount) {
    return new IssueResponse(
        r.id(),
        projectKey,
        r.number(),
        r.title(),
        r.status(),
        r.statusId(),
        r.statusName(),
        r.statusColor(),
        r.priority(),
        r.dueDate(),
        r.startDate(),
        r.milestoneId(),
        r.milestoneName(),
        r.reporterId(),
        r.createdAt(),
        r.updatedAt(),
        r.closedAt(),
        labels == null ? List.of() : labels,
        attachmentCount,
        type,
        assignees == null ? List.of() : assignees,
        parent,
        childCount,
        childDoneCount,
        List.of(),
        List.of(),
        false,
        List.of(),
        r.version(),
        List.of(),
        null,
        null,
        null,
        null,
        null,
        List.of());
  }

  /** Phase 4b — 의존성(blockedBy/blocks/blocked) 까지 채운 최신 풀버전. 검색/상세 경로에서 사용. */
  public static IssueResponse fromWithDeps(
      String projectKey,
      IssueRow r,
      List<LabelSummary> labels,
      int attachmentCount,
      IssueTypeSummary type,
      List<UserSummary> assignees,
      ParentRef parent,
      int childCount,
      int childDoneCount,
      List<IssueLinkSummary> blockedBy,
      List<IssueLinkSummary> blocks,
      boolean blocked) {
    return new IssueResponse(
        r.id(),
        projectKey,
        r.number(),
        r.title(),
        r.status(),
        r.statusId(),
        r.statusName(),
        r.statusColor(),
        r.priority(),
        r.dueDate(),
        r.startDate(),
        r.milestoneId(),
        r.milestoneName(),
        r.reporterId(),
        r.createdAt(),
        r.updatedAt(),
        r.closedAt(),
        labels == null ? List.of() : labels,
        attachmentCount,
        type,
        assignees == null ? List.of() : assignees,
        parent,
        childCount,
        childDoneCount,
        blockedBy == null ? List.of() : blockedBy,
        blocks == null ? List.of() : blocks,
        blocked,
        List.of(),
        r.version(),
        List.of(),
        null,
        null,
        null,
        null,
        null,
        List.of());
  }

  /**
   * Phase 4c — 의존성 + customFields 까지 채운 최신 풀버전. 검색/상세 경로에서 사용. customFields 는 null 이면 빈 리스트로 정규화.
   */
  public static IssueResponse fromWithCustomFields(
      String projectKey,
      IssueRow r,
      List<LabelSummary> labels,
      int attachmentCount,
      IssueTypeSummary type,
      List<UserSummary> assignees,
      ParentRef parent,
      int childCount,
      int childDoneCount,
      List<IssueLinkSummary> blockedBy,
      List<IssueLinkSummary> blocks,
      boolean blocked,
      List<IssueFieldEntry> customFields) {
    return new IssueResponse(
        r.id(),
        projectKey,
        r.number(),
        r.title(),
        r.status(),
        r.statusId(),
        r.statusName(),
        r.statusColor(),
        r.priority(),
        r.dueDate(),
        r.startDate(),
        r.milestoneId(),
        r.milestoneName(),
        r.reporterId(),
        r.createdAt(),
        r.updatedAt(),
        r.closedAt(),
        labels == null ? List.of() : labels,
        attachmentCount,
        type,
        assignees == null ? List.of() : assignees,
        parent,
        childCount,
        childDoneCount,
        blockedBy == null ? List.of() : blockedBy,
        blocks == null ? List.of() : blocks,
        blocked,
        customFields == null ? List.of() : customFields,
        r.version(),
        List.of(),
        null,
        null,
        null,
        null,
        null,
        List.of());
  }
}
