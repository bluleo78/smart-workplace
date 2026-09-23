package com.workplace.action;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.workplace.calendar.exception.CalendarEventNotFoundException;
import com.workplace.calendar.exception.CalendarNotFoundException;
import com.workplace.contacts.exception.ContactNotFoundException;
import com.workplace.drive.exception.DriveFileNotFoundException;
import com.workplace.drive.exception.DriveFolderNotFoundException;
import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.exception.EmailAccountNotFoundException;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.exception.ProjectAccessDeniedException;
import com.workplace.project.exception.ProjectConflictException;
import com.workplace.project.exception.ProjectNotFoundException;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.user.exception.UserNotFoundException;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * 확인 카드 사전검증(dry-run) 통합 테스트 (#842).
 *
 * <p>무엇을·왜: AI 가 확인 카드를 만들기 전에 {@code ConfirmActionDispatcher.validate} 로 "승인 후에야 드러나던" 실패(미존재 id ·
 * 권한 없음 · key 중복 · 이미 멤버 등)를 미리 드러내는지 13종 액션 전부에 대해 고정한다. 동시에 dry-run 이 DB 에 어떤 행도 남기지 않음을 단언한다 —
 * 사전검증이 실행이 되어버리면 카드의 의미가 사라지기 때문.
 *
 * <p>여기서는 {@link ConfirmActionDispatcher#validate} 를 직접 부른다. {@code ActionService.validate} 는
 * setRollbackOnly 로 테스트 트랜잭션을 롤백 전용으로 오염시키므로, "prepare 자체가 아무것도 쓰지 않는다"는 더 강한 보증은 디스패처를 직접 호출해
 * 확인한다(자체 트랜잭션 밖에서의 재확인은 ActionValidateRlsGuardTest 가 담당).
 */
@Transactional
class ConfirmActionValidateTest extends IntegrationTestBase {

  /** 어떤 도메인에도 존재하지 않는 id — "승인 후에야 드러나던" 미존재 실패를 재현하는 공용 상수. */
  private static final long MISSING_ID = 999_999_999L;

  @Autowired ConfirmActionDispatcher dispatcher;
  @Autowired ObjectMapper objectMapper;
  @Autowired ProjectService projectService;
  @Autowired DSLContext dsl;

  /** 프로젝트 OWNER 이자 대부분 액션의 호출자(USER 역할 — calendar:write/contact:write/project:manage 보유). */
  private long owner;

  /** 어떤 프로젝트에도 속하지 않은 같은 테넌트 사용자 — 권한 경계 실패 재현용. */
  private long outsider;

  /** user.set_roles / user.set_active 호출자(role:assign · user:write 보유). */
  private long admin;

  /** 테넌트 멤버십이 없는 사용자 — 구성원 액션의 "타 테넌트 사용자" 실패 재현용. */
  private long foreigner;

  private String projectKey;

  @BeforeEach
  void setUp() {
    TenantContext.set(1L);
    owner = seedHuman("validate_owner", "USER");
    outsider = seedHuman("validate_outsider", "USER");
    admin = seedHuman("validate_admin", "ADMIN");
    foreigner = TestFixtures.createHuman(dsl);

    projectKey = uniqueKey("VA");
    projectService.create(owner, new CreateProjectRequest(projectKey, "사전검증 테스트", null));
  }

  @AfterEach
  void tearDown() {
    TenantContext.clear();
  }

  // ---------------------------------------------------------------- 픽스처 헬퍼

  /** HUMAN 유저 + 지정 역할 + 테넌트#1 ACTIVE 멤버십. ConfirmActionDispatcherMemberTest.seedHuman 과 동일 패턴. */
  private long seedHuman(String prefix, String roleName) {
    long id = TestFixtures.createHuman(dsl);
    Long roleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq(roleName)).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE).set(USER_ROLE.USER_ID, id).set(USER_ROLE.ROLE_ID, roleId).execute();
    dsl.insertInto(MEMBERSHIP)
        .set(MEMBERSHIP.USER_ID, id)
        .set(MEMBERSHIP.TENANT_ID, 1L)
        .set(MEMBERSHIP.STATUS, "ACTIVE")
        .execute();
    return id;
  }

  /** 유니크 프로젝트 키 생성 (대문자 알파벳+숫자, 2~10자). */
  private String uniqueKey(String prefix) {
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 4);
    return prefix + suffix;
  }

  private ObjectNode params() {
    return objectMapper.createObjectNode();
  }

  /** 일정 수정 액션에 필요한 최소 유효 본문 — bean-validation 이 도메인 검증보다 먼저 돌기 때문에 필수. */
  private ObjectNode validEventBody() {
    ObjectNode p = params();
    p.put("title", "사전검증 일정");
    p.put("startsAt", "2026-06-26T01:00:00Z");
    p.put("endsAt", "2026-06-26T02:00:00Z");
    p.put("allDay", false);
    return p;
  }

  // ------------------------------------------------- 13종 액션 × 대표 실패 1건

  @Test
  @DisplayName("calendar.create_event — 남의/없는 캘린더 지정은 사전검증에서 404 로 드러난다")
  void validate_calendarCreateEvent_missingCalendar_throwsCalendarNotFound() {
    // 무엇을·왜: calendarId 는 승인 후 create 시점에야 검증되던 값 — 카드 생성 전에 미리 튕겨야 한다.
    ObjectNode p = validEventBody();
    p.put("calendarId", MISSING_ID);

    assertThatThrownBy(() -> dispatcher.validate(owner, "calendar.create_event", p))
        .isInstanceOf(CalendarNotFoundException.class);
  }

  @Test
  @DisplayName("calendar.update_event — 존재하지 않는 일정 id 는 사전검증에서 404 로 드러난다")
  void validate_calendarUpdateEvent_missingEvent_throwsEventNotFound() {
    // 무엇을·왜: owner 검증(미존재/비-owner 모두 404 은닉)이 승인 전에 수행되는지 고정.
    ObjectNode p = validEventBody();
    p.put("id", MISSING_ID);

    assertThatThrownBy(() -> dispatcher.validate(owner, "calendar.update_event", p))
        .isInstanceOf(CalendarEventNotFoundException.class);
  }

  @Test
  @DisplayName("calendar.delete_event — 존재하지 않는 일정 id 는 사전검증에서 404 로 드러난다")
  void validate_calendarDeleteEvent_missingEvent_throwsEventNotFound() {
    // 무엇을·왜: 삭제 카드가 "이미 없는 일정"을 제안하지 못하도록 승인 전에 막는다.
    ObjectNode p = params();
    p.put("id", MISSING_ID);

    assertThatThrownBy(() -> dispatcher.validate(owner, "calendar.delete_event", p))
        .isInstanceOf(CalendarEventNotFoundException.class);
  }

  @Test
  @DisplayName("mail.send — 내 계정이 아닌 accountId 는 사전검증에서 404 로 드러난다")
  void validate_mailSend_foreignAccount_throwsEmailAccountNotFound() {
    // 무엇을·왜: 메일 발송은 롤백으로 되돌릴 수 없는 부수효과 — 계정 소유 실패는 반드시 승인 전에 드러나야 한다.
    ObjectNode p = params();
    p.put("accountId", MISSING_ID);
    p.putArray("to").add("someone@example.com");
    p.put("subject", "사전검증");
    p.put("bodyText", "본문");

    assertThatThrownBy(() -> dispatcher.validate(owner, "mail.send", p))
        .isInstanceOf(EmailAccountNotFoundException.class);
  }

  @Test
  @DisplayName("contacts.delete_contact — 존재하지 않는 연락처 id 는 사전검증에서 404 로 드러난다")
  void validate_contactsDeleteContact_missingContact_throwsContactNotFound() {
    // 무엇을·왜: requireWritable 의 존재 은닉(404) 술어가 dry-run 에서도 동일하게 적용되는지 고정.
    ObjectNode p = params();
    p.put("id", MISSING_ID);

    assertThatThrownBy(() -> dispatcher.validate(owner, "contacts.delete_contact", p))
        .isInstanceOf(ContactNotFoundException.class);
  }

  @Test
  @DisplayName("project.create_project — 이미 쓰는 key 는 사전검증에서 409 로 드러난다")
  void validate_projectCreateProject_duplicateKey_throwsConflict() {
    // 무엇을·왜: key 중복은 INSERT 시점(=승인 후)에야 터지던 전형적 실패.
    ObjectNode p = params();
    p.put("key", projectKey);
    p.put("name", "중복 키 프로젝트");

    assertThatThrownBy(() -> dispatcher.validate(owner, "project.create_project", p))
        .isInstanceOf(ProjectConflictException.class)
        .hasMessageContaining("이미 사용 중인 key");
  }

  @Test
  @DisplayName("project.delete_project — 비멤버의 삭제 제안은 사전검증에서 403 으로 드러난다")
  void validate_projectDeleteProject_nonOwner_throwsAccessDenied() {
    // 무엇을·왜: RBAC(project:manage)는 통과하지만 프로젝트 OWNER 경계는 도메인 술어만 알 수 있다.
    ObjectNode p = params();
    p.put("key", projectKey);

    assertThatThrownBy(() -> dispatcher.validate(outsider, "project.delete_project", p))
        .isInstanceOf(ProjectAccessDeniedException.class)
        .hasMessageContaining("프로젝트 멤버가 아닙니다");
  }

  @Test
  @DisplayName("project.add_member — 이미 멤버인 사용자 추가는 사전검증에서 409 로 드러난다")
  void validate_projectAddMember_alreadyMember_throwsConflict() {
    // 무엇을·왜: owner 는 생성 시 OWNER 멤버로 자동 등록됨 — 중복 추가는 승인 후에야 터지던 실패.
    ObjectNode p = params();
    p.put("key", projectKey);
    p.put("userId", owner);
    p.put("role", "MEMBER");

    assertThatThrownBy(() -> dispatcher.validate(owner, "project.add_member", p))
        .isInstanceOf(ProjectConflictException.class)
        .hasMessageContaining("이미 멤버입니다");
  }

  @Test
  @DisplayName("drive.delete_file — 존재하지 않는 파일 id 는 사전검증에서 404 로 드러난다")
  void validate_driveDeleteFile_missingFile_throwsFileNotFound() {
    // 무엇을·왜: 파일 존재 확인은 space 권한 검사보다 먼저 — dry-run 도 같은 순서를 공유해야 한다.
    ObjectNode p = params();
    p.put("id", MISSING_ID);

    assertThatThrownBy(() -> dispatcher.validate(owner, "drive.delete_file", p))
        .isInstanceOf(DriveFileNotFoundException.class);
  }

  @Test
  @DisplayName("drive.delete_folder — 존재하지 않는 폴더 id 는 사전검증에서 404 로 드러난다")
  void validate_driveDeleteFolder_missingFolder_throwsFolderNotFound() {
    // 무엇을·왜: 폴더 삭제는 서브트리 통째 마킹이라 승인 후 실패가 특히 비싸다.
    ObjectNode p = params();
    p.put("id", MISSING_ID);

    assertThatThrownBy(() -> dispatcher.validate(owner, "drive.delete_folder", p))
        .isInstanceOf(DriveFolderNotFoundException.class);
  }

  @Test
  @DisplayName("issue.create — 존재하지 않는 projectKey 는 사전검증에서 404 로 드러난다")
  void validate_issueCreate_missingProject_throwsProjectNotFound() {
    // 무엇을·왜: LLM 이 지어낸 프로젝트 키를 카드로 만들기 전에 잡는다(#842 의 핵심 동기).
    String ghostKey = uniqueKey("GH");
    ObjectNode p = params();
    p.put("projectKey", ghostKey);
    p.put("title", "없는 프로젝트의 이슈");

    assertThatThrownBy(() -> dispatcher.validate(owner, "issue.create", p))
        .isInstanceOf(ProjectNotFoundException.class)
        .hasMessageContaining(ghostKey);
  }

  @Test
  @DisplayName("user.set_roles — 테넌트 비멤버 대상 역할 변경은 사전검증에서 404 로 드러난다")
  void validate_userSetRoles_nonMemberTarget_throwsUserNotFound() {
    // 무엇을·왜: user 는 전역 테이블이라 존재는 하지만, 타 테넌트 사용자의 역할을 바꿀 수는 없다(#811).
    ObjectNode p = params();
    p.put("userId", foreigner);
    p.putArray("roles").add("USER");

    assertThatThrownBy(() -> dispatcher.validate(admin, "user.set_roles", p))
        .isInstanceOf(UserNotFoundException.class)
        .hasMessageContaining("사용자를 찾을 수 없습니다");
  }

  @Test
  @DisplayName("user.set_active — 테넌트 비멤버 대상 활성 토글은 사전검증에서 404 로 드러난다")
  void validate_userSetActive_nonMemberTarget_throwsUserNotFound() {
    // 무엇을·왜: 비활성화 카드가 만들어지기 전에 테넌트 경계를 확인한다.
    ObjectNode p = params();
    p.put("userId", foreigner);
    p.put("active", false);

    assertThatThrownBy(() -> dispatcher.validate(admin, "user.set_active", p))
        .isInstanceOf(UserNotFoundException.class)
        .hasMessageContaining("사용자를 찾을 수 없습니다");
  }

  // ------------------------------------------------- 성공 + 부수효과 없음(dry-run 보증)

  @Test
  @DisplayName("issue.create — 유효한 사전검증은 통과하되 이슈 행을 만들지 않는다")
  void validate_issueCreate_valid_passesWithoutCreatingIssue() {
    // 무엇을·왜: dry-run 의 핵심 보증. 검증만 통과시키고 실행(=INSERT)은 하지 않아야 한다.
    Long projectId =
        dsl.select(PROJECT.ID).from(PROJECT).where(PROJECT.KEY.eq(projectKey)).fetchOne(PROJECT.ID);
    int before = countIssues(projectId);

    ObjectNode p = params();
    p.put("projectKey", projectKey);
    p.put("title", "사전검증만 하는 이슈");
    p.put("priority", "HIGH");

    assertThatCode(() -> dispatcher.validate(owner, "issue.create", p)).doesNotThrowAnyException();

    assertThat(countIssues(projectId)).isEqualTo(before);
  }

  @Test
  @DisplayName("project.create_project — 유효한 사전검증은 통과하되 프로젝트 행을 만들지 않는다")
  void validate_projectCreateProject_valid_passesWithoutCreatingProject() {
    // 무엇을·왜: 생성형 액션이 사전검증만으로 key 를 선점해버리면 사용자가 승인을 거부해도 이름이 묶인다.
    String freshKey = uniqueKey("NW");
    ObjectNode p = params();
    p.put("key", freshKey);
    p.put("name", "아직 만들지 않은 프로젝트");

    assertThatCode(() -> dispatcher.validate(owner, "project.create_project", p))
        .doesNotThrowAnyException();

    Integer count =
        dsl.selectCount().from(PROJECT).where(PROJECT.KEY.eq(freshKey)).fetchOne(0, Integer.class);
    assertThat(count).isZero();
  }

  /** 프로젝트에 속한 이슈 수 — dry-run 부수효과 유무 판정용. */
  private int countIssues(Long projectId) {
    return dsl.selectCount()
        .from(ISSUE)
        .where(ISSUE.PROJECT_ID.eq(projectId))
        .fetchOne(0, Integer.class);
  }
}
