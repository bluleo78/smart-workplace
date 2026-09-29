package com.workplace.action;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonMappingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.exc.UnrecognizedPropertyException;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.workplace.calendar.dto.CalendarEventRequest;
import com.workplace.calendar.dto.EditScope;
import com.workplace.calendar.dto.InviteAttendeesRequest;
import com.workplace.calendar.service.CalendarEventService;
import com.workplace.contacts.service.ContactService;
import com.workplace.drive.service.DriveFileService;
import com.workplace.drive.service.DriveFolderService;
import com.workplace.global.security.PermissionChecker;
import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.service.IssueCommentService;
import com.workplace.issue.service.IssueService;
import com.workplace.mail.dto.MailSendRequest;
import com.workplace.mail.service.MailComposeService;
import com.workplace.messaging.service.ChannelMemberService;
import com.workplace.project.dto.AddMemberRequest;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.UpdateMemberRoleRequest;
import com.workplace.project.service.ProjectService;
import com.workplace.user.dto.SetRolesByNamesRequest;
import com.workplace.user.service.UserGroupService;
import com.workplace.user.service.UserService;
import com.workplace.wiki.service.WikiPageService;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validator;
import java.io.IOException;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Supplier;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;

/**
 * 확인 카드 actionType 디스패처(중립 패키지). 도크/채팅 확인 카드 승인 시 actionType 으로 도메인 액션을 결정적으로 실행한다. 공용 실행기 —
 * home(HomeProposalService)·messaging(채팅 L3) 두 경로가 같은 생성 로직을 공유한다(포크 방지).
 *
 * <p>안전 원칙은 기존과 동일: 호출자(callerId) 권한·owner 경계 안에서만 실행. (1) actionType→필요권한 맵으로 프로그램적 권한 검사, (2)
 * params→DTO 매핑·검증, (3) 도메인 선검증, (4) 도메인 서비스 호출.
 *
 * <p>#842: {@code prepare} 가 (1)(2) 를 수행하고 (3) 도메인 검증·(4) 실행을 한 쌍으로 돌려준다. 사전검증(validate)은 (3) 까지만,
 * 승인(confirm)은 (4) 만 돌린다 — (4) 의 도메인 메서드가 (3) 과 같은 술어를 내장하므로 카드 생성 전에 승인 시점과 같은 실패를 재현하면서도 승인 시 검증이
 * 중복되지 않는다.
 */
@Service
@RequiredArgsConstructor
public class ConfirmActionDispatcher {

  private final CalendarEventService calendarEventService;
  private final MailComposeService mailComposeService; // #333 M3 추가
  private final ContactService contactService; // #333 M3 추가
  private final ProjectService projectService; // #333 M3
  private final DriveFileService driveFileService; // #333 M4 추가
  private final DriveFolderService driveFolderService; // #333 M4 추가
  private final IssueService issueService; // #540 노트→이슈
  private final UserService userService; // #833 구성원 역할/활성 변경
  private final IssueCommentService commentService; // #856 코멘트 삭제
  private final ChannelMemberService channelMemberService; // #856 채널 멤버 초대
  private final WikiPageService wikiPageService; // #856 노트 페이지 삭제
  private final UserGroupService userGroupService; // #839 사용자 그룹 삭제
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
              "drive.delete_folder", ""), // 드라이브는 글로벌 RBAC 권한 없음 — space role(EDITOR) 경계를 서비스가 강제
          Map.entry(
              "issue.create",
              ""), // #540 — 멤버십+RLS 로 가드(IssueService.create 내 assertMember), 전역 RBAC 없음
          Map.entry("user.set_roles", "role:assign"), // #833 — 구성원 역할 변경(UserController 와 동일 권한)
          Map.entry("user.set_active", "user:write"), // #833 — 구성원 활성/비활성
          // #856 — 파괴적이거나 다른 사람에게 영향이 나가는 작업. 권한 코드는 같은 작업의 REST 컨트롤러와 맞춘다.
          Map.entry("calendar.add_attendees", "calendar:write"), // 주최자(owner) 경계는 서비스가 강제
          Map.entry("calendar.remove_attendee", "calendar:write"),
          Map.entry("project.update_member_role", "project:manage"), // OWNER 경계 추가 강제
          Map.entry("project.remove_member", "project:manage"),
          Map.entry("messaging.add_channel_member", ""), // 채널 역할(OWNER/ADMIN) 경계를 서비스가 강제
          Map.entry("messaging.leave_channel", ""), // 본인 나가기 — OWNER 이양 필요 경계를 서비스가 강제(#860)
          Map.entry("issue.delete", "issue:write"), // reporter·OWNER·ADMIN 경계는 서비스가 강제
          Map.entry("issue.delete_comment", "issue:write"), // 작성자·OWNER 경계는 서비스가 강제
          Map.entry("wiki.delete_page", ""), // 공간 역할(EDITOR) 경계를 서비스가 강제
          // #839 — UserGroupController 와 같은 contact:read. SHARED=user-group:manage / PERSONAL=소유자
          // 경계는 서비스가 강제.
          Map.entry("contacts.delete_user_group", "contact:read"));

  /**
   * 확인 카드 승인 실행 — 준비(prepare) 후 실행(execute).
   *
   * <p>#842: 도메인 검증(check)은 실행하지 않는다 — 도메인 실행 메서드가 같은 술어를 내장하고 있어 두 번 돌리면 조회만 중복된다. 사전검증과 실행이 같은
   * 술어를 쓴다는 보장은 도메인 서비스가 validate* 와 실행 메서드에서 한 벌의 check 를 공유하는 데서 나온다.
   */
  public Object confirm(long callerId, String actionType, JsonNode params) {
    return prepare(callerId, actionType, params).execute().get();
  }

  /**
   * 확인 카드 사전검증(dry-run) — 카드 생성 전에 승인 시점과 같은 권한·매핑·도메인 검증만 수행하고 실행하지 않는다(#842).
   *
   * <p>실패는 confirm 과 동일한 예외로 던져 GlobalExceptionHandler 가 사유를 ErrorResponse 에 담고, AI 는 그 문구로 자가교정한다.
   */
  public void validate(long callerId, String actionType, JsonNode params) {
    prepare(callerId, actionType, params).check().run();
  }

  /**
   * 준비 단계 — 지원 여부 확인 → 권한 검사(필요 시) → 매핑·검증 → 도메인 선검증. 실행은 하지 않고 실행 함수만 담아 반환한다.
   *
   * <p>지원 여부(맵 부재→400)와 권한 필요 여부(빈 문자열 sentinel→스킵)를 분리 검사한다.
   */
  private PreparedAction prepare(long callerId, String actionType, JsonNode params) {
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
      // conflicts 는 확인 카드 표시용(제안 시점 충돌 목록) — 생성 입력이 아니므로 엄격 매핑 전에 뗀다(#852).
      ObjectNode body =
          params != null && params.isObject() ? ((ObjectNode) params.deepCopy()) : null;
      if (body != null) body.remove("conflicts");
      CalendarEventRequest req = mapAndValidate(body, CalendarEventRequest.class);
      return new PreparedAction(
          () -> calendarEventService.validateCreatable(callerId, req),
          () -> calendarEventService.create(callerId, req));
    }
    if ("mail.send".equals(actionType)) {
      return prepareMailSend(callerId, params);
    }
    if ("contacts.delete_contact".equals(actionType)) {
      requireOnly(params, "id"); // #856: 모르는 필드를 조용히 버리지 않는다(#852)
      // params 에서 id(연락처 PK) 추출 → ContactService.delete 로 소유자/ADMIN 경계 위임.
      long id = requireLong(params, "id");
      return new PreparedAction(
          () -> contactService.validateDeletable(callerId, id),
          deleted(id, () -> contactService.delete(callerId, id)));
    }
    if ("user.set_roles".equals(actionType)) {
      // #833: 구성원 역할 변경. 에이전트는 roleId 를 모르고 role:read 권한도 없으므로 역할명을 받아
      // 서버(=사람 권한으로 실행되는 이 실행기)에서 해석한다. 테넌트 멤버 검증·자기잠금 방지는 UserService 가 강제.
      SetRolesByNamesRequest req = mapAndValidate(params, SetRolesByNamesRequest.class);
      return new PreparedAction(
          () -> userService.validateSetRolesByNames(req.userId(), req.roles(), callerId),
          () -> {
            userService.setUserRolesByNames(req.userId(), req.roles(), callerId);
            return Map.of("userId", req.userId(), "roles", req.roles());
          });
    }
    if ("user.set_active".equals(actionType)) {
      // #833: 구성원 활성/비활성. 마지막 ADMIN 비활성화 차단·테넌트 멤버 검증은 UserService 가 강제.
      long userId = requireLong(params, "userId");
      boolean active = requireBoolean(params, "active");
      return new PreparedAction(
          () -> userService.validateSetActive(userId, active),
          returning(
              Map.of("userId", userId, "active", active),
              () -> userService.setUserActive(userId, active)));
    }
    if ("project.create_project".equals(actionType)) {
      // params → CreateProjectRequest 매핑·검증 후 ProjectService.create 로 위임.
      // 호출자가 OWNER 로 자동 등록되므로 callerId=principal 전달.
      CreateProjectRequest req = mapAndValidate(params, CreateProjectRequest.class);
      return new PreparedAction(
          () -> projectService.validateCreatable(req), () -> projectService.create(callerId, req));
    }
    if ("project.delete_project".equals(actionType)) {
      requireOnly(params, "key"); // #856: 모르는 필드를 조용히 버리지 않는다(#852)
      // params 에서 key 추출 → ProjectService.softDelete(OWNER 경계는 서비스 내부 강제).
      String key = requireText(params, "key");
      return new PreparedAction(
          () -> projectService.validateDeletable(callerId, key),
          deleted(key, () -> projectService.softDelete(callerId, key)));
    }
    if ("project.add_member".equals(actionType)) {
      // params 에서 key 를 별도 추출 후 AddMemberRequest(userId, role)로 매핑.
      // key 는 AddMemberRequest 에 없는 필드이므로 unknown-properties 오류 방지를 위해 제거 후 변환.
      String key = requireText(params, "key");
      ObjectNode paramsWithoutKey = ((ObjectNode) params.deepCopy());
      paramsWithoutKey.remove("key");
      AddMemberRequest req = mapAndValidate(paramsWithoutKey, AddMemberRequest.class);
      return new PreparedAction(
          () -> projectService.validateAddMember(callerId, key, req),
          () -> projectService.addMember(callerId, key, req));
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
      return new PreparedAction(
          () -> calendarEventService.validateUpdatable(callerId, id, req, scope, occ),
          () -> calendarEventService.update(callerId, id, req, scope, occ));
    }
    if ("calendar.delete_event".equals(actionType)) {
      requireOnly(params, "id", "scope", "occurrenceDate"); // #856: 모르는 필드를 조용히 버리지 않는다(#852)
      // id/scope/occurrenceDate 추출 후 CalendarEventService.delete 위임. 서비스가 requireOwner 강제.
      long id = requireLong(params, "id");
      EditScope scope = parseScope(params);
      OffsetDateTime occ = parseOffsetDateTime(params, "occurrenceDate");
      return new PreparedAction(
          () -> calendarEventService.validateDeletable(callerId, id, scope, occ),
          deleted(id, () -> calendarEventService.delete(callerId, id, scope, occ)));
    }
    if ("drive.delete_file".equals(actionType)) {
      requireOnly(params, "id"); // #856: 모르는 필드를 조용히 버리지 않는다(#852)
      // id(드라이브 파일 PK) 추출 → DriveFileService.delete 로 space EDITOR 경계 위임(soft-delete=휴지통).
      long id = requireLong(params, "id");
      return new PreparedAction(
          () -> driveFileService.validateDeletable(callerId, id),
          deleted(id, () -> driveFileService.delete(callerId, id)));
    }
    if ("drive.delete_folder".equals(actionType)) {
      requireOnly(params, "id"); // #856: 모르는 필드를 조용히 버리지 않는다(#852)
      // id(드라이브 폴더 PK) 추출 → DriveFolderService.delete 로 space EDITOR 경계 위임(soft-delete=휴지통).
      long id = requireLong(params, "id");
      return new PreparedAction(
          () -> driveFolderService.validateDeletable(callerId, id),
          deleted(id, () -> driveFolderService.delete(callerId, id)));
    }
    if ("issue.create".equals(actionType)) {
      // projectKey 는 IssueService.create 의 경로변수성 인자 — 별도 추출 후 나머지를 CreateIssueRequest 로 매핑.
      // project.add_member 의 "키 분리+나머지 매핑" 패턴과 동형(unknown-property 오류 방지).
      String projectKey = requireText(params, "projectKey");
      ObjectNode paramsWithoutKey = ((ObjectNode) params.deepCopy());
      paramsWithoutKey.remove("projectKey");
      CreateIssueRequest req = mapAndValidate(paramsWithoutKey, CreateIssueRequest.class);
      return new PreparedAction(
          () -> issueService.validateCreatable(callerId, projectKey, req),
          () -> issueService.create(callerId, projectKey, req));
    }
    PreparedAction extra = prepareMemberAndDeleteActions(callerId, actionType, params);
    if (extra != null) return extra;
    throw new IllegalArgumentException("지원하지 않는 actionType: " + actionType);
  }

  /**
   * #856 확인 카드 액션 — 참석자·프로젝트 멤버·채널 초대·이슈/코멘트/노트 삭제. 모두 식별자만 받으므로 DTO 매핑 대신 허용 필드를 명시해(#852 교훈) 모르는
   * 필드가 조용히 버려지지 않게 한다. 해당 없는 actionType 이면 null.
   */
  private PreparedAction prepareMemberAndDeleteActions(
      long callerId, String actionType, JsonNode params) {
    switch (actionType) {
      case "calendar.add_attendees" -> {
        long id = requireLong(params, "id");
        ObjectNode body = (ObjectNode) params.deepCopy();
        body.remove("id");
        List<Long> userIds = mapAndValidate(body, InviteAttendeesRequest.class).userIds();
        return new PreparedAction(
            () -> calendarEventService.validateAttendeesAddable(callerId, id, userIds),
            returning(
                Map.of("id", id),
                () -> calendarEventService.inviteAttendees(callerId, id, userIds)));
      }
      case "calendar.remove_attendee" -> {
        requireOnly(params, "id", "userId");
        long id = requireLong(params, "id");
        long userId = requireLong(params, "userId");
        return new PreparedAction(
            () -> calendarEventService.validateAttendeeRemovable(callerId, id, userId),
            returning(
                Map.of("id", id), () -> calendarEventService.removeAttendee(callerId, id, userId)));
      }
      case "project.update_member_role" -> {
        requireOnly(params, "key", "userId", "role");
        String key = requireText(params, "key");
        long userId = requireLong(params, "userId");
        UpdateMemberRoleRequest req =
            mapAndValidate(
                objectMapper.createObjectNode().set("role", params.get("role")),
                UpdateMemberRoleRequest.class);
        return new PreparedAction(
            () -> projectService.validateUpdateMemberRole(callerId, key, userId, req),
            returning(
                Map.of("key", key),
                () -> projectService.updateMemberRole(callerId, key, userId, req)));
      }
      case "project.remove_member" -> {
        requireOnly(params, "key", "userId");
        String key = requireText(params, "key");
        long userId = requireLong(params, "userId");
        return new PreparedAction(
            () -> projectService.validateRemoveMember(callerId, key, userId),
            returning(
                Map.of("key", key), () -> projectService.removeMember(callerId, key, userId)));
      }
      case "messaging.add_channel_member" -> {
        requireOnly(params, "id", "userId");
        long id = requireLong(params, "id");
        long userId = requireLong(params, "userId");
        return new PreparedAction(
            () -> channelMemberService.validateAdd(callerId, id, userId),
            returning(Map.of("id", id), () -> channelMemberService.add(callerId, id, userId)));
      }
      case "messaging.leave_channel" -> {
        // #860 비공개 채널은 나가면 초대 없이 돌아올 수 없어 확인 카드를 거친다.
        requireOnly(params, "id");
        long id = requireLong(params, "id");
        return new PreparedAction(
            () -> channelMemberService.validateLeavable(callerId, id),
            returning(Map.of("id", id), () -> channelMemberService.leave(callerId, id)));
      }
      case "issue.delete" -> {
        requireOnly(params, "key", "number");
        String key = requireText(params, "key");
        int number = requireInt(params, "number");
        return new PreparedAction(
            () -> issueService.validateDeletable(callerId, key, number),
            deleted(key + "-" + number, () -> issueService.softDelete(callerId, key, number)));
      }
      case "issue.delete_comment" -> {
        requireOnly(params, "key", "number", "commentId");
        String key = requireText(params, "key");
        int number = requireInt(params, "number");
        long commentId = requireLong(params, "commentId");
        // 코멘트 API 는 숫자 이슈 id 경로라 실행 시점에 해석한다(검증과 실행이 같은 해석을 거친다).
        return new PreparedAction(
            () ->
                commentService.validateDeletable(
                    callerId,
                    issueService.resolveAccessibleIssueId(callerId, key, number),
                    commentId),
            deleted(
                commentId,
                () ->
                    commentService.delete(
                        callerId,
                        issueService.resolveAccessibleIssueId(callerId, key, number),
                        commentId)));
      }
      case "wiki.delete_page" -> {
        requireOnly(params, "id");
        long id = requireLong(params, "id");
        return new PreparedAction(
            () -> wikiPageService.validateDeletable(callerId, id),
            deleted(id, () -> wikiPageService.delete(callerId, id)));
      }
      case "contacts.delete_user_group" -> {
        // #839 그룹 삭제는 하위 그룹·멤버십까지 캐스케이드되고 복원 API 가 없어 확인 카드를 거친다.
        requireOnly(params, "id");
        long id = requireLong(params, "id");
        return new PreparedAction(
            () -> userGroupService.validateDeletable(callerId, id),
            deleted(id, () -> userGroupService.delete(callerId, id)));
      }
      default -> {
        return null;
      }
    }
  }

  /** 허용 필드 밖의 키가 있으면 거절한다 — 식별자만 받는 액션에서 DTO 매핑의 FAIL_ON_UNKNOWN_PROPERTIES 와 같은 역할(#852). */
  private static void requireOnly(JsonNode params, String... allowed) {
    if (params == null) return;
    Set<String> ok = Set.of(allowed);
    params
        .fieldNames()
        .forEachRemaining(
            f -> {
              if (!ok.contains(f)) {
                throw new IllegalArgumentException(
                    "잘못된 params: 알 수 없는 필드 '" + f + "' (허용: " + String.join(", ", allowed) + ")");
              }
            });
  }

  /** 정수(int) 필드 — 이슈 번호처럼 int 범위 식별자. */
  private int requireInt(JsonNode params, String field) {
    long v = requireLong(params, field);
    if (v < Integer.MIN_VALUE || v > Integer.MAX_VALUE) {
      throw new IllegalArgumentException(field + " 가 범위를 벗어났습니다: " + v);
    }
    return (int) v;
  }

  /**
   * mail.send 디스패치: params 에서 accountId 를 분리 추출 후 MailSendRequest 로 매핑해 발송.
   *
   * <p>accountId 는 MailSendRequest 레코드 외부 파라미터(경로 변수 상당)이므로 params 에서 별도 추출한다. convertValue 전에
   * accountId 필드를 제거해 unknownProperty 오류를 방지한다. 계정-소유권 검증은 MailComposeService.send
   * 내부(findByIdAndUser)에서 수행 — 호출자 소유 계정만 허용.
   */
  private PreparedAction prepareMailSend(long callerId, JsonNode params) {
    long accountId = requireLong(params, "accountId");
    // accountId 를 제거한 복사본으로 MailSendRequest 매핑(레코드에 없는 필드 → unknown-property 오류 방지).
    ObjectNode paramsWithoutAccountId = (ObjectNode) params.deepCopy();
    paramsWithoutAccountId.remove("accountId");
    MailSendRequest req = mapAndValidate(paramsWithoutAccountId, MailSendRequest.class);
    return new PreparedAction(
        () -> mailComposeService.validateSendable(callerId, accountId, req),
        () -> mailComposeService.send(callerId, accountId, req));
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
    // #843: asLong() 은 "abc"·1.5 같은 값을 조용히 0 으로 바꿔 엉뚱한 404 를 냈다 — 정수로 해석 가능한 값만 받는다.
    JsonNode node = params.get(field);
    if (node.isIntegralNumber() && node.canConvertToLong()) {
      return node.asLong();
    }
    if (node.isTextual()) {
      try {
        return Long.parseLong(node.asText().strip());
      } catch (NumberFormatException ignored) {
        // 아래 공통 오류로
      }
    }
    throw new IllegalArgumentException(field + " 는 정수여야 합니다: " + node);
  }

  /**
   * params 에서 필수 boolean 필드를 추출한다. asBoolean() 은 "yes"·1 같은 값을 조용히 false 로 바꾸므로 명시 값만 받는다(#843).
   */
  private boolean requireBoolean(JsonNode params, String field) {
    if (params == null || !params.hasNonNull(field)) {
      throw new IllegalArgumentException("필수 파라미터 누락: " + field);
    }
    JsonNode node = params.get(field);
    if (node.isBoolean()) {
      return node.booleanValue();
    }
    if (node.isTextual() && ("true".equals(node.asText()) || "false".equals(node.asText()))) {
      return Boolean.parseBoolean(node.asText());
    }
    throw new IllegalArgumentException(field + " 는 true 또는 false 여야 합니다: " + node);
  }

  /**
   * params 에서 scope 필드를 EditScope 로 변환. 없으면 EditScope.ALL 반환.
   *
   * <p>반복 일정 수정/삭제 범위. 단일 일정에는 ALL(기본값)을 사용한다.
   */
  private EditScope parseScope(JsonNode params) {
    if (params == null || !params.hasNonNull("scope")) return EditScope.ALL;
    String raw = params.get("scope").asText();
    try {
      return EditScope.valueOf(raw);
    } catch (IllegalArgumentException e) {
      // #843: Enum.valueOf 의 영문 원문("No enum constant ...")은 사용자·AI 모두 교정에 쓸 수 없다.
      throw new IllegalArgumentException(
          "scope 는 " + Arrays.toString(EditScope.values()) + " 중 하나여야 합니다: " + raw);
    }
  }

  /**
   * params 에서 ISO-8601 OffsetDateTime 필드를 파싱. 없으면 null 반환.
   *
   * <p>반복 일정에서 특정 발생일(occurrenceDate)을 지정할 때 사용. 단일 일정이면 null 전달.
   */
  private OffsetDateTime parseOffsetDateTime(JsonNode params, String field) {
    if (params == null || !params.hasNonNull(field)) return null;
    String raw = params.get(field).asText();
    try {
      return OffsetDateTime.parse(raw);
    } catch (DateTimeParseException e) {
      // #843: DateTimeParseException 은 IllegalArgumentException 이 아니라 전역 캐치올 500 으로 떨어졌다 → 400.
      throw new IllegalArgumentException(
          field + " 는 오프셋을 포함한 ISO-8601 형식이어야 합니다(예: 2026-09-23T10:00:00+09:00): " + raw);
    }
  }

  /**
   * 준비된 액션 — 파라미터 해석이 끝난 도메인 검증(check)과 실행(execute) 한 쌍(#842).
   *
   * <p>두 칸을 모두 요구하므로 새 분기를 추가할 때 사전검증을 빼먹으면 컴파일이 되지 않는다. validate 는 check 만, confirm 은 execute 만
   * 부른다 — 실제 커밋은 execute 에서만 일어나므로 메일 발송·M365 반영처럼 롤백으로 되돌릴 수 없는 부수효과가 dry-run 에서 발생하지 않는다.
   */
  private record PreparedAction(Runnable check, Supplier<Object> execute) {}

  /** 삭제형 액션의 실행 함수 — 삭제 후 {@code {"deleted": id}} 를 돌려주는 공통 형태. */
  private static Supplier<Object> deleted(Object id, Runnable delete) {
    return returning(Map.of("deleted", id), delete);
  }

  /** 결과 없는(void) 도메인 호출의 실행 함수 — 실행 후 식별자 맵을 돌려줘 승인 기록(resultRef)이 대상을 가리키게 한다. */
  private static Supplier<Object> returning(Object result, Runnable run) {
    return () -> {
      run.run();
      return result;
    };
  }

  /** JsonNode→DTO 변환 후 bean-validation 명시 수행(@Valid 바인딩 밖이라 자동 발동 안 함). */
  private <T> T mapAndValidate(JsonNode params, Class<T> type) {
    // #843: null params 는 convertValue 가 null 을 돌려줘 validator 가 영문 HV000116 오류를 냈다.
    if (params == null || !params.isObject()) {
      throw new IllegalArgumentException("params 는 JSON 객체여야 합니다");
    }
    T dto;
    try {
      // #852: 모르는 필드는 거절한다. 전역 기본값(무시)을 따르면 AI 가 틀린 이름으로 보낸 값(attendees↔attendeeUserIds)이 오류 없이
      // 사라져 "승인했는데 반영 안 됨"이 된다. 이 매핑에만 엄격 모드를 켜 전역 설정은 건드리지 않는다.
      dto =
          objectMapper
              .readerFor(type)
              .with(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
              .readValue(params);
    } catch (IOException e) {
      // #843: Jackson 원문("Cannot deserialize value of type ...")은 영문+내부 클래스명 노출 → 필드 단위 한국어 사유로.
      throw new IllegalArgumentException(describeMappingError(e));
    }
    Set<ConstraintViolation<T>> violations = validator.validate(dto);
    if (!violations.isEmpty()) {
      ConstraintViolation<T> v = violations.iterator().next();
      throw new IllegalArgumentException(
          "잘못된 params: " + v.getPropertyPath() + " — " + v.getMessage());
    }
    return dto;
  }

  /** 매핑 실패 원인에서 문제 필드 경로를 뽑아 사용자·AI 가 고칠 수 있는 문장으로 만든다. */
  private static String describeMappingError(IOException e) {
    if (e instanceof JsonMappingException jme) {
      String field =
          jme.getPath().stream()
              .map(r -> r.getFieldName() != null ? r.getFieldName() : "[" + r.getIndex() + "]")
              .collect(Collectors.joining("."));
      if (jme instanceof UnrecognizedPropertyException) {
        return "잘못된 params: 알 수 없는 필드 '" + field + "'";
      }
      if (!field.isEmpty()) {
        return "잘못된 params: '" + field + "' 값의 형식이 올바르지 않습니다";
      }
    }
    return "잘못된 params: 값의 형식이 올바르지 않습니다";
  }
}
