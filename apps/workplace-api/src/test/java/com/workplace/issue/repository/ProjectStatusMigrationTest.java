package com.workplace.issue.repository;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_TYPE_DEF;
import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.PROJECT_STATUS;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.tuple;

import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.service.PersonalProjectProvisioner;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.transaction.annotation.Transactional;

/**
 * V201 project_status 마이그레이션 통합 테스트(WP-807).
 *
 * <p>새 프로젝트 4상태 시드 트리거, 이슈 status ↔ status_id 동기화 트리거(구 파드 호환), 복합 FK(id, project_id, category) 의
 * 범주·프로젝트 정합, 이름 유일·길이 제약, 백필 SQL 을 DB 수준에서 고정한다. 기존 코드는 status_id 를 모르므로 트리거만으로 동작해야 한다.
 */
@Transactional
class ProjectStatusMigrationTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired ProjectService projectService;
  @Autowired PersonalProjectProvisioner personalProjectProvisioner;

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

  private String uniqueKey(String prefix) {
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 4);
    String key = prefix + suffix;
    return key.substring(0, Math.min(10, key.length()));
  }

  private ProjectResponse newProject(Long ownerId, String prefix) {
    return projectService.create(
        ownerId, new CreateProjectRequest(uniqueKey(prefix), "P-" + prefix, "x"));
  }

  /** 프로젝트의 범주 기본 상태(시드된 행) id. */
  private Long statusId(Long projectId, String category) {
    return dsl.select(PROJECT_STATUS.ID)
        .from(PROJECT_STATUS)
        .where(PROJECT_STATUS.PROJECT_ID.eq(projectId))
        .and(PROJECT_STATUS.CATEGORY.eq(category))
        .orderBy(PROJECT_STATUS.POSITION)
        .limit(1)
        .fetchOne(PROJECT_STATUS.ID);
  }

  /** 구 코드처럼 status 만 지정하고(status_id 생략) 이슈를 직접 넣는다. */
  private Long insertIssue(Long projectId, Long reporterId, int number, String status) {
    Long typeId =
        dsl.select(ISSUE_TYPE_DEF.ID)
            .from(ISSUE_TYPE_DEF)
            .where(ISSUE_TYPE_DEF.PROJECT_ID.eq(projectId))
            .limit(1)
            .fetchOne(ISSUE_TYPE_DEF.ID);
    return dsl.insertInto(ISSUE)
        .set(ISSUE.PROJECT_ID, projectId)
        .set(ISSUE.NUMBER, number)
        .set(ISSUE.TITLE, "status-" + number)
        .set(ISSUE.STATUS, status)
        .set(ISSUE.PRIORITY, "MID")
        .set(ISSUE.REPORTER_ID, reporterId)
        .set(ISSUE.TYPE_ID, typeId)
        .returning(ISSUE.ID)
        .fetchOne()
        .getId();
  }

  private Long issueStatusId(Long issueId) {
    return dsl.select(ISSUE.STATUS_ID)
        .from(ISSUE)
        .where(ISSUE.ID.eq(issueId))
        .fetchOne(ISSUE.STATUS_ID);
  }

  private String issueStatus(Long issueId) {
    return dsl.select(ISSUE.STATUS).from(ISSUE).where(ISSUE.ID.eq(issueId)).fetchOne(ISSUE.STATUS);
  }

  @Test
  void 새_팀프로젝트는_4상태가_범주순으로_시드된다() {
    Long owner = createUser("ps-a");
    ProjectResponse p = newProject(owner, "PSA");

    var rows =
        dsl.select(PROJECT_STATUS.NAME, PROJECT_STATUS.CATEGORY, PROJECT_STATUS.POSITION)
            .from(PROJECT_STATUS)
            .where(PROJECT_STATUS.PROJECT_ID.eq(p.id()))
            .orderBy(PROJECT_STATUS.POSITION)
            .fetch();

    assertThat(rows)
        .extracting(
            r -> r.get(PROJECT_STATUS.NAME),
            r -> r.get(PROJECT_STATUS.CATEGORY),
            r -> r.get(PROJECT_STATUS.POSITION))
        .containsExactly(
            tuple("할 일", "TODO", 0),
            tuple("진행 중", "IN_PROGRESS", 1),
            tuple("완료", "DONE", 2),
            tuple("취소", "CANCELED", 3));
  }

  @Test
  void 개인프로젝트도_4상태가_시드된다() {
    Long owner = createUser("ps-b");
    var p = personalProjectProvisioner.createPersonal(owner, "개인 작업", null, false);

    assertThat(dsl.fetchCount(PROJECT_STATUS, PROJECT_STATUS.PROJECT_ID.eq(p.id()))).isEqualTo(4);
  }

  @Test
  void status_id_없이_INSERT하면_범주_기본상태가_채워진다() {
    Long owner = createUser("ps-c");
    ProjectResponse p = newProject(owner, "PSC");

    Long issueId = insertIssue(p.id(), owner, 1, "DONE");

    assertThat(issueStatusId(issueId)).isEqualTo(statusId(p.id(), "DONE"));
  }

  @Test
  void status만_UPDATE하면_status_id가_새_범주_기본상태로_맞춰진다() {
    Long owner = createUser("ps-d");
    ProjectResponse p = newProject(owner, "PSD");
    Long issueId = insertIssue(p.id(), owner, 1, "TODO");

    // 구 코드 흉내: status 만 바꾸고 status_id 는 건드리지 않는다.
    dsl.update(ISSUE).set(ISSUE.STATUS, "IN_PROGRESS").where(ISSUE.ID.eq(issueId)).execute();

    assertThat(issueStatusId(issueId)).isEqualTo(statusId(p.id(), "IN_PROGRESS"));
  }

  @Test
  void 범주가_어긋난_status_id를_명시하면_FK가_거절한다() {
    Long owner = createUser("ps-e");
    ProjectResponse p = newProject(owner, "PSE");
    Long issueId = insertIssue(p.id(), owner, 1, "TODO");
    Long doneId = statusId(p.id(), "DONE");

    // status_id 를 바꾸므로(OLD 와 다름) 트리거가 보정하지 않고, 범주 불일치는 복합 FK 가 막는다.
    assertThatThrownBy(
            () ->
                dsl.update(ISSUE)
                    .set(ISSUE.STATUS, "TODO")
                    .set(ISSUE.STATUS_ID, doneId)
                    .where(ISSUE.ID.eq(issueId))
                    .execute())
        .isInstanceOf(DataIntegrityViolationException.class);
  }

  @Test
  void 다른_프로젝트의_status_id는_FK가_거절한다() {
    Long owner = createUser("ps-f");
    ProjectResponse p1 = newProject(owner, "PSF");
    ProjectResponse p2 = newProject(owner, "PSG");
    Long issueId = insertIssue(p1.id(), owner, 1, "TODO");
    Long otherTodo = statusId(p2.id(), "TODO");

    assertThatThrownBy(
            () ->
                dsl.update(ISSUE)
                    .set(ISSUE.STATUS_ID, otherTodo)
                    .where(ISSUE.ID.eq(issueId))
                    .execute())
        .isInstanceOf(DataIntegrityViolationException.class);
  }

  @Test
  void 같은_프로젝트에_대소문자_공백만_다른_이름은_유일제약에_걸린다() {
    Long owner = createUser("ps-g");
    ProjectResponse p = newProject(owner, "PSH");
    dsl.insertInto(PROJECT_STATUS)
        .set(PROJECT_STATUS.PROJECT_ID, p.id())
        .set(PROJECT_STATUS.NAME, "Review 검토")
        .set(PROJECT_STATUS.CATEGORY, "IN_PROGRESS")
        .set(PROJECT_STATUS.POSITION, 4)
        .execute();

    assertThatThrownBy(
            () ->
                dsl.insertInto(PROJECT_STATUS)
                    .set(PROJECT_STATUS.PROJECT_ID, p.id())
                    .set(PROJECT_STATUS.NAME, " review 검토 ")
                    .set(PROJECT_STATUS.CATEGORY, "IN_PROGRESS")
                    .set(PROJECT_STATUS.POSITION, 5)
                    .execute())
        .isInstanceOf(DuplicateKeyException.class);
  }

  @Test
  void 이름_31자는_CHECK에_걸린다() {
    Long owner = createUser("ps-h");
    ProjectResponse p = newProject(owner, "PSI");

    // VARCHAR(30) 을 넘는 값은 무결성 위반으로 거절된다.
    assertThatThrownBy(
            () ->
                dsl.insertInto(PROJECT_STATUS)
                    .set(PROJECT_STATUS.PROJECT_ID, p.id())
                    .set(PROJECT_STATUS.NAME, "가".repeat(31))
                    .set(PROJECT_STATUS.CATEGORY, "TODO")
                    .set(PROJECT_STATUS.POSITION, 4)
                    .execute())
        .isInstanceOf(DataIntegrityViolationException.class);
  }

  @Test
  void 공백만_있는_이름은_CHECK에_걸린다() {
    Long owner = createUser("ps-k");
    ProjectResponse p = newProject(owner, "PSL");

    // 앞뒤 공백을 걷어낸 길이가 0 이면 CHECK(char_length(btrim(name)) BETWEEN 1 AND 30) 가 거절한다.
    assertThatThrownBy(
            () ->
                dsl.insertInto(PROJECT_STATUS)
                    .set(PROJECT_STATUS.PROJECT_ID, p.id())
                    .set(PROJECT_STATUS.NAME, "   ")
                    .set(PROJECT_STATUS.CATEGORY, "TODO")
                    .set(PROJECT_STATUS.POSITION, 4)
                    .execute())
        .isInstanceOf(DataIntegrityViolationException.class);
  }

  @Test
  void 상태_범주를_바꾸면_CASCADE로_이슈범주만_따라가고_status_id는_유지된다() {
    Long owner = createUser("ps-i");
    ProjectResponse p = newProject(owner, "PSJ");
    Long issueId = insertIssue(p.id(), owner, 1, "TODO");
    Long todoId = statusId(p.id(), "TODO");

    // 상태 범주 변경(WP-811) — ON UPDATE CASCADE 가 issue.status 로 전파된다. 트리거가 status_id 를 다른 상태로 돌리면 안 된다.
    dsl.update(PROJECT_STATUS)
        .set(PROJECT_STATUS.CATEGORY, "IN_PROGRESS")
        .where(PROJECT_STATUS.ID.eq(todoId))
        .execute();

    assertThat(issueStatus(issueId)).isEqualTo("IN_PROGRESS");
    assertThat(issueStatusId(issueId)).isEqualTo(todoId);
  }

  @Test
  void backfill_SQL은_project_id_status로_시드상태를_찾는다() {
    Long owner = createUser("ps-j");
    ProjectResponse p = newProject(owner, "PSK");
    Long todoIssue = insertIssue(p.id(), owner, 1, "TODO");
    Long canceledIssue = insertIssue(p.id(), owner, 2, "CANCELED");
    // 마이그레이션 시점엔 기존 데이터가 없어 백필을 직접 볼 수 없다 — V201 의 백필 UPDATE 를 이 프로젝트로 좁혀 그대로 돌려
    // (project_id, status) 로 대응 범주의 시드 상태를 고르는지 확인한다.
    int updated =
        dsl.execute(
            "UPDATE issue i SET status_id = ps.id FROM project_status ps "
                + "WHERE ps.project_id = i.project_id AND ps.category = i.status AND i.project_id = ?",
            p.id());

    assertThat(updated).isEqualTo(2);
    assertThat(issueStatusId(todoIssue)).isEqualTo(statusId(p.id(), "TODO"));
    assertThat(issueStatusId(canceledIssue)).isEqualTo(statusId(p.id(), "CANCELED"));
    assertThat(dsl.fetchValue("SELECT project_status_default_id(?, 'DONE')", p.id()))
        .isEqualTo(statusId(p.id(), "DONE"));
  }
}
