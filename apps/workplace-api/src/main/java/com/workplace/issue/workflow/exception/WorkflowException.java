package com.workplace.issue.workflow.exception;

import com.workplace.issue.workflow.dto.WorkflowProblem;
import java.util.List;
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

  /** 상태·코드·문구·문제를 묶는다(사유는 아래 팩토리로만 늘린다). */
  private WorkflowException(
      HttpStatus status, String code, String message, List<WorkflowProblem> problems) {
    super(message);
    this.status = status;
    this.code = code;
    this.problems = List.copyOf(problems);
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
    return new WorkflowException(
        HttpStatus.CONFLICT,
        "WORKFLOW_NOT_PUBLISHED",
        "게시한 버전이 없어 켤 수 없습니다. 먼저 게시해 주세요.",
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

  /** 게시를 막은 문제(422 외에는 빈 목록). */
  public List<WorkflowProblem> problems() {
    return problems;
  }
}
