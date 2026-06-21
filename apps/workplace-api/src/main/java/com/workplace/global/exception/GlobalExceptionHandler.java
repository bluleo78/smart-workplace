package com.workplace.global.exception;

import com.workplace.auth.exception.AccountLockedException;
import com.workplace.auth.exception.EmailAlreadyExistsException;
import com.workplace.auth.exception.InvalidCredentialsException;
import com.workplace.auth.exception.InvalidTokenException;
import com.workplace.auth.exception.TenantAccessDeniedException;
import com.workplace.auth.exception.UsernameAlreadyExistsException;
import com.workplace.chat.exception.ChatMessageAuthorMismatchException;
import com.workplace.chat.exception.ChatMessageNotFoundException;
import com.workplace.chat.exception.ChatThreadNotMemberException;
import com.workplace.cycle.exception.CycleNameDuplicatedException;
import com.workplace.cycle.exception.CycleNotFoundException;
import com.workplace.cycle.exception.InvalidCycleForProjectException;
import com.workplace.cycle.exception.InvalidCycleStatusException;
import com.workplace.global.dto.ErrorResponse;
import com.workplace.home.exception.HomeComposeUnavailableException;
import com.workplace.home.outbound.AiAgentComposeException;
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
import com.workplace.messaging.exception.ChannelArchivedException;
import com.workplace.messaging.exception.ChannelForbiddenException;
import com.workplace.messaging.exception.ChannelNotFoundException;
import com.workplace.messaging.exception.ChannelNotMemberException;
import com.workplace.messaging.exception.EmptyMessageException;
import com.workplace.messaging.exception.InvalidDmRequestException;
import com.workplace.messaging.exception.InvalidMessageAttachmentException;
import com.workplace.messaging.exception.InvalidThreadParentException;
import com.workplace.messaging.exception.MessageAttachmentLimitExceededException;
import com.workplace.messaging.exception.MessageAttachmentTooLargeException;
import com.workplace.messaging.exception.MessageAuthorMismatchException;
import com.workplace.messaging.exception.MessageNotFoundException;
import com.workplace.messaging.exception.OwnershipTransferRequiredException;
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
import org.springframework.core.annotation.AnnotatedElementUtils;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.util.StringUtils;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.server.ResponseStatusException;
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

  /** 운영자 권한 없는 사용자가 플랫폼 평면 로그인/접근 시도 → 403(권한상승 차단). */
  @ExceptionHandler(com.workplace.platform.exception.PlatformAccessDeniedException.class)
  public ResponseEntity<ErrorResponse> handlePlatformAccessDenied(
      com.workplace.platform.exception.PlatformAccessDeniedException ex,
      HttpServletRequest request) {
    ErrorResponse response = buildError(HttpStatus.FORBIDDEN, ex.getMessage(), null, request);
    return ResponseEntity.status(HttpStatus.FORBIDDEN).body(response);
  }

  /** 운영자 콘솔에서 존재하지 않는 테넌트 id 조회/조작 → 404. */
  @ExceptionHandler(com.workplace.platform.exception.PlatformTenantNotFoundException.class)
  public ResponseEntity<ErrorResponse> handlePlatformTenantNotFound(
      com.workplace.platform.exception.PlatformTenantNotFoundException ex,
      HttpServletRequest request) {
    ErrorResponse response = buildError(HttpStatus.NOT_FOUND, ex.getMessage(), null, request);
    return ResponseEntity.status(HttpStatus.NOT_FOUND).body(response);
  }

  /** 비멤버/정지 테넌트 선택 시도 → 403. */
  @ExceptionHandler(TenantAccessDeniedException.class)
  public ResponseEntity<ErrorResponse> handleTenantAccessDenied(
      TenantAccessDeniedException ex, HttpServletRequest request) {
    ErrorResponse response = buildError(HttpStatus.FORBIDDEN, ex.getMessage(), null, request);
    return ResponseEntity.status(HttpStatus.FORBIDDEN).body(response);
  }

  /**
   * DB 무결성 위반 예외 처리.
   *
   * <p>OFFSET/LIMIT 음수 에러(페이지네이션 입력값 오류)는 클라이언트 잘못이므로 400으로 반환한다. 그 외
   * DataIntegrityViolationException은 409로 처리하되, raw DB 에러 메시지를 그대로 노출하지 않는다.
   */
  @ExceptionHandler(DataIntegrityViolationException.class)
  public ResponseEntity<ErrorResponse> handleDataIntegrityViolation(
      DataIntegrityViolationException ex, HttpServletRequest request) {
    String causeMsg = ex.getCause() != null ? ex.getCause().getMessage() : null;

    // 페이지네이션 음수 파라미터 → 입력값 오류(400)
    if (causeMsg != null
        && (causeMsg.contains("OFFSET must not be negative")
            || causeMsg.contains("LIMIT must not be negative"))) {
      ErrorResponse response =
          buildError(
              HttpStatus.BAD_REQUEST,
              "Invalid pagination parameter: value must not be negative",
              null,
              request);
      return ResponseEntity.badRequest().body(response);
    }

    String message = "Data integrity violation";
    if (causeMsg != null) {
      if (causeMsg.contains("duplicate key")) {
        message = "Data integrity violation: duplicate entry";
      } else if (causeMsg.contains("foreign key")) {
        message = "Data integrity violation: referenced record not found";
      } else if (causeMsg.contains("check constraint")) {
        message = "Data integrity violation: constraint check failed";
      }
      // 그 외 알 수 없는 케이스는 raw DB 메시지를 노출하지 않고 제네릭 메시지로 처리
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

  @ExceptionHandler(ChannelNotFoundException.class)
  public ResponseEntity<ErrorResponse> handleChannelNotFound(
      ChannelNotFoundException ex, HttpServletRequest request) {
    ErrorResponse response = buildError(HttpStatus.NOT_FOUND, ex.getMessage(), null, request);
    return ResponseEntity.status(HttpStatus.NOT_FOUND).body(response);
  }

  // 드라이브 도메인 — 미존재(404) / 권한미달(403) / 잘못된 입력(400)
  @ExceptionHandler({
    com.workplace.drive.exception.DriveSpaceNotFoundException.class,
    com.workplace.drive.exception.DriveFolderNotFoundException.class,
    com.workplace.drive.exception.DriveFileNotFoundException.class,
    com.workplace.drive.exception.DriveNotInTrashException.class
  })
  public ResponseEntity<ErrorResponse> handleDriveNotFound(
      RuntimeException ex, HttpServletRequest request) {
    ErrorResponse response = buildError(HttpStatus.NOT_FOUND, ex.getMessage(), null, request);
    return ResponseEntity.status(HttpStatus.NOT_FOUND).body(response);
  }

  @ExceptionHandler(com.workplace.drive.exception.DriveForbiddenException.class)
  public ResponseEntity<ErrorResponse> handleDriveForbidden(
      com.workplace.drive.exception.DriveForbiddenException ex, HttpServletRequest request) {
    ErrorResponse response = buildError(HttpStatus.FORBIDDEN, ex.getMessage(), null, request);
    return ResponseEntity.status(HttpStatus.FORBIDDEN).body(response);
  }

  @ExceptionHandler({
    com.workplace.drive.exception.DriveInvalidRoleException.class,
    com.workplace.drive.exception.DriveInvalidTargetException.class
  })
  public ResponseEntity<ErrorResponse> handleDriveBadRequest(
      RuntimeException ex, HttpServletRequest request) {
    ErrorResponse response = buildError(HttpStatus.BAD_REQUEST, ex.getMessage(), null, request);
    return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(response);
  }

  @ExceptionHandler(com.workplace.drive.exception.DriveShareLinkNotFoundException.class)
  public ResponseEntity<ErrorResponse> handleShareLinkNotFound(
      RuntimeException ex, HttpServletRequest request) {
    ErrorResponse response = buildError(HttpStatus.NOT_FOUND, ex.getMessage(), null, request);
    return ResponseEntity.status(HttpStatus.NOT_FOUND).body(response);
  }

  @ExceptionHandler(com.workplace.drive.exception.DriveShareLinkGoneException.class)
  public ResponseEntity<ErrorResponse> handleShareLinkGone(
      RuntimeException ex, HttpServletRequest request) {
    ErrorResponse response = buildError(HttpStatus.GONE, ex.getMessage(), null, request);
    return ResponseEntity.status(HttpStatus.GONE).body(response);
  }

  @ExceptionHandler(com.workplace.drive.exception.DriveShareLinkUnauthorizedException.class)
  public ResponseEntity<ErrorResponse> handleShareLinkUnauthorized(
      RuntimeException ex, HttpServletRequest request) {
    ErrorResponse response = buildError(HttpStatus.UNAUTHORIZED, ex.getMessage(), null, request);
    return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(response);
  }

  // 위키 도메인 — 미존재(404) / 권한미달(403) / 잘못된 입력(400) / 낙관적 충돌(409)
  @ExceptionHandler({
    com.workplace.wiki.exception.WikiSpaceNotFoundException.class,
    com.workplace.wiki.exception.WikiPageNotFoundException.class
  })
  public ResponseEntity<ErrorResponse> handleWikiNotFound(
      RuntimeException ex, HttpServletRequest request) {
    ErrorResponse response = buildError(HttpStatus.NOT_FOUND, ex.getMessage(), null, request);
    return ResponseEntity.status(HttpStatus.NOT_FOUND).body(response);
  }

  @ExceptionHandler(com.workplace.wiki.exception.WikiForbiddenException.class)
  public ResponseEntity<ErrorResponse> handleWikiForbidden(
      com.workplace.wiki.exception.WikiForbiddenException ex, HttpServletRequest request) {
    ErrorResponse response = buildError(HttpStatus.FORBIDDEN, ex.getMessage(), null, request);
    return ResponseEntity.status(HttpStatus.FORBIDDEN).body(response);
  }

  @ExceptionHandler(com.workplace.wiki.exception.WikiInvalidRoleException.class)
  public ResponseEntity<ErrorResponse> handleWikiBadRequest(
      com.workplace.wiki.exception.WikiInvalidRoleException ex, HttpServletRequest request) {
    ErrorResponse response = buildError(HttpStatus.BAD_REQUEST, ex.getMessage(), null, request);
    return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(response);
  }

  @ExceptionHandler(com.workplace.wiki.exception.WikiConflictException.class)
  public ResponseEntity<ErrorResponse> handleWikiConflict(
      com.workplace.wiki.exception.WikiConflictException ex, HttpServletRequest request) {
    ErrorResponse response = buildError(HttpStatus.CONFLICT, ex.getMessage(), null, request);
    return ResponseEntity.status(HttpStatus.CONFLICT).body(response);
  }

  // 연락처 도메인 — 미존재/격리(404)
  @ExceptionHandler(com.workplace.contacts.exception.ContactNotFoundException.class)
  public ResponseEntity<ErrorResponse> handleContactNotFound(
      com.workplace.contacts.exception.ContactNotFoundException ex, HttpServletRequest request) {
    ErrorResponse response = buildError(HttpStatus.NOT_FOUND, ex.getMessage(), null, request);
    return ResponseEntity.status(HttpStatus.NOT_FOUND).body(response);
  }

  @ExceptionHandler(com.workplace.contacts.exception.ContactForbiddenException.class)
  public ResponseEntity<ErrorResponse> handleContactForbidden(
      com.workplace.contacts.exception.ContactForbiddenException ex, HttpServletRequest request) {
    ErrorResponse response = buildError(HttpStatus.FORBIDDEN, ex.getMessage(), null, request);
    return ResponseEntity.status(HttpStatus.FORBIDDEN).body(response);
  }

  // 일정 도메인 — 미존재/비-owner(404)
  @ExceptionHandler(com.workplace.calendar.exception.CalendarEventNotFoundException.class)
  public ResponseEntity<ErrorResponse> handleCalendarEventNotFound(
      com.workplace.calendar.exception.CalendarEventNotFoundException ex,
      HttpServletRequest request) {
    ErrorResponse response = buildError(HttpStatus.NOT_FOUND, ex.getMessage(), null, request);
    return ResponseEntity.status(HttpStatus.NOT_FOUND).body(response);
  }

  // 사용자 그룹 도메인 — 미존재/격리(404)
  @ExceptionHandler(com.workplace.user.exception.UserGroupNotFoundException.class)
  public ResponseEntity<ErrorResponse> handleUserGroupNotFound(
      com.workplace.user.exception.UserGroupNotFoundException ex, HttpServletRequest request) {
    ErrorResponse response = buildError(HttpStatus.NOT_FOUND, ex.getMessage(), null, request);
    return ResponseEntity.status(HttpStatus.NOT_FOUND).body(response);
  }

  // 사용자 그룹 — SHARED 비권한자 쓰기(403)
  @ExceptionHandler(com.workplace.user.exception.UserGroupForbiddenException.class)
  public ResponseEntity<ErrorResponse> handleUserGroupForbidden(
      com.workplace.user.exception.UserGroupForbiddenException ex, HttpServletRequest request) {
    ErrorResponse response = buildError(HttpStatus.FORBIDDEN, ex.getMessage(), null, request);
    return ResponseEntity.status(HttpStatus.FORBIDDEN).body(response);
  }

  // 사용자 그룹 — 사이클·잘못된 멤버 대상(400)
  @ExceptionHandler(com.workplace.user.exception.InvalidUserGroupException.class)
  public ResponseEntity<ErrorResponse> handleInvalidUserGroup(
      com.workplace.user.exception.InvalidUserGroupException ex, HttpServletRequest request) {
    ErrorResponse response = buildError(HttpStatus.BAD_REQUEST, ex.getMessage(), null, request);
    return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(response);
  }

  // 이름 충돌(폴더 UNIQUE 제약 위반) / 저장 용량 초과 — 409
  @ExceptionHandler({
    com.workplace.drive.exception.DriveDuplicateNameException.class,
    com.workplace.drive.exception.DriveQuotaExceededException.class
  })
  public ResponseEntity<ErrorResponse> handleDriveConflict(
      RuntimeException ex, HttpServletRequest request) {
    ErrorResponse response = buildError(HttpStatus.CONFLICT, ex.getMessage(), null, request);
    return ResponseEntity.status(HttpStatus.CONFLICT).body(response);
  }

  @ExceptionHandler(ChannelNotMemberException.class)
  public ResponseEntity<ErrorResponse> handleChannelNotMember(
      ChannelNotMemberException ex, HttpServletRequest request) {
    ErrorResponse response = buildError(HttpStatus.FORBIDDEN, ex.getMessage(), null, request);
    return ResponseEntity.status(HttpStatus.FORBIDDEN).body(response);
  }

  @ExceptionHandler(ChannelForbiddenException.class)
  public ResponseEntity<ErrorResponse> handleChannelForbidden(
      ChannelForbiddenException ex, HttpServletRequest request) {
    ErrorResponse response = buildError(HttpStatus.FORBIDDEN, ex.getMessage(), null, request);
    return ResponseEntity.status(HttpStatus.FORBIDDEN).body(response);
  }

  /** 잘못된 DM 생성 요청 → 400. */
  @ExceptionHandler(InvalidDmRequestException.class)
  public ResponseEntity<ErrorResponse> handleInvalidDmRequest(
      InvalidDmRequestException ex, HttpServletRequest request) {
    ErrorResponse response = buildError(HttpStatus.BAD_REQUEST, ex.getMessage(), null, request);
    return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(response);
  }

  /** 스레드 부모 부적합 → 400. */
  @ExceptionHandler(InvalidThreadParentException.class)
  public ResponseEntity<ErrorResponse> handleInvalidThreadParent(
      InvalidThreadParentException ex, HttpServletRequest request) {
    ErrorResponse response = buildError(HttpStatus.BAD_REQUEST, ex.getMessage(), null, request);
    return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(response);
  }

  @ExceptionHandler({ChannelArchivedException.class, OwnershipTransferRequiredException.class})
  public ResponseEntity<ErrorResponse> handleChannelConflict(
      RuntimeException ex, HttpServletRequest request) {
    ErrorResponse response = buildError(HttpStatus.CONFLICT, ex.getMessage(), null, request);
    return ResponseEntity.status(HttpStatus.CONFLICT).body(response);
  }

  /** 메시지 첨부 파일 크기 한도 초과 — 400. */
  @ExceptionHandler(MessageAttachmentTooLargeException.class)
  public ResponseEntity<ErrorResponse> handleMessageAttachmentTooLarge(
      MessageAttachmentTooLargeException ex, HttpServletRequest request) {
    return ResponseEntity.badRequest()
        .body(buildError(HttpStatus.BAD_REQUEST, ex.getMessage(), null, request));
  }

  /** 메시지당 첨부 개수 한도 초과 — 409. */
  @ExceptionHandler(MessageAttachmentLimitExceededException.class)
  public ResponseEntity<ErrorResponse> handleMessageAttachmentLimitExceeded(
      MessageAttachmentLimitExceededException ex, HttpServletRequest request) {
    return ResponseEntity.status(HttpStatus.CONFLICT)
        .body(buildError(HttpStatus.CONFLICT, ex.getMessage(), null, request));
  }

  /** 바인딩 불가 첨부 파일(타 유저 소유/이미 바인딩됨/만료/없음) — 400. */
  @ExceptionHandler(InvalidMessageAttachmentException.class)
  public ResponseEntity<ErrorResponse> handleInvalidMessageAttachment(
      InvalidMessageAttachmentException ex, HttpServletRequest request) {
    return ResponseEntity.badRequest()
        .body(buildError(HttpStatus.BAD_REQUEST, ex.getMessage(), null, request));
  }

  // 본문도 첨부도 없는 빈 메시지 → 400
  @ExceptionHandler(EmptyMessageException.class)
  public ResponseEntity<ErrorResponse> handleEmptyMessage(
      EmptyMessageException ex, HttpServletRequest request) {
    return ResponseEntity.badRequest()
        .body(buildError(HttpStatus.BAD_REQUEST, ex.getMessage(), null, request));
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

  /** 사이클 없음 — 404. */
  @ExceptionHandler(CycleNotFoundException.class)
  public ResponseEntity<ErrorResponse> handleCycleNotFound(
      CycleNotFoundException ex, HttpServletRequest request) {
    return ResponseEntity.status(HttpStatus.NOT_FOUND)
        .body(buildError(HttpStatus.NOT_FOUND, ex.getMessage(), null, request));
  }

  /** 사이클 이름 중복 — 409. */
  @ExceptionHandler(CycleNameDuplicatedException.class)
  public ResponseEntity<ErrorResponse> handleCycleNameDuplicated(
      CycleNameDuplicatedException ex, HttpServletRequest request) {
    return ResponseEntity.status(HttpStatus.CONFLICT)
        .body(buildError(HttpStatus.CONFLICT, ex.getMessage(), null, request));
  }

  /** 허용되지 않은 사이클 상태 — 400. */
  @ExceptionHandler(InvalidCycleStatusException.class)
  public ResponseEntity<ErrorResponse> handleInvalidCycleStatus(
      InvalidCycleStatusException ex, HttpServletRequest request) {
    return ResponseEntity.badRequest()
        .body(buildError(HttpStatus.BAD_REQUEST, ex.getMessage(), null, request));
  }

  /** 이슈 프로젝트와 다른 사이클 연결 시도 — 400. */
  @ExceptionHandler(InvalidCycleForProjectException.class)
  public ResponseEntity<ErrorResponse> handleInvalidCycleForProject(
      InvalidCycleForProjectException ex, HttpServletRequest request) {
    return ResponseEntity.badRequest()
        .body(buildError(HttpStatus.BAD_REQUEST, ex.getMessage(), null, request));
  }

  /** 저장된 뷰 없음 — 404. */
  @ExceptionHandler(com.workplace.view.exception.SavedViewNotFoundException.class)
  public ResponseEntity<ErrorResponse> handleSavedViewNotFound(
      com.workplace.view.exception.SavedViewNotFoundException ex, HttpServletRequest request) {
    return ResponseEntity.status(HttpStatus.NOT_FOUND)
        .body(buildError(HttpStatus.NOT_FOUND, ex.getMessage(), null, request));
  }

  /** 저장된 뷰 이름 중복 — 409. */
  @ExceptionHandler(com.workplace.view.exception.SavedViewNameDuplicatedException.class)
  public ResponseEntity<ErrorResponse> handleSavedViewNameDuplicated(
      com.workplace.view.exception.SavedViewNameDuplicatedException ex,
      HttpServletRequest request) {
    return ResponseEntity.status(HttpStatus.CONFLICT)
        .body(buildError(HttpStatus.CONFLICT, ex.getMessage(), null, request));
  }

  /** 저장된 뷰 권한 없음 — 403. */
  @ExceptionHandler(com.workplace.view.exception.SavedViewAccessDeniedException.class)
  public ResponseEntity<ErrorResponse> handleSavedViewAccessDenied(
      com.workplace.view.exception.SavedViewAccessDeniedException ex, HttpServletRequest request) {
    return ResponseEntity.status(HttpStatus.FORBIDDEN)
        .body(buildError(HttpStatus.FORBIDDEN, ex.getMessage(), null, request));
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

  /** 개인 프로젝트 이슈에 TASK 가 아닌 유형 지정/변경 — 400. */
  @ExceptionHandler(com.workplace.issue.exception.PersonalProjectTypeFixedException.class)
  public ResponseEntity<ErrorResponse> handlePersonalProjectTypeFixed(
      com.workplace.issue.exception.PersonalProjectTypeFixedException ex,
      HttpServletRequest request) {
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

  /** messaging 메시지 id 미존재 → 404. */
  @ExceptionHandler(MessageNotFoundException.class)
  public ResponseEntity<ErrorResponse> handleMessageNotFound(
      MessageNotFoundException ex, HttpServletRequest request) {
    return ResponseEntity.status(HttpStatus.NOT_FOUND)
        .body(buildError(HttpStatus.NOT_FOUND, ex.getMessage(), null, request));
  }

  /** messaging — 본인이 아닌 메시지를 수정/삭제 시도 → 403. */
  @ExceptionHandler(MessageAuthorMismatchException.class)
  public ResponseEntity<ErrorResponse> handleMessageAuthorMismatch(
      MessageAuthorMismatchException ex, HttpServletRequest request) {
    return ResponseEntity.status(HttpStatus.FORBIDDEN)
        .body(buildError(HttpStatus.FORBIDDEN, ex.getMessage(), null, request));
  }

  /**
   * #50 — 홈 compose 불가(ai-agent 연동 비활성 또는 컴포저 AGENT 미설정) → 503 + 사유 메시지 노출. 캐치올(500)보다 우선 매칭되어
   * 사용자에게 명확·실행가능한 메시지를 전달한다.
   */
  @ExceptionHandler(HomeComposeUnavailableException.class)
  public ResponseEntity<ErrorResponse> handleHomeComposeUnavailable(
      HomeComposeUnavailableException ex, HttpServletRequest request) {
    return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
        .body(buildError(HttpStatus.SERVICE_UNAVAILABLE, ex.getMessage(), null, request));
  }

  /** #50 — 개인·공용 비서가 모두 미설정 → 503 + 사유 메시지. 캐치올(500)보다 우선 매칭되어 사용자에게 설정 필요를 알린다. */
  @ExceptionHandler(com.workplace.auth.exception.HomeAssistantNotConfiguredException.class)
  public ResponseEntity<ErrorResponse> handleHomeAssistantNotConfigured(
      com.workplace.auth.exception.HomeAssistantNotConfiguredException ex,
      HttpServletRequest request) {
    return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
        .body(buildError(HttpStatus.SERVICE_UNAVAILABLE, ex.getMessage(), null, request));
  }

  /** #50 — ai-agent compose 게이트웨이 오류 → 502 + 사유 메시지 노출(캐치올 500 으로 뭉개지지 않도록). */
  @ExceptionHandler(AiAgentComposeException.class)
  public ResponseEntity<ErrorResponse> handleAiAgentCompose(
      AiAgentComposeException ex, HttpServletRequest request) {
    return ResponseEntity.status(HttpStatus.BAD_GATEWAY)
        .body(buildError(HttpStatus.BAD_GATEWAY, ex.getMessage(), null, request));
  }

  /**
   * 위키 인에디터 /ai 전용 executor(wikiAiStreamExecutor) 의 큐가 가득 찼을 때(동시 스트림 과다) AbortPolicy 가 던지는
   * TaskRejectedException → 503. 캐치올 500 으로 뭉개지지 않고 사용자에게 '잠시 후 재시도' 를 안내한다.
   */
  @ExceptionHandler(org.springframework.core.task.TaskRejectedException.class)
  public ResponseEntity<ErrorResponse> handleTaskRejected(
      org.springframework.core.task.TaskRejectedException ex, HttpServletRequest request) {
    log.warn("AI 스트림 executor 포화 — 요청 거부: {}", ex.getMessage());
    return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
        .body(
            buildError(
                HttpStatus.SERVICE_UNAVAILABLE, "AI 생성 요청이 많아요. 잠시 후 다시 시도해주세요.", null, request));
  }

  @ExceptionHandler(Exception.class)
  public ResponseEntity<ErrorResponse> handleException(Exception ex, HttpServletRequest request) {
    // SSE/async 스트림에 쓰던 중 클라이언트가 끊긴 경우(Broken pipe 등)는 정상 흐름이다.
    // 응답 content-type 이 이미 text/event-stream 이라 ErrorResponse(JSON) 직렬화도 불가하므로
    // (HttpMessageNotWritableException 유발), ERROR 로그·직렬화를 시도하지 않고 조용히 무시한다.
    if (isClientDisconnect(ex)) {
      log.debug("클라이언트 연결 종료로 응답 쓰기 불가 — 무시: {}", ex.toString());
      return null;
    }
    // #119 — catch-all 이 @ResponseStatus / ResponseStatusException 의 의도된 상태를 500 으로 덮지 않도록,
    // 선언된 상태가 있으면 그 상태로 응답한다. (Spring 의 ResponseStatusExceptionResolver 는 이 catch-all 매칭에
    // 가려 동작하지 못한다.) 정말 미선언인 예외만 500 으로 처리.
    ResponseEntity<ErrorResponse> declared = handleDeclaredStatus(ex, request);
    if (declared != null) {
      return declared;
    }
    log.error("Unhandled exception", ex);
    ErrorResponse response =
        buildError(HttpStatus.INTERNAL_SERVER_ERROR, "An unexpected error occurred", null, request);
    return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(response);
  }

  /**
   * 예외에 선언된 HTTP 상태(@ResponseStatus 또는 ResponseStatusException)를 추출하여 그 상태로 응답한다. 선언이 없으면 {@code
   * null} 을 반환해 호출부가 500 으로 처리하도록 한다.
   *
   * <p>로그 레벨: 4xx(클라이언트 오류)는 debug, 5xx(상위/서버 오류)는 warn — catch-all 의 {@code log.error(..., ex)} 풀
   * 스택트레이스 노이즈(#107 와 동일 뿌리)를 선언된 예외에는 남기지 않는다.
   */
  private ResponseEntity<ErrorResponse> handleDeclaredStatus(
      Exception ex, HttpServletRequest request) {
    HttpStatusCode statusCode = null;
    String message = ex.getMessage();
    if (ex instanceof ResponseStatusException rse) {
      statusCode = rse.getStatusCode();
      if (StringUtils.hasText(rse.getReason())) {
        message = rse.getReason();
      }
    } else {
      ResponseStatus rs =
          AnnotatedElementUtils.findMergedAnnotation(ex.getClass(), ResponseStatus.class);
      if (rs != null) {
        statusCode = rs.code();
        if (StringUtils.hasText(rs.reason())) {
          message = rs.reason();
        }
      }
    }
    if (statusCode == null) {
      return null;
    }
    if (statusCode.is5xxServerError()) {
      log.warn("선언된 상태({})로 응답: {}", statusCode.value(), ex.toString());
    } else {
      log.debug("선언된 상태({})로 응답: {}", statusCode.value(), ex.toString());
    }
    HttpStatus status = HttpStatus.resolve(statusCode.value());
    ErrorResponse body =
        buildError(
            status != null ? status : HttpStatus.INTERNAL_SERVER_ERROR, message, null, request);
    return ResponseEntity.status(statusCode).body(body);
  }

  /**
   * 클라이언트 연결 종료로 인한 예외인지 원인 체인을 따라 판정한다. Broken pipe / Connection reset(소켓 강제 종료) 또는 Tomcat
   * ClientAbortException / Spring AsyncRequestNotUsableException(둘 다 클래스명으로 식별 — 하드 의존 회피)을 포함하면
   * true.
   */
  private static boolean isClientDisconnect(Throwable ex) {
    Throwable t = ex;
    for (int depth = 0; t != null && depth < 10; t = t.getCause(), depth++) {
      String name = t.getClass().getSimpleName();
      if ("ClientAbortException".equals(name) || "AsyncRequestNotUsableException".equals(name)) {
        return true;
      }
      String msg = t.getMessage();
      if (msg != null) {
        String lower = msg.toLowerCase(java.util.Locale.ROOT);
        if (lower.contains("broken pipe") || lower.contains("connection reset")) {
          return true;
        }
      }
      if (t.getCause() == t) {
        break; // 자기참조 원인 방어
      }
    }
    return false;
  }
}
