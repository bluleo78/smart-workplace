package com.workplace.global.exception;

import com.workplace.auth.exception.AccountLockedException;
import com.workplace.auth.exception.EmailAlreadyExistsException;
import com.workplace.auth.exception.InvalidCredentialsException;
import com.workplace.auth.exception.InvalidTokenException;
import com.workplace.auth.exception.UsernameAlreadyExistsException;
import com.workplace.chat.exception.ChatMessageAuthorMismatchException;
import com.workplace.chat.exception.ChatMessageNotFoundException;
import com.workplace.chat.exception.ChatThreadNotMemberException;
import com.workplace.global.dto.ErrorResponse;
import com.workplace.issue.exception.AttachmentLimitExceededException;
import com.workplace.issue.exception.AttachmentNotFoundException;
import com.workplace.issue.exception.AttachmentTooLargeException;
import com.workplace.issue.exception.InvalidAssigneeForProjectException;
import com.workplace.issue.exception.InvalidCursorException;
import com.workplace.issue.exception.InvalidIssueOperationException;
import com.workplace.issue.exception.InvalidTypeForProjectException;
import com.workplace.issue.exception.InvalidTypeIconException;
import com.workplace.issue.exception.IssueAssigneeAgentRestrictionException;
import com.workplace.issue.exception.IssueCommentNotFoundException;
import com.workplace.issue.exception.IssueNotFoundException;
import com.workplace.issue.exception.SystemTypeImmutableException;
import com.workplace.issue.exception.TypeInUseException;
import com.workplace.issue.exception.TypeNameDuplicatedException;
import com.workplace.issue.exception.TypeNotFoundException;
import com.workplace.label.exception.InvalidColorTokenException;
import com.workplace.label.exception.InvalidLabelForProjectException;
import com.workplace.label.exception.LabelNameDuplicatedException;
import com.workplace.label.exception.LabelNotFoundException;
import com.workplace.project.exception.ProjectAccessDeniedException;
import com.workplace.project.exception.ProjectConflictException;
import com.workplace.project.exception.ProjectNotFoundException;
import com.workplace.role.exception.RoleNotFoundException;
import com.workplace.role.exception.SystemRoleModificationException;
import com.workplace.user.exception.UserDeactivatedException;
import com.workplace.user.exception.UserNotFoundException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.ConstraintViolationException;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

@RestControllerAdvice
@Slf4j
public class GlobalExceptionHandler {

  private ErrorResponse buildError(
      HttpStatus status, String message, Map<String, String> errors, HttpServletRequest request) {
    return new ErrorResponse(
        status.value(),
        status.getReasonPhrase(),
        message,
        errors,
        Instant.now().toString(),
        request.getRequestURI());
  }

  @ExceptionHandler(MethodArgumentNotValidException.class)
  public ResponseEntity<ErrorResponse> handleValidationExceptions(
      MethodArgumentNotValidException ex, HttpServletRequest request) {
    Map<String, String> fieldErrors = new HashMap<>();
    ex.getBindingResult()
        .getFieldErrors()
        .forEach(error -> fieldErrors.put(error.getField(), error.getDefaultMessage()));
    ErrorResponse response =
        buildError(HttpStatus.BAD_REQUEST, "Validation failed", fieldErrors, request);
    return ResponseEntity.badRequest().body(response);
  }

  /**
   * @Validated + @Min/@Max 등 쿼리 파라미터 제약 위반 시 400 반환
   */
  @ExceptionHandler(ConstraintViolationException.class)
  public ResponseEntity<ErrorResponse> handleConstraintViolation(
      ConstraintViolationException ex, HttpServletRequest request) {
    Map<String, String> fieldErrors = new HashMap<>();
    ex.getConstraintViolations()
        .forEach(
            v -> {
              String path = v.getPropertyPath().toString();
              String field = path.contains(".") ? path.substring(path.lastIndexOf('.') + 1) : path;
              fieldErrors.put(field, v.getMessage());
            });
    ErrorResponse response =
        buildError(HttpStatus.BAD_REQUEST, "Validation failed", fieldErrors, request);
    return ResponseEntity.badRequest().body(response);
  }

  @ExceptionHandler(UsernameAlreadyExistsException.class)
  public ResponseEntity<ErrorResponse> handleUsernameAlreadyExists(
      UsernameAlreadyExistsException ex, HttpServletRequest request) {
    ErrorResponse response = buildError(HttpStatus.CONFLICT, ex.getMessage(), null, request);
    return ResponseEntity.status(HttpStatus.CONFLICT).body(response);
  }

  @ExceptionHandler(EmailAlreadyExistsException.class)
  public ResponseEntity<ErrorResponse> handleEmailAlreadyExists(
      EmailAlreadyExistsException ex, HttpServletRequest request) {
    ErrorResponse response = buildError(HttpStatus.CONFLICT, ex.getMessage(), null, request);
    return ResponseEntity.status(HttpStatus.CONFLICT).body(response);
  }

  @ExceptionHandler(InvalidCredentialsException.class)
  public ResponseEntity<ErrorResponse> handleInvalidCredentials(
      InvalidCredentialsException ex, HttpServletRequest request) {
    ErrorResponse response = buildError(HttpStatus.UNAUTHORIZED, ex.getMessage(), null, request);
    return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(response);
  }

  @ExceptionHandler(InvalidTokenException.class)
  public ResponseEntity<ErrorResponse> handleInvalidToken(
      InvalidTokenException ex, HttpServletRequest request) {
    ErrorResponse response = buildError(HttpStatus.UNAUTHORIZED, ex.getMessage(), null, request);
    return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(response);
  }

  @ExceptionHandler(DataIntegrityViolationException.class)
  public ResponseEntity<ErrorResponse> handleDataIntegrityViolation(
      DataIntegrityViolationException ex, HttpServletRequest request) {
    String message = "Data integrity violation";
    if (ex.getCause() != null) {
      String causeMsg = ex.getCause().getMessage();
      if (causeMsg != null && causeMsg.contains("duplicate key")) {
        message = "Data integrity violation: duplicate entry";
      } else if (causeMsg != null && causeMsg.contains("foreign key")) {
        message = "Data integrity violation: referenced record not found";
      } else if (causeMsg != null && causeMsg.contains("check constraint")) {
        message = "Data integrity violation: constraint check failed - " + causeMsg;
      } else if (causeMsg != null) {
        message = "Data integrity violation: " + causeMsg;
      }
    }
    ErrorResponse response = buildError(HttpStatus.CONFLICT, message, null, request);
    return ResponseEntity.status(HttpStatus.CONFLICT).body(response);
  }

  @ExceptionHandler(AccessDeniedException.class)
  public ResponseEntity<ErrorResponse> handleAccessDenied(
      AccessDeniedException ex, HttpServletRequest request) {
    ErrorResponse response = buildError(HttpStatus.FORBIDDEN, ex.getMessage(), null, request);
    return ResponseEntity.status(HttpStatus.FORBIDDEN).body(response);
  }

  @ExceptionHandler(UserNotFoundException.class)
  public ResponseEntity<ErrorResponse> handleUserNotFound(
      UserNotFoundException ex, HttpServletRequest request) {
    ErrorResponse response = buildError(HttpStatus.NOT_FOUND, ex.getMessage(), null, request);
    return ResponseEntity.status(HttpStatus.NOT_FOUND).body(response);
  }

  @ExceptionHandler(RoleNotFoundException.class)
  public ResponseEntity<ErrorResponse> handleRoleNotFound(
      RoleNotFoundException ex, HttpServletRequest request) {
    ErrorResponse response = buildError(HttpStatus.NOT_FOUND, ex.getMessage(), null, request);
    return ResponseEntity.status(HttpStatus.NOT_FOUND).body(response);
  }

  @ExceptionHandler(SystemRoleModificationException.class)
  public ResponseEntity<ErrorResponse> handleSystemRoleModification(
      SystemRoleModificationException ex, HttpServletRequest request) {
    ErrorResponse response = buildError(HttpStatus.BAD_REQUEST, ex.getMessage(), null, request);
    return ResponseEntity.badRequest().body(response);
  }

  @ExceptionHandler(UserDeactivatedException.class)
  public ResponseEntity<ErrorResponse> handleUserDeactivated(
      UserDeactivatedException ex, HttpServletRequest request) {
    ErrorResponse response = buildError(HttpStatus.UNAUTHORIZED, ex.getMessage(), null, request);
    return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(response);
  }

  /** 업로드 파일 크기가 제한을 초과했을 때 400 대신 명확한 메시지를 반환한다. Spring Boot 기본 동작은 500 또는 비구조화된 에러이므로 여기서 통일한다. */
  @ExceptionHandler(MaxUploadSizeExceededException.class)
  public ResponseEntity<ErrorResponse> handleMaxUploadSizeExceeded(
      MaxUploadSizeExceededException ex, HttpServletRequest request) {
    ErrorResponse response =
        buildError(
            HttpStatus.BAD_REQUEST, "파일 크기가 허용 한도를 초과했습니다. 더 작은 파일을 업로드해주세요.", null, request);
    return ResponseEntity.badRequest().body(response);
  }

  @ExceptionHandler(IllegalArgumentException.class)
  public ResponseEntity<ErrorResponse> handleIllegalArgument(
      IllegalArgumentException ex, HttpServletRequest request) {
    ErrorResponse response = buildError(HttpStatus.BAD_REQUEST, ex.getMessage(), null, request);
    return ResponseEntity.badRequest().body(response);
  }

  /**
   * 비즈니스 규칙 위반(예: 마지막 ADMIN 비활성화 시도)에 대해 409 Conflict 반환. IllegalArgumentException(400)과 구별하여 상태
   * 충돌임을 명확히 한다.
   */
  @ExceptionHandler(IllegalStateException.class)
  public ResponseEntity<ErrorResponse> handleIllegalState(
      IllegalStateException ex, HttpServletRequest request) {
    ErrorResponse response = buildError(HttpStatus.CONFLICT, ex.getMessage(), null, request);
    return ResponseEntity.status(HttpStatus.CONFLICT).body(response);
  }

  @ExceptionHandler(AccountLockedException.class)
  public ResponseEntity<ErrorResponse> handleAccountLocked(
      AccountLockedException ex, HttpServletRequest request) {
    ErrorResponse response =
        buildError(HttpStatus.TOO_MANY_REQUESTS, ex.getMessage(), null, request);
    return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS).body(response);
  }

  /** 지원하지 않는 HTTP 메서드로 요청 시 500 대신 405 반환 */
  @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
  public ResponseEntity<ErrorResponse> handleMethodNotAllowed(
      HttpRequestMethodNotSupportedException ex, HttpServletRequest request) {
    ErrorResponse response =
        buildError(HttpStatus.METHOD_NOT_ALLOWED, "지원하지 않는 HTTP 메서드입니다.", null, request);
    return ResponseEntity.status(HttpStatus.METHOD_NOT_ALLOWED).body(response);
  }

  /**
   * 경로/쿼리 파라미터 타입 불일치 시 500 대신 400 반환. 예: {@code Long id} 파라미터에 "abc" 같은 비-숫자 문자열이 전달되거나, {@code
   * Boolean} 쿼리 파라미터에 "notbool" 같은 값이 전달되는 경우. 클라이언트 입력 오류이므로 400으로 분류하여 모니터링 SLO 오염과 5xx 알람 노이즈를
   * 방지한다.
   */
  @ExceptionHandler(MethodArgumentTypeMismatchException.class)
  public ResponseEntity<ErrorResponse> handleTypeMismatch(
      MethodArgumentTypeMismatchException ex, HttpServletRequest request) {
    String typeName = ex.getRequiredType() != null ? ex.getRequiredType().getSimpleName() : "올바른";
    Map<String, String> fieldErrors =
        Map.of(ex.getName(), String.format("'%s'는 %s 타입이어야 합니다.", ex.getValue(), typeName));
    ErrorResponse response =
        buildError(HttpStatus.BAD_REQUEST, "Validation failed", fieldErrors, request);
    return ResponseEntity.badRequest().body(response);
  }

  /**
   * 요청 본문이 malformed JSON이거나 역직렬화에 실패한 경우 500 대신 400 반환. 같은 카테고리(클라이언트 입력 오류 → 4xx)이며 본문을 읽지 못한
   * 케이스이므로 400 Bad Request로 매핑한다.
   */
  @ExceptionHandler(HttpMessageNotReadableException.class)
  public ResponseEntity<ErrorResponse> handleMessageNotReadable(
      HttpMessageNotReadableException ex, HttpServletRequest request) {
    ErrorResponse response =
        buildError(HttpStatus.BAD_REQUEST, "요청 본문을 해석할 수 없습니다.", null, request);
    return ResponseEntity.badRequest().body(response);
  }

  /** 존재하지 않는 API 경로 요청 시 500 대신 404 반환 */
  @ExceptionHandler(NoResourceFoundException.class)
  public ResponseEntity<ErrorResponse> handleNoResourceFound(
      NoResourceFoundException ex, HttpServletRequest request) {
    ErrorResponse response = buildError(HttpStatus.NOT_FOUND, "요청한 리소스를 찾을 수 없습니다.", null, request);
    return ResponseEntity.status(HttpStatus.NOT_FOUND).body(response);
  }

  /** 프로젝트(또는 프로젝트 내 리소스)를 찾을 수 없는 경우 404 반환. */
  @ExceptionHandler(ProjectNotFoundException.class)
  public ResponseEntity<ErrorResponse> handleProjectNotFound(
      ProjectNotFoundException ex, HttpServletRequest request) {
    return ResponseEntity.status(HttpStatus.NOT_FOUND)
        .body(buildError(HttpStatus.NOT_FOUND, ex.getMessage(), null, request));
  }

  /** 프로젝트 접근 권한이 없는 경우 403 반환. */
  @ExceptionHandler(ProjectAccessDeniedException.class)
  public ResponseEntity<ErrorResponse> handleProjectAccessDenied(
      ProjectAccessDeniedException ex, HttpServletRequest request) {
    return ResponseEntity.status(HttpStatus.FORBIDDEN)
        .body(buildError(HttpStatus.FORBIDDEN, ex.getMessage(), null, request));
  }

  /** 프로젝트/멤버 관련 상태 충돌(key 중복, OWNER 최소 1명 등)인 경우 409 반환. */
  @ExceptionHandler(ProjectConflictException.class)
  public ResponseEntity<ErrorResponse> handleProjectConflict(
      ProjectConflictException ex, HttpServletRequest request) {
    return ResponseEntity.status(HttpStatus.CONFLICT)
        .body(buildError(HttpStatus.CONFLICT, ex.getMessage(), null, request));
  }

  /** 이슈를 찾을 수 없는 경우 404 반환. */
  @ExceptionHandler(IssueNotFoundException.class)
  public ResponseEntity<ErrorResponse> handleIssueNotFound(
      IssueNotFoundException ex, HttpServletRequest request) {
    return ResponseEntity.status(HttpStatus.NOT_FOUND)
        .body(buildError(HttpStatus.NOT_FOUND, ex.getMessage(), null, request));
  }

  /** 이슈 코멘트를 찾을 수 없는 경우 404 반환. */
  @ExceptionHandler(IssueCommentNotFoundException.class)
  public ResponseEntity<ErrorResponse> handleCommentNotFound(
      IssueCommentNotFoundException ex, HttpServletRequest request) {
    return ResponseEntity.status(HttpStatus.NOT_FOUND)
        .body(buildError(HttpStatus.NOT_FOUND, ex.getMessage(), null, request));
  }

  /** 잘못된 검색 cursor (또는 잘못된 검색 입력) 인 경우 400 반환. */
  @ExceptionHandler(InvalidCursorException.class)
  public ResponseEntity<ErrorResponse> handleInvalidCursor(
      InvalidCursorException ex, HttpServletRequest request) {
    return ResponseEntity.status(HttpStatus.BAD_REQUEST)
        .body(buildError(HttpStatus.BAD_REQUEST, ex.getMessage(), null, request));
  }

  /** 이슈 비즈니스 규칙 위반(잘못된 상태 전이 등)은 422 UNPROCESSABLE_ENTITY. */
  @ExceptionHandler(InvalidIssueOperationException.class)
  public ResponseEntity<ErrorResponse> handleInvalidIssueOp(
      InvalidIssueOperationException ex, HttpServletRequest request) {
    return ResponseEntity.status(HttpStatus.UNPROCESSABLE_ENTITY)
        .body(buildError(HttpStatus.UNPROCESSABLE_ENTITY, ex.getMessage(), null, request));
  }

  /** 라벨 없음 — 404. */
  @ExceptionHandler(LabelNotFoundException.class)
  public ResponseEntity<ErrorResponse> handleLabelNotFound(
      LabelNotFoundException ex, HttpServletRequest request) {
    return ResponseEntity.status(HttpStatus.NOT_FOUND)
        .body(buildError(HttpStatus.NOT_FOUND, ex.getMessage(), null, request));
  }

  /** 라벨 이름 중복 — 409. */
  @ExceptionHandler(LabelNameDuplicatedException.class)
  public ResponseEntity<ErrorResponse> handleLabelNameDuplicated(
      LabelNameDuplicatedException ex, HttpServletRequest request) {
    return ResponseEntity.status(HttpStatus.CONFLICT)
        .body(buildError(HttpStatus.CONFLICT, ex.getMessage(), null, request));
  }

  /** 허용되지 않은 색상 토큰 — 400. */
  @ExceptionHandler(InvalidColorTokenException.class)
  public ResponseEntity<ErrorResponse> handleInvalidColorToken(
      InvalidColorTokenException ex, HttpServletRequest request) {
    return ResponseEntity.badRequest()
        .body(buildError(HttpStatus.BAD_REQUEST, ex.getMessage(), null, request));
  }

  /** 이슈 프로젝트와 다른 라벨 부착 시도 — 400. */
  @ExceptionHandler(InvalidLabelForProjectException.class)
  public ResponseEntity<ErrorResponse> handleInvalidLabelForProject(
      InvalidLabelForProjectException ex, HttpServletRequest request) {
    return ResponseEntity.badRequest()
        .body(buildError(HttpStatus.BAD_REQUEST, ex.getMessage(), null, request));
  }

  /** 이슈 담당자로 비-멤버 사용자를 지정 — 400. */
  @ExceptionHandler(InvalidAssigneeForProjectException.class)
  public ResponseEntity<ErrorResponse> handleInvalidAssigneeForProject(
      InvalidAssigneeForProjectException ex, HttpServletRequest request) {
    return ResponseEntity.badRequest()
        .body(buildError(HttpStatus.BAD_REQUEST, ex.getMessage(), null, request));
  }

  /** Phase 5c-2 — AGENT 가 자기 외 assignee 변경 시도 → 403. */
  @ExceptionHandler(IssueAssigneeAgentRestrictionException.class)
  public ResponseEntity<ErrorResponse> handleAgentAssigneeRestriction(
      IssueAssigneeAgentRestrictionException ex, HttpServletRequest request) {
    return ResponseEntity.status(HttpStatus.FORBIDDEN)
        .body(buildError(HttpStatus.FORBIDDEN, ex.getMessage(), null, request));
  }

  /** 이슈 첨부 매핑 또는 file row 미존재 — 404. */
  @ExceptionHandler(AttachmentNotFoundException.class)
  public ResponseEntity<ErrorResponse> handleAttachmentNotFound(
      AttachmentNotFoundException ex, HttpServletRequest request) {
    return ResponseEntity.status(HttpStatus.NOT_FOUND)
        .body(buildError(HttpStatus.NOT_FOUND, ex.getMessage(), null, request));
  }

  /** 첨부 파일 사이즈 한도 초과 — 400. */
  @ExceptionHandler(AttachmentTooLargeException.class)
  public ResponseEntity<ErrorResponse> handleAttachmentTooLarge(
      AttachmentTooLargeException ex, HttpServletRequest request) {
    return ResponseEntity.badRequest()
        .body(buildError(HttpStatus.BAD_REQUEST, ex.getMessage(), null, request));
  }

  /** 이슈당 첨부 개수 한도 초과 — 409. */
  @ExceptionHandler(AttachmentLimitExceededException.class)
  public ResponseEntity<ErrorResponse> handleAttachmentLimit(
      AttachmentLimitExceededException ex, HttpServletRequest request) {
    return ResponseEntity.status(HttpStatus.CONFLICT)
        .body(buildError(HttpStatus.CONFLICT, ex.getMessage(), null, request));
  }

  /** 이슈 유형 정의를 찾을 수 없음 — 404. */
  @ExceptionHandler(TypeNotFoundException.class)
  public ResponseEntity<ErrorResponse> handleTypeNotFound(
      TypeNotFoundException ex, HttpServletRequest request) {
    return ResponseEntity.status(HttpStatus.NOT_FOUND)
        .body(buildError(HttpStatus.NOT_FOUND, ex.getMessage(), null, request));
  }

  /** 동일 프로젝트 내 유형 이름 중복 — 409. */
  @ExceptionHandler(TypeNameDuplicatedException.class)
  public ResponseEntity<ErrorResponse> handleTypeNameDuplicated(
      TypeNameDuplicatedException ex, HttpServletRequest request) {
    return ResponseEntity.status(HttpStatus.CONFLICT)
        .body(buildError(HttpStatus.CONFLICT, ex.getMessage(), null, request));
  }

  /** 시스템 유형(TASK/BUG/STORY/CHORE) 수정/삭제 시도 — 409. */
  @ExceptionHandler(SystemTypeImmutableException.class)
  public ResponseEntity<ErrorResponse> handleSystemTypeImmutable(
      SystemTypeImmutableException ex, HttpServletRequest request) {
    return ResponseEntity.status(HttpStatus.CONFLICT)
        .body(buildError(HttpStatus.CONFLICT, ex.getMessage(), null, request));
  }

  /** 사용 중인 CUSTOM 유형 삭제 시도 — 409. */
  @ExceptionHandler(TypeInUseException.class)
  public ResponseEntity<ErrorResponse> handleTypeInUse(
      TypeInUseException ex, HttpServletRequest request) {
    return ResponseEntity.status(HttpStatus.CONFLICT)
        .body(buildError(HttpStatus.CONFLICT, ex.getMessage(), null, request));
  }

  /** 다른 프로젝트의 유형 id 를 지정 — 400. */
  @ExceptionHandler(InvalidTypeForProjectException.class)
  public ResponseEntity<ErrorResponse> handleInvalidTypeForProject(
      InvalidTypeForProjectException ex, HttpServletRequest request) {
    return ResponseEntity.badRequest()
        .body(buildError(HttpStatus.BAD_REQUEST, ex.getMessage(), null, request));
  }

  /** 허용되지 않은 유형 아이콘 — 400. */
  @ExceptionHandler(InvalidTypeIconException.class)
  public ResponseEntity<ErrorResponse> handleInvalidTypeIcon(
      InvalidTypeIconException ex, HttpServletRequest request) {
    return ResponseEntity.badRequest()
        .body(buildError(HttpStatus.BAD_REQUEST, ex.getMessage(), null, request));
  }

  /** SUBTASK 생성 시 parentNumber 누락 — 400. */
  @ExceptionHandler(com.workplace.issue.exception.SubtaskParentRequiredException.class)
  public ResponseEntity<ErrorResponse> handleSubtaskParentRequired(
      com.workplace.issue.exception.SubtaskParentRequiredException ex, HttpServletRequest request) {
    return ResponseEntity.badRequest()
        .body(buildError(HttpStatus.BAD_REQUEST, ex.getMessage(), null, request));
  }

  /** 비SUBTASK 가 parentNumber 를 지정 — 400. */
  @ExceptionHandler(com.workplace.issue.exception.ParentNotAllowedException.class)
  public ResponseEntity<ErrorResponse> handleParentNotAllowed(
      com.workplace.issue.exception.ParentNotAllowedException ex, HttpServletRequest request) {
    return ResponseEntity.badRequest()
        .body(buildError(HttpStatus.BAD_REQUEST, ex.getMessage(), null, request));
  }

  /** 부모가 없거나 다른 프로젝트/자기 자신 — 400. */
  @ExceptionHandler(com.workplace.issue.exception.InvalidParentException.class)
  public ResponseEntity<ErrorResponse> handleInvalidParent(
      com.workplace.issue.exception.InvalidParentException ex, HttpServletRequest request) {
    return ResponseEntity.badRequest()
        .body(buildError(HttpStatus.BAD_REQUEST, ex.getMessage(), null, request));
  }

  /** parent 가 SUBTASK 인 경우 — 1단계 트리 위반. 400. */
  @ExceptionHandler(com.workplace.issue.exception.ParentCannotBeSubtaskException.class)
  public ResponseEntity<ErrorResponse> handleParentCannotBeSubtask(
      com.workplace.issue.exception.ParentCannotBeSubtaskException ex, HttpServletRequest request) {
    return ResponseEntity.badRequest()
        .body(buildError(HttpStatus.BAD_REQUEST, ex.getMessage(), null, request));
  }

  /** setParent 호출 대상이 SUBTASK 가 아님 — 400. */
  @ExceptionHandler(com.workplace.issue.exception.SetParentOnNonSubtaskException.class)
  public ResponseEntity<ErrorResponse> handleSetParentOnNonSubtask(
      com.workplace.issue.exception.SetParentOnNonSubtaskException ex, HttpServletRequest request) {
    return ResponseEntity.badRequest()
        .body(buildError(HttpStatus.BAD_REQUEST, ex.getMessage(), null, request));
  }

  /** 의존성 인자 유효성 위반(자기 자신/없는 이슈/다른 프로젝트) — 400. (Phase 4b) */
  @ExceptionHandler(com.workplace.issue.exception.InvalidDependencyException.class)
  public ResponseEntity<ErrorResponse> handleInvalidDependency(
      com.workplace.issue.exception.InvalidDependencyException ex, HttpServletRequest request) {
    return ResponseEntity.badRequest()
        .body(buildError(HttpStatus.BAD_REQUEST, ex.getMessage(), null, request));
  }

  /** 의존성 사이클 발생 — 409. (Phase 4b) */
  @ExceptionHandler(com.workplace.issue.exception.DependencyCycleException.class)
  public ResponseEntity<ErrorResponse> handleDependencyCycle(
      com.workplace.issue.exception.DependencyCycleException ex, HttpServletRequest request) {
    return ResponseEntity.status(HttpStatus.CONFLICT)
        .body(buildError(HttpStatus.CONFLICT, ex.getMessage(), null, request));
  }

  /** Phase 4c — 필드 정의 미존재 → 404. */
  @ExceptionHandler(com.workplace.issue.exception.FieldNotFoundException.class)
  public ResponseEntity<ErrorResponse> handleFieldNotFound(
      com.workplace.issue.exception.FieldNotFoundException ex, HttpServletRequest request) {
    return ResponseEntity.status(HttpStatus.NOT_FOUND)
        .body(buildError(HttpStatus.NOT_FOUND, ex.getMessage(), null, request));
  }

  /** Phase 4c — 동일 프로젝트 내 필드 이름 중복 → 409. */
  @ExceptionHandler(com.workplace.issue.exception.FieldNameDuplicatedException.class)
  public ResponseEntity<ErrorResponse> handleFieldNameDuplicated(
      com.workplace.issue.exception.FieldNameDuplicatedException ex, HttpServletRequest request) {
    return ResponseEntity.status(HttpStatus.CONFLICT)
        .body(buildError(HttpStatus.CONFLICT, ex.getMessage(), null, request));
  }

  /** Phase 4c — 허용되지 않은 필드 타입 → 400. */
  @ExceptionHandler(com.workplace.issue.exception.InvalidFieldTypeException.class)
  public ResponseEntity<ErrorResponse> handleInvalidFieldType(
      com.workplace.issue.exception.InvalidFieldTypeException ex, HttpServletRequest request) {
    return ResponseEntity.badRequest()
        .body(buildError(HttpStatus.BAD_REQUEST, ex.getMessage(), null, request));
  }

  /** Phase 4c — options 누락/형식/중복 또는 비-SELECT 타입의 options 지정 → 400. */
  @ExceptionHandler(com.workplace.issue.exception.InvalidFieldOptionsException.class)
  public ResponseEntity<ErrorResponse> handleInvalidFieldOptions(
      com.workplace.issue.exception.InvalidFieldOptionsException ex, HttpServletRequest request) {
    return ResponseEntity.badRequest()
        .body(buildError(HttpStatus.BAD_REQUEST, ex.getMessage(), null, request));
  }

  /** Phase 4c — 필드 PATCH 에서 type 변경 시도 → 400. */
  @ExceptionHandler(com.workplace.issue.exception.TypeImmutableException.class)
  public ResponseEntity<ErrorResponse> handleTypeImmutable(
      com.workplace.issue.exception.TypeImmutableException ex, HttpServletRequest request) {
    return ResponseEntity.badRequest()
        .body(buildError(HttpStatus.BAD_REQUEST, ex.getMessage(), null, request));
  }

  /** Phase 4c — 다른 프로젝트의 필드 defId 를 PUT 에 포함 → 400. */
  @ExceptionHandler(com.workplace.issue.exception.InvalidFieldForProjectException.class)
  public ResponseEntity<ErrorResponse> handleInvalidFieldForProject(
      com.workplace.issue.exception.InvalidFieldForProjectException ex,
      HttpServletRequest request) {
    return ResponseEntity.badRequest()
        .body(buildError(HttpStatus.BAD_REQUEST, ex.getMessage(), null, request));
  }

  /** Phase 4c — 필드 값 모양/옵션 위반 → 400. */
  @ExceptionHandler(com.workplace.issue.exception.InvalidFieldValueException.class)
  public ResponseEntity<ErrorResponse> handleInvalidFieldValue(
      com.workplace.issue.exception.InvalidFieldValueException ex, HttpServletRequest request) {
    return ResponseEntity.badRequest()
        .body(buildError(HttpStatus.BAD_REQUEST, ex.getMessage(), null, request));
  }

  /** Phase 5a — HUMAN 유저에 키 발급/조회/회수 시도 → 400. */
  @ExceptionHandler(com.workplace.auth.exception.KeyTargetMustBeAgentException.class)
  public ResponseEntity<ErrorResponse> handleKeyTargetMustBeAgent(
      com.workplace.auth.exception.KeyTargetMustBeAgentException ex, HttpServletRequest request) {
    return ResponseEntity.badRequest()
        .body(buildError(HttpStatus.BAD_REQUEST, ex.getMessage(), null, request));
  }

  /** Phase 5a — AGENT 로그인 시도 → 401. login_attempts 카운터는 증가시키지 않는다. */
  @ExceptionHandler(com.workplace.auth.exception.AgentCannotLoginException.class)
  public ResponseEntity<ErrorResponse> handleAgentCannotLogin(
      com.workplace.auth.exception.AgentCannotLoginException ex, HttpServletRequest request) {
    return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
        .body(buildError(HttpStatus.UNAUTHORIZED, ex.getMessage(), null, request));
  }

  /** Phase 5a — 존재하지 않거나 user 와 불일치하는 키 id → 404. */
  @ExceptionHandler(com.workplace.auth.exception.KeyNotFoundException.class)
  public ResponseEntity<ErrorResponse> handleKeyNotFound(
      com.workplace.auth.exception.KeyNotFoundException ex, HttpServletRequest request) {
    return ResponseEntity.status(HttpStatus.NOT_FOUND)
        .body(buildError(HttpStatus.NOT_FOUND, ex.getMessage(), null, request));
  }

  /** Phase 5c-2 후속 (#33) — AGENT 의 active OAuth 토큰 없음 → 404. */
  @ExceptionHandler(com.workplace.auth.exception.OAuthTokenNotFoundException.class)
  public ResponseEntity<ErrorResponse> handleOAuthTokenNotFound(
      com.workplace.auth.exception.OAuthTokenNotFoundException ex, HttpServletRequest request) {
    return ResponseEntity.status(HttpStatus.NOT_FOUND)
        .body(buildError(HttpStatus.NOT_FOUND, ex.getMessage(), null, request));
  }

  /** Phase 6a — chat thread 비-멤버가 쓰기/읽음 표시 등을 시도 → 403. */
  @ExceptionHandler(ChatThreadNotMemberException.class)
  public ResponseEntity<ErrorResponse> handleChatThreadNotMember(
      ChatThreadNotMemberException ex, HttpServletRequest request) {
    return ResponseEntity.status(HttpStatus.FORBIDDEN)
        .body(buildError(HttpStatus.FORBIDDEN, ex.getMessage(), null, request));
  }

  /** Phase 6a — 본인이 아닌 chat 메시지를 수정/삭제 시도 → 403. */
  @ExceptionHandler(ChatMessageAuthorMismatchException.class)
  public ResponseEntity<ErrorResponse> handleChatMessageAuthorMismatch(
      ChatMessageAuthorMismatchException ex, HttpServletRequest request) {
    return ResponseEntity.status(HttpStatus.FORBIDDEN)
        .body(buildError(HttpStatus.FORBIDDEN, ex.getMessage(), null, request));
  }

  /** Phase 6a — chat 메시지 id 미존재 또는 soft-deleted → 404. */
  @ExceptionHandler(ChatMessageNotFoundException.class)
  public ResponseEntity<ErrorResponse> handleChatMessageNotFound(
      ChatMessageNotFoundException ex, HttpServletRequest request) {
    return ResponseEntity.status(HttpStatus.NOT_FOUND)
        .body(buildError(HttpStatus.NOT_FOUND, ex.getMessage(), null, request));
  }

  @ExceptionHandler(Exception.class)
  public ResponseEntity<ErrorResponse> handleException(Exception ex, HttpServletRequest request) {
    log.error("Unhandled exception", ex);
    ErrorResponse response =
        buildError(HttpStatus.INTERNAL_SERVER_ERROR, "An unexpected error occurred", null, request);
    return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(response);
  }
}
