package com.workplace.issue.workflow.exception;

import com.workplace.issue.workflow.domain.MoveViolation;
import com.workplace.issue.workflow.dto.WorkflowProblem;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;

/**
 * 워크플로우 정의 API 의 거절 — 사유마다 상태와 {@code errors.code} 가 달라 화면·AI 가 다음 행동을 가른다. 정적 팩토리로만 만들고 {@link
 * WorkflowExceptionHandler} 가 응답으로 옮긴다.
 *
 * <p>문구에 id·이름·원문을 되비추지 않는다 — 없음과 못 봄의 본문이 같아야 하고, 사용자 입력은 믿을 수 없다.
 */
public class WorkflowException extends RuntimeException {

  private final HttpStatus status;
  private final String code;
  private final List<WorkflowProblem> problems;
  private final Map<String, String> details;

  /** 상태·코드·문구·문제를 묶는다(사유는 아래 팩토리로만 늘린다). */
  private WorkflowException(
      HttpStatus status, String code, String message, List<WorkflowProblem> problems) {
    this(status, code, message, problems, Map.of());
  }

  /** errors 에 code 옆으로 실을 칸(실행 오류의 currentNode·revision·keys·role·candidates)까지 묶는다. */
  private WorkflowException(
      HttpStatus status,
      String code,
      String message,
      List<WorkflowProblem> problems,
      Map<String, String> details) {
    super(message);
    this.status = status;
    this.code = code;
    this.problems = List.copyOf(problems);
    this.details = Collections.unmodifiableMap(new LinkedHashMap<>(details));
  }

  /**
   * 실행 판정의 위반을 응답으로(WP-1985) — 판정(순수 함수)이 값으로 돌려준 상태·code·문장·칸을 그대로 옮긴다. 위반의 errors 에는 code 가 없으므로
   * 처리기가 code 를 앞에 더한다.
   */
  public static WorkflowException fromViolation(MoveViolation v) {
    return new WorkflowException(
        HttpStatus.valueOf(v.status()), v.code(), v.message(), List.of(), v.errors());
  }

  /** 이슈에 이미 진행 중인 실행이 있다(WP-1985). */
  public static WorkflowException alreadyActive() {
    return new WorkflowException(
        HttpStatus.CONFLICT, "WORKFLOW_ALREADY_ACTIVE", "이 이슈에는 이미 진행 중인 워크플로우가 있습니다.", List.of());
  }

  /**
   * 워크플로우 이슈의 지금 노드 담당 AI 가 답변 필요·검토 대기·완료·취소·반려를 작업 보고로 직접 바꾸려 했다(WP-1986, 원장 R9). 워크플로우에서
   * 질문·검토·노드 끝내기는 노드 이동(질문 결과·다음 노드)으로만 한다 — 보고로 바꾸면 실행은 그대로인데 agent_work 만 멈추거나 끝나 아무도 이어 받지 못한다.
   */
  public static WorkflowException useMove() {
    return new WorkflowException(
        HttpStatus.CONFLICT,
        "WORKFLOW_USE_MOVE",
        "워크플로우가 진행 중인 이슈에서는 노드 담당이 답변 필요·검토 대기·완료·취소·반려를 보고로 바꿀 수 없습니다. 노드 이동(move_issue_workflow)의 질문·다음 단계 결과를 쓰세요.",
        List.of());
  }

  /** 조치는 멈춘(SUSPENDED) 실행에만 한다(WP-1986) — 진행 중인 실행은 노드 이동으로 넘긴다. */
  public static WorkflowException notSuspended() {
    return new WorkflowException(
        HttpStatus.CONFLICT,
        "WORKFLOW_NOT_SUSPENDED",
        "워크플로우가 멈춰 있지 않아 조치할 수 없습니다. 노드 이동으로 넘겨 주세요.",
        List.of());
  }

  /** 지금 노드에 onError 가 정의돼 있지 않아 onError 로 보낼 수 없다(WP-1986). */
  @SuppressWarnings("deprecation")
  public static WorkflowException noOnError() {
    return new WorkflowException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "WORKFLOW_NO_ON_ERROR",
        "이 단계에는 오류 시 갈 곳(onError)이 정의돼 있지 않습니다. 다시 시도·옮기기·취소 중에서 골라 주세요.",
        List.of());
  }

  /** 관리자 옮기기(override)는 프로젝트 관리자만 한다(WP-1986). */
  public static WorkflowException notManager() {
    return new WorkflowException(
        HttpStatus.FORBIDDEN, "WORKFLOW_NOT_MANAGER", "다른 단계로 옮기기는 프로젝트 관리자만 할 수 있습니다.", List.of());
  }

  /**
   * 옮기기 조치의 대상이 잘못됐다(WP-1986) — 빠졌거나, 이 실행의 정의에 없거나, start 다. 사유마다 문구만 다르고 code 는 하나다(계약). 받은 값은
   * 되비추지 않는다.
   *
   * @param missing 대상(toNode)이 빠졌으면 true — 고르라는 문구를 쓴다
   */
  @SuppressWarnings("deprecation")
  public static WorkflowException recoverTargetInvalid(boolean missing) {
    return new WorkflowException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "WORKFLOW_RECOVER_TARGET_INVALID",
        missing ? "옮길 단계(toNode)를 골라 주세요." : "이 워크플로우에 없는 단계이거나 시작 단계라 옮길 수 없습니다.",
        List.of());
  }

  /** 꺼진 워크플로우는 시작할 수 없다(WP-1985). */
  public static WorkflowException disabled() {
    return new WorkflowException(
        HttpStatus.CONFLICT, "WORKFLOW_DISABLED", "꺼진 워크플로우는 시작할 수 없습니다. 먼저 켜 주세요.", List.of());
  }

  /** 닫힌 이슈에는 시작할 수 없다(WP-1985). */
  public static WorkflowException issueClosed() {
    return new WorkflowException(
        HttpStatus.CONFLICT, "WORKFLOW_ISSUE_CLOSED", "닫힌 이슈에는 워크플로우를 시작할 수 없습니다.", List.of());
  }

  /** 지금 담당 중 어떤 시작 조건에도 맞는 사람이 없다(WP-1985). */
  @SuppressWarnings("deprecation")
  public static WorkflowException noStartMatch() {
    return new WorkflowException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "WORKFLOW_NO_START_MATCH",
        "지금 담당 중 시작 조건의 역할에 든 사람이 없습니다. 역할 구성원을 담당으로 넣고 다시 시작해 주세요.",
        List.of());
  }

  /**
   * 질문 이동(ask)이 아닌데 시안 첨부(fileIds)·답 선택지(options)를 보냈거나, 질문 이동인데 붙일 질문 글(의견)이 비었다(WP-2147). 둘 다 질문
   * 글에 붙는 것이라 붙일 글이 없으면 조용히 버리지 않고 거절한다.
   */
  public static WorkflowException questionExtrasWithoutQuestion() {
    return new WorkflowException(
        HttpStatus.BAD_REQUEST,
        "WORKFLOW_QUESTION_EXTRAS_ONLY",
        "fileIds·options 는 질문 이동(ask)에서 의견(질문 글)과 함께만 보낼 수 있습니다.",
        List.of());
  }

  /** 실행 목록의 status 가 실행 상태 값 하나가 아니다(WP-1985). 받은 값은 되비추지 않는다. */
  public static WorkflowException invalidRunStatus() {
    return new WorkflowException(
        HttpStatus.BAD_REQUEST,
        "WORKFLOW_INVALID_RUN_STATUS",
        "status 는 RUNNING·WAITING·SUSPENDED·COMPLETED·CANCELED 중 하나여야 합니다.",
        List.of());
  }

  /** 실행 목록의 cursor 를 읽을 수 없다(WP-1985) — 앞 응답의 nextCursor 를 그대로 보내야 한다. */
  public static WorkflowException invalidCursor() {
    return new WorkflowException(
        HttpStatus.BAD_REQUEST,
        "WORKFLOW_INVALID_CURSOR",
        "cursor 를 읽을 수 없습니다. 앞 응답의 nextCursor 를 그대로 보내 주세요.",
        List.of());
  }

  /** 실행 목록의 size 가 1~{@code max} 밖이다(WP-1985). */
  public static WorkflowException invalidPageSize(int max) {
    return new WorkflowException(
        HttpStatus.BAD_REQUEST,
        "WORKFLOW_INVALID_PAGE_SIZE",
        "size 는 1 부터 " + max + " 까지입니다.",
        List.of());
  }

  /** 같은 프로젝트에 같은 이름(대소문자 무시)이 있다. */
  public static WorkflowException nameTaken() {
    return new WorkflowException(
        HttpStatus.BAD_REQUEST, "WORKFLOW_NAME_TAKEN", "이 프로젝트에 같은 이름의 워크플로우가 이미 있습니다.", List.of());
  }

  /** 저장하려는 YAML 이 상한을 넘는다. */
  public static WorkflowException yamlTooLarge() {
    return new WorkflowException(
        HttpStatus.BAD_REQUEST,
        "WORKFLOW_YAML_TOO_LARGE",
        "YAML 이 너무 큽니다. 256 KiB 까지 저장할 수 있습니다.",
        List.of());
  }

  /** 없거나 볼 수 없는 워크플로우 — 둘을 구별하지 않는다(다르면 비공개 프로젝트의 정의가 있는지 드러난다). */
  public static WorkflowException notFound() {
    return new WorkflowException(
        HttpStatus.NOT_FOUND, "WORKFLOW_NOT_FOUND", "워크플로우를 찾을 수 없거나 볼 수 없습니다.", List.of());
  }

  /** 이 워크플로우에 그 번호의 게시 버전이 없다. */
  public static WorkflowException versionNotFound() {
    return new WorkflowException(
        HttpStatus.NOT_FOUND,
        "WORKFLOW_VERSION_NOT_FOUND",
        "이 워크플로우에 그 번호로 게시한 버전이 없습니다.",
        List.of());
  }

  /** 본 뒤에 초안이 바뀌었다. */
  public static WorkflowException draftConflict() {
    return new WorkflowException(
        HttpStatus.CONFLICT,
        "WORKFLOW_DRAFT_CONFLICT",
        "그사이 초안이 바뀌었습니다. 새로 불러온 뒤 다시 시도해 주세요.",
        List.of());
  }

  /** 게시한 버전 없이 켜려고 했다. */
  public static WorkflowException notPublished() {
    return notPublished("게시한 버전이 없어 켤 수 없습니다. 먼저 게시해 주세요.");
  }

  /**
   * 게시한 버전이 없는 워크플로우로 실행을 시작하려 했다(켜진 채 게시 버전이 지워진 경우 등). code·상태는 {@link #notPublished()} 와 같고 문구만
   * 시작에 맞춘다 — 켜기 문구(「켤 수 없습니다」)는 시작하는 사람에게 맞지 않는다.
   */
  public static WorkflowException notPublishedForStart() {
    return notPublished("게시된 버전이 없는 워크플로우로는 실행을 시작할 수 없습니다.");
  }

  /** 게시 버전 없음 409 의 공통 모양 — code·상태를 한곳에 두어 켜기·시작 문구가 갈라져도 계약은 같게 한다. */
  private static WorkflowException notPublished(String message) {
    return new WorkflowException(HttpStatus.CONFLICT, "WORKFLOW_NOT_PUBLISHED", message, List.of());
  }

  /**
   * 켜려는(게시하고 켜려는) 워크플로우의 시작 조건이 이미 켜진 다른 워크플로우와 같은 사람을 가리킨다(WP-2119). 화면이 어느 것을 끌지 고르도록 상대 이름과 겹친
   * 사람을 문구에 싣는다 — 같은 프로젝트의 OWNER 만 닿는 경로라 이름이 새지 않는다.
   */
  public static WorkflowException startConditionOverlap(String otherName, String personName) {
    return new WorkflowException(
        HttpStatus.CONFLICT,
        "WORKFLOW_START_CONDITION_OVERLAP",
        "시작 조건이 켜져 있는 워크플로우 '"
            + otherName
            + "' 와 겹칩니다("
            + personName
            + "). 그 워크플로우를 먼저 끄거나 시작 조건을 바꿔 주세요.",
        List.of());
  }

  /** 오류가 있는 초안의 게시 거절 — 고칠 곳을 바로 보여 주도록 경고까지 모든 문제를 함께 담는다. */
  @SuppressWarnings("deprecation")
  public static WorkflowException invalid(List<WorkflowProblem> problems) {
    // 저장소의 다른 422 와 같은 상수(Spring 7 에서 이름만 낡음) — 새 상수로 바꾸면 이 본문의 error 글만 달라진다.
    return new WorkflowException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "WORKFLOW_INVALID",
        "초안에 오류가 있어 게시할 수 없습니다. 문제를 고친 뒤 다시 게시해 주세요.",
        problems);
  }

  /** 응답의 HTTP 상태. */
  public HttpStatus status() {
    return status;
  }

  /** 응답 {@code errors.code} — 부르는 쪽이 사유를 가르는 계약이다. */
  public String code() {
    return code;
  }

  /** errors 에 code 다음으로 실을 칸(없으면 빈 맵). */
  public Map<String, String> details() {
    return details;
  }

  /** 게시를 막은 문제(422 외에는 빈 목록). */
  public List<WorkflowProblem> problems() {
    return problems;
  }
}
