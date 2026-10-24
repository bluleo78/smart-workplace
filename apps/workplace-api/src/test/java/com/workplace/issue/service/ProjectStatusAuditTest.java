package com.workplace.issue.service;

import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.audit.dto.AuditLogResponse;
import com.workplace.audit.repository.AuditLogRepository;
import com.workplace.issue.dto.CreateProjectStatusRequest;
import com.workplace.issue.dto.ProjectStatusResponse;
import com.workplace.issue.dto.ReorderProjectStatusesRequest;
import com.workplace.issue.dto.UpdateProjectStatusRequest;
import com.workplace.issue.exception.StatusNameDuplicatedException;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * 상태 설정 감사 로그 통합 테스트(WP-811) — 추가·이름/색 변경·순서 변경이 resource "project_status" 로 남고, 실패한 쓰기는 남지 않는지
 * 확인한다.
 */
@Transactional
class ProjectStatusAuditTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired ProjectStatusService service;
  @Autowired ProjectService projectService;
  @Autowired AuditLogRepository auditLogRepository;
  @Autowired ObjectMapper objectMapper;

  /** USER 역할·테넌트#1 멤버십을 가진 사용자를 만든다. */
  private Long createUser(String prefix) {
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    Long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, prefix + "-" + suffix)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, prefix)
            .set(USER.EMAIL, prefix + "-" + suffix + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    Long roleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("USER")).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE).set(USER_ROLE.USER_ID, id).set(USER_ROLE.ROLE_ID, roleId).execute();
    dsl.insertInto(MEMBERSHIP)
        .set(MEMBERSHIP.USER_ID, id)
        .set(MEMBERSHIP.TENANT_ID, 1L)
        .set(MEMBERSHIP.STATUS, "ACTIVE")
        .execute();
    return id;
  }

  /** 겹치지 않는 TEAM 프로젝트를 만든다. */
  private ProjectResponse newProject(Long ownerId, String prefix) {
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 4);
    return projectService.create(
        ownerId, new CreateProjectRequest(prefix + suffix, "P-" + prefix, "x", "TEAM"));
  }

  private ProjectStatusResponse create(Long caller, String key, String name) {
    return service.create(
        caller, key, new CreateProjectStatusRequest(name, "IN_PROGRESS", null, null));
  }

  private Long idOf(Long caller, String key, String name) {
    return service.list(caller, key).stream()
        .filter(s -> s.name().equals(name))
        .findFirst()
        .orElseThrow()
        .id();
  }

  /** 이 프로젝트의 project_status 감사 로그(액션별) — 다른 테스트가 남긴 행과 섞이지 않게 metadata.projectKey 로 거른다. */
  private List<AuditLogResponse> logs(String action, String projectKey) {
    return auditLogRepository.findByResource(action, "project_status", null).stream()
        .filter(l -> projectKey.equals(meta(l).path("projectKey").asText()))
        .toList();
  }

  private JsonNode meta(AuditLogResponse log) {
    try {
      return log.metadata() == null
          ? objectMapper.createObjectNode()
          : objectMapper.readTree(log.metadata());
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  @Test
  void 추가는_project_status_CREATE_감사로그를_남긴다() {
    Long owner = createUser("ac");
    ProjectResponse p = newProject(owner, "PAA");

    var created = create(owner, p.key(), "검토 중");

    var logs = logs("CREATE", p.key());
    assertThat(logs).hasSize(1);
    var log = logs.get(0);
    assertThat(log.resource()).isEqualTo("project_status");
    assertThat(log.actionType()).isEqualTo("CREATE");
    assertThat(log.resourceId()).isEqualTo(String.valueOf(created.id()));
    assertThat(log.userId()).isEqualTo(owner);
    assertThat(log.result()).isEqualTo("SUCCESS");
    assertThat(log.description()).isEqualTo(p.key() + " 상태 '검토 중' 추가");
    var m = meta(log);
    assertThat(m.path("name").asText()).isEqualTo("검토 중");
    assertThat(m.path("category").asText()).isEqualTo("IN_PROGRESS");
    assertThat(m.path("color").asText()).isEqualTo("BLUE");
  }

  @Test
  void 이름색_변경은_UPDATE_전후값을_남긴다() {
    Long owner = createUser("au");
    ProjectResponse p = newProject(owner, "PAB");
    Long inProgress = idOf(owner, p.key(), "진행 중");

    // 이름만 바꾸면 color 키가 없다
    service.update(owner, p.key(), inProgress, new UpdateProjectStatusRequest("작업 중", null));
    var renamed = logs("UPDATE", p.key());
    assertThat(renamed).hasSize(1);
    assertThat(renamed.get(0).resourceId()).isEqualTo(String.valueOf(inProgress));
    var m = meta(renamed.get(0));
    assertThat(m.path("name").path("from").asText()).isEqualTo("진행 중");
    assertThat(m.path("name").path("to").asText()).isEqualTo("작업 중");
    assertThat(m.has("color")).isFalse();

    // 색만 바꾸면 name 키가 없다
    service.update(owner, p.key(), inProgress, new UpdateProjectStatusRequest(null, "PURPLE"));
    var recolored = logs("UPDATE", p.key()).stream().filter(l -> meta(l).has("color")).toList();
    assertThat(recolored).hasSize(1);
    var c = meta(recolored.get(0));
    assertThat(c.path("color").path("from").asText()).isEqualTo("BLUE");
    assertThat(c.path("color").path("to").asText()).isEqualTo("PURPLE");
    assertThat(c.has("name")).isFalse();
  }

  @Test
  void 이름색이_그대로인_수정은_감사로그를_남기지_않는다() {
    Long owner = createUser("an");
    ProjectResponse p = newProject(owner, "PAE");
    Long inProgress = idOf(owner, p.key(), "진행 중");

    // 지금과 같은 이름·색을 다시 보낸 저장은 설정 변경이 아니다
    service.update(owner, p.key(), inProgress, new UpdateProjectStatusRequest("진행 중", "BLUE"));
    service.update(owner, p.key(), inProgress, new UpdateProjectStatusRequest(null, "BLUE"));

    assertThat(logs("UPDATE", p.key())).isEmpty();

    // 하나라도 바뀌면 남는다
    service.update(owner, p.key(), inProgress, new UpdateProjectStatusRequest("진행 중", "TEAL"));
    assertThat(logs("UPDATE", p.key())).hasSize(1);
  }

  @Test
  void 순서변경은_UPDATE_reorder를_남긴다() {
    Long owner = createUser("ar");
    ProjectResponse p = newProject(owner, "PAC");
    create(owner, p.key(), "검토 중");
    create(owner, p.key(), "QA");
    List<Long> ids =
        Arrays.stream(new String[] {"QA", "진행 중", "검토 중"})
            .map(n -> idOf(owner, p.key(), n))
            .toList();

    service.reorder(owner, p.key(), new ReorderProjectStatusesRequest("IN_PROGRESS", ids));

    var logs = logs("UPDATE", p.key());
    assertThat(logs).hasSize(1);
    // 순서 변경은 상태 하나가 아니라 범주 전체라 resourceId 는 프로젝트 id
    assertThat(logs.get(0).resourceId()).isEqualTo(String.valueOf(p.id()));
    // 설명은 범주 코드 대신 화면과 같은 한국어 라벨
    assertThat(logs.get(0).description()).isEqualTo(p.key() + " 진행 중 상태 순서 변경");
    var reorder = meta(logs.get(0)).path("reorder");
    assertThat(reorder.path("category").asText()).isEqualTo("IN_PROGRESS");
    assertThat(objectMapper.convertValue(reorder.path("from"), List.class))
        .containsExactly("진행 중", "검토 중", "QA");
    assertThat(objectMapper.convertValue(reorder.path("to"), List.class))
        .containsExactly("QA", "진행 중", "검토 중");
  }

  @Test
  void 실패한_추가는_감사로그를_남기지_않는다() {
    Long owner = createUser("af");
    ProjectResponse p = newProject(owner, "PAD");

    assertThatThrownBy(() -> create(owner, p.key(), "진행 중"))
        .isInstanceOf(StatusNameDuplicatedException.class);

    assertThat(logs("CREATE", p.key())).isEmpty();
  }
}
