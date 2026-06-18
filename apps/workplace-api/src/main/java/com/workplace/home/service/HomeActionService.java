package com.workplace.home.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.workplace.calendar.dto.CalendarEventRequest;
import com.workplace.calendar.dto.EditScope;
import com.workplace.calendar.service.CalendarEventService;
import com.workplace.contacts.service.ContactService;
import com.workplace.drive.service.DriveFileService;
import com.workplace.drive.service.DriveFolderService;
import com.workplace.global.security.PermissionChecker;
import com.workplace.mail.dto.MailSendRequest;
import com.workplace.mail.service.MailComposeService;
import com.workplace.project.dto.AddMemberRequest;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.service.ProjectService;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validator;
import java.time.OffsetDateTime;
import java.util.Map;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;

/**
 * 확인 플로우 서버 실행기(B2/#333 M2). 도크 확인 카드 승인 시 actionType 으로 도메인 액션을 결정적으로 실행한다.
 *
 * <p>핵심 안전 원칙: 실행은 항상 인증된 호출자(callerId=principal, 에이전트 아님) 권한·owner 경계 안에서만. (1) actionType→필요권한
 * 맵으로 프로그램적 권한 검사(@RequirePermission 인터셉터가 동적 actionType 을 못 거므로), (2) params(JsonNode)→DTO
 * 매핑은 @Valid 바인딩 밖이라 Validator 로 명시 검증, (3) 도메인 서비스 호출.
 *
 * <p>도메인 간 직접 호출(home→calendar)은 의도적 — 이벤트로는 생성 결과를 동기 반환할 수 없다. M3 에서 디스패처가 mail/contacts 등 도메인
 * 서비스를 누적한다.
 *
 * <p>anti-tamper 토큰: 현재 사용자 권한 경계로 보호(제안이 사용자 권한을 벗어날 수 없음). M3+ 에서 서명 토큰 추가 예정.
 */
@Service
@RequiredArgsConstructor
public class HomeActionService {

  private final CalendarEventService calendarEventService;
  private final MailComposeService mailComposeService; // #333 M3 추가
  private final ContactService contactService; // #333 M3 추가
  private final ProjectService projectService; // #333 M3
  private final DriveFileService driveFileService; // #333 M4 추가
  private final DriveFolderService driveFolderService; // #333 M4 추가
  private final PermissionChecker permissionChecker;
  private final Validator validator;
  private final ObjectMapper objectMapper;

  /**
   * actionType → 필요 권한 코드.
   *
   * <ul>
   *   <li>맵에 키 없음(null) = 미지원 actionType → 400.
   *   <li>빈 문자열("") = 지원하지만 RBAC 게이트 없음 — 도메인 서비스 내 소유권 경계가 인가를 담당.
   *   <li>비어있지 않은 문자열 = 해당 권한 코드 필요 → PermissionChecker 검사.
   * </ul>
   *
   * Map.of 는 null 값에 NPE 를 던지므로, 미지원은 맵 부재(null)로만 표현한다. 절대 null 값 사용 금지.
   */
  private static final Map<String, String> REQUIRED_PERMISSION =
      Map.ofEntries(
          Map.entry("calendar.create_event", "calendar:write"),
          Map.entry(
              "mail.send",
              ""), // 계정-소유권 경계 — RBAC 권한 없음(MailComposeService.send 가 findByIdAndUser 로 소유 검증)
          Map.entry(
              "contacts.delete_contact",
              "contact:write"), // 실재 시드 코드 — owner/ADMIN 경계는 ContactService 가 추가 강제
          Map.entry("project.create_project", "project:write"), // #333 M3 — 프로젝트 생성
          Map.entry("project.delete_project", "project:manage"), // #333 M3 — 소프트삭제(OWNER 경계 추가 강제)
          Map.entry("project.add_member", "project:manage"), // #333 M3 — 멤버 추가(OWNER 경계 추가 강제)
          Map.entry("calendar.update_event", "calendar:write"), // #333 M4 — 일정 수정
          Map.entry("calendar.delete_event", "calendar:write"), // #333 M4 — 일정 삭제
          Map.entry(
              "drive.delete_file", ""), // 드라이브는 글로벌 RBAC 권한 없음 — space role(EDITOR) 경계를 서비스가 강제
          Map.entry(
              "drive.delete_folder", "")); // 드라이브는 글로벌 RBAC 권한 없음 — space role(EDITOR) 경계를 서비스가 강제

  /**
   * 확인 카드 승인 실행 — 지원 여부 확인 → 권한 검사(필요 시) → 매핑·검증 → 도메인 실행. 결과 객체 반환(컨트롤러가 201).
   *
   * <p>지원 여부(맵 부재→400)와 권한 필요 여부(빈 문자열 sentinel→스킵)를 분리 검사한다.
   */
  public Object confirm(long callerId, String actionType, JsonNode params) {
    String required = REQUIRED_PERMISSION.get(actionType);
    if (required == null) {
      // 맵에 없는 actionType = 미지원 → 400.
      throw new IllegalArgumentException("지원하지 않는 actionType: " + actionType);
    }
    // 빈 문자열 sentinel = 지원하지만 RBAC 게이트 없음(도메인 소유권이 인가). 비어있지 않을 때만 검사.
    if (!required.isEmpty() && !permissionChecker.hasPermission(callerId, required)) {
      // 권한 우회 방지 — 인터셉터 대신 프로그램적 검사.
      throw new AccessDeniedException("필요 권한 없음: " + required);
    }
    if ("calendar.create_event".equals(actionType)) {
      CalendarEventRequest req = mapAndValidate(params, CalendarEventRequest.class);
      return calendarEventService.create(callerId, req);
    }
    if ("mail.send".equals(actionType)) {
      return dispatchMailSend(callerId, params);
    }
    if ("contacts.delete_contact".equals(actionType)) {
      // params 에서 id(연락처 PK) 추출 → ContactService.delete 로 소유자/ADMIN 경계 위임.
      if (params == null || !params.hasNonNull("id")) {
        throw new IllegalArgumentException("contacts.delete_contact 에 id 가 필요합니다");
      }
      long id = params.get("id").asLong();
      contactService.delete(callerId, id);
      return Map.of("deleted", id);
    }
    if ("project.create_project".equals(actionType)) {
      // params → CreateProjectRequest 매핑·검증 후 ProjectService.create 로 위임.
      // 호출자가 OWNER 로 자동 등록되므로 callerId=principal 전달.
      CreateProjectRequest req = mapAndValidate(params, CreateProjectRequest.class);
      return projectService.create(callerId, req);
    }
    if ("project.delete_project".equals(actionType)) {
      // params 에서 key 추출 → ProjectService.softDelete(OWNER 경계는 서비스 내부 강제).
      String key = requireText(params, "key");
      projectService.softDelete(callerId, key);
      return Map.of("deleted", key);
    }
    if ("project.add_member".equals(actionType)) {
      // params 에서 key 를 별도 추출 후 AddMemberRequest(userId, role)로 매핑.
      // key 는 AddMemberRequest 에 없는 필드이므로 unknown-properties 오류 방지를 위해 제거 후 변환.
      String key = requireText(params, "key");
      ObjectNode paramsWithoutKey = ((ObjectNode) params.deepCopy());
      paramsWithoutKey.remove("key");
      AddMemberRequest req = mapAndValidate(paramsWithoutKey, AddMemberRequest.class);
      return projectService.addMember(callerId, key, req);
    }
    if ("calendar.update_event".equals(actionType)) {
      // id/scope/occurrenceDate 는 CalendarEventRequest 밖 파라미터 → 분리 추출 후 본문만 매핑(unknown-property
      // 방지).
      long id = requireLong(params, "id");
      EditScope scope = parseScope(params); // 기본 ALL
      OffsetDateTime occ = parseOffsetDateTime(params, "occurrenceDate"); // 없으면 null
      ObjectNode body = (ObjectNode) params.deepCopy();
      body.remove("id");
      body.remove("scope");
      body.remove("occurrenceDate");
      CalendarEventRequest req = mapAndValidate(body, CalendarEventRequest.class);
      return calendarEventService.update(callerId, id, req, scope, occ);
    }
    if ("calendar.delete_event".equals(actionType)) {
      // id/scope/occurrenceDate 추출 후 CalendarEventService.delete 위임. 서비스가 requireOwner 강제.
      long id = requireLong(params, "id");
      EditScope scope = parseScope(params);
      OffsetDateTime occ = parseOffsetDateTime(params, "occurrenceDate");
      calendarEventService.delete(callerId, id, scope, occ);
      return Map.of("deleted", id);
    }
    if ("drive.delete_file".equals(actionType)) {
      // id(드라이브 파일 PK) 추출 → DriveFileService.delete 로 space EDITOR 경계 위임(soft-delete=휴지통).
      long id = requireLong(params, "id");
      driveFileService.delete(callerId, id);
      return Map.of("deleted", id);
    }
    if ("drive.delete_folder".equals(actionType)) {
      // id(드라이브 폴더 PK) 추출 → DriveFolderService.delete 로 space EDITOR 경계 위임(soft-delete=휴지통).
      long id = requireLong(params, "id");
      driveFolderService.delete(callerId, id);
      return Map.of("deleted", id);
    }
    throw new IllegalArgumentException("지원하지 않는 actionType: " + actionType);
  }

  /**
   * mail.send 디스패치: params 에서 accountId 를 분리 추출 후 MailSendRequest 로 매핑해 발송.
   *
   * <p>accountId 는 MailSendRequest 레코드 외부 파라미터(경로 변수 상당)이므로 params 에서 별도 추출한다. convertValue 전에
   * accountId 필드를 제거해 unknownProperty 오류를 방지한다. 계정-소유권 검증은 MailComposeService.send
   * 내부(findByIdAndUser)에서 수행 — 호출자 소유 계정만 허용.
   */
  private Object dispatchMailSend(long callerId, JsonNode params) {
    if (params == null || !params.hasNonNull("accountId")) {
      throw new IllegalArgumentException("mail.send 에 accountId 가 필요합니다");
    }
    long accountId = params.get("accountId").asLong();
    // accountId 를 제거한 복사본으로 MailSendRequest 매핑(레코드에 없는 필드 → unknown-property 오류 방지).
    ObjectNode paramsWithoutAccountId = (ObjectNode) params.deepCopy();
    paramsWithoutAccountId.remove("accountId");
    MailSendRequest req = mapAndValidate(paramsWithoutAccountId, MailSendRequest.class);
    return mailComposeService.send(callerId, accountId, req);
  }

  /**
   * params 에서 필수 텍스트 필드를 추출한다. null/비어있으면 IllegalArgumentException.
   *
   * <p>경로 변수 상당의 필드(key 등)를 params 에서 별도 추출할 때 사용.
   */
  private String requireText(JsonNode params, String field) {
    if (params == null || !params.hasNonNull(field) || params.get(field).asText().isBlank()) {
      throw new IllegalArgumentException("필수 파라미터 누락: " + field);
    }
    return params.get(field).asText();
  }

  /**
   * params 에서 필수 Long 필드를 추출한다. null/비어있으면 IllegalArgumentException.
   *
   * <p>id 같은 숫자 식별자를 params 에서 별도 추출할 때 사용.
   */
  private long requireLong(JsonNode params, String field) {
    if (params == null || !params.hasNonNull(field)) {
      throw new IllegalArgumentException("필수 파라미터 누락: " + field);
    }
    return params.get(field).asLong();
  }

  /**
   * params 에서 scope 필드를 EditScope 로 변환. 없으면 EditScope.ALL 반환.
   *
   * <p>반복 일정 수정/삭제 범위. 단일 일정에는 ALL(기본값)을 사용한다.
   */
  private EditScope parseScope(JsonNode params) {
    if (params == null || !params.hasNonNull("scope")) return EditScope.ALL;
    return EditScope.valueOf(params.get("scope").asText());
  }

  /**
   * params 에서 ISO-8601 OffsetDateTime 필드를 파싱. 없으면 null 반환.
   *
   * <p>반복 일정에서 특정 발생일(occurrenceDate)을 지정할 때 사용. 단일 일정이면 null 전달.
   */
  private OffsetDateTime parseOffsetDateTime(JsonNode params, String field) {
    if (params == null || !params.hasNonNull(field)) return null;
    return OffsetDateTime.parse(params.get(field).asText());
  }

  /** JsonNode→DTO 변환 후 bean-validation 명시 수행(@Valid 바인딩 밖이라 자동 발동 안 함). */
  private <T> T mapAndValidate(JsonNode params, Class<T> type) {
    T dto = objectMapper.convertValue(params, type);
    Set<ConstraintViolation<T>> violations = validator.validate(dto);
    if (!violations.isEmpty()) {
      throw new IllegalArgumentException(
          "잘못된 params: " + violations.iterator().next().getMessage());
    }
    return dto;
  }
}
