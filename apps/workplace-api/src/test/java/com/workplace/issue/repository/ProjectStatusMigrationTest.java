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
import com.workplace.support.TestFixtures;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.transaction.annotation.Transactional;

/**
 * V204 project_status 마이그레이션 통합 테스트(WP-807).
 *
 * <p>새 프로젝트 4상태 시드 트리거, 복합 FK(id, project_id, category) 의 범주·프로젝트 정합, 이름 유일·길이 제약, 백필 SQL 을 DB 수준에서
 * 고정한다. 구 파드 호환용 status ↔ status_id 동기화 트리거는 V208 에서 걷어냈다(WP-868) — 이제 쓰는 쪽이 status_id 를 반드시 함께 준다.
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

  /** 프로젝트의 범주 기본 상태(시드된 행) id — 시드 공용식 {@link TestFixtures#defaultStatusId} 를 그대로 쓴다. */
  private Long statusId(Long projectId, String category) {
    return dsl.fetchValue(TestFixtures.defaultStatusId(projectId, category));
  }

  /** 범주의 기본 상태(status_id)와 함께 이슈를 직접 넣는다 — 호환 트리거가 없어 status_id 를 빼면 NOT NULL 에 걸린다(WP-868). */
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
        .set(ISSUE.STATUS_ID, statusId(projectId, status))
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

  /**
   * project_status 에 FORCE RLS 가 걸린다(V182·V197 패턴) — 시드 트리거는 GUC 아래 NEW.tenant_id 로 써서 그대로 통과한다.
   */
  @Test
  void project_status_는_RLS_가_강제된다() {
    assertThat(
            dsl.fetchOne("select relforcerowsecurity from pg_class where relname='project_status'")
                .get(0, Boolean.class))
        .isTrue();
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
  void 호환_트리거와_함수는_V208에서_사라졌다() {
    // V208 의 DROP 이 시그니처 불일치 등으로 조용히 건너뛰지 않았는지 카탈로그로 직접 확인한다(WP-868).
    assertThat(
            dsl.fetchCount(
                dsl.selectFrom("pg_trigger").where("tgname = 'trg_issue_status_id_sync'")))
        .isZero();
    assertThat(
            dsl.fetchCount(
                dsl.selectFrom("pg_proc")
                    .where("proname in ('issue_status_id_sync', 'project_status_default_id')")))
        .isZero();
    // 새 프로젝트 시드 트리거는 남는다.
    assertThat(
            dsl.fetchCount(
                dsl.selectFrom("pg_trigger").where("tgname = 'trg_project_seed_statuses'")))
        .isOne();
  }

  @Test
  void status_id_없이_INSERT하면_NOT_NULL이_거절한다() {
    Long owner = createUser("ps-c");
    ProjectResponse p = newProject(owner, "PSC");
    Long typeId =
        dsl.select(ISSUE_TYPE_DEF.ID)
            .from(ISSUE_TYPE_DEF)
            .where(ISSUE_TYPE_DEF.PROJECT_ID.eq(p.id()))
            .limit(1)
            .fetchOne(ISSUE_TYPE_DEF.ID);

    // 호환 트리거가 없으므로 범주만 주면 status_id 를 채워 주는 쪽이 없다(WP-868).
    assertThatThrownBy(
            () ->
                dsl.insertInto(ISSUE)
                    .set(ISSUE.PROJECT_ID, p.id())
                    .set(ISSUE.NUMBER, 1)
                    .set(ISSUE.TITLE, "no-status-id")
                    .set(ISSUE.STATUS, "DONE")
                    .set(ISSUE.PRIORITY, "MID")
                    .set(ISSUE.REPORTER_ID, owner)
                    .set(ISSUE.TYPE_ID, typeId)
                    .execute())
        .isInstanceOf(DataIntegrityViolationException.class);
  }

  @Test
  void status만_다른_범주로_UPDATE하면_FK가_거절한다() {
    Long owner = createUser("ps-d");
    ProjectResponse p = newProject(owner, "PSD");
    Long issueId = insertIssue(p.id(), owner, 1, "TODO");

    // 범주만 바꾸면 status_id(할 일 상태)와 범주가 어긋나 복합 FK 가 막는다 — 예전엔 트리거가 범주 기본 상태로 맞췄다(WP-868).
    assertThatThrownBy(
            () ->
                dsl.update(ISSUE)
                    .set(ISSUE.STATUS, "IN_PROGRESS")
                    .where(ISSUE.ID.eq(issueId))
                    .execute())
        .isInstanceOf(DataIntegrityViolationException.class);
  }

  @Test
  void 범주가_어긋난_status_id를_명시하면_FK가_거절한다() {
    Long owner = createUser("ps-e");
    ProjectResponse p = newProject(owner, "PSE");
    Long issueId = insertIssue(p.id(), owner, 1, "TODO");
    Long doneId = statusId(p.id(), "DONE");

    // 범주 불일치는 복합 FK 가 막는다.
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

    // 상태 범주 변경(WP-811) — ON UPDATE CASCADE 가 issue.status 로 전파되고 status_id 는 그대로다.
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
    // 마이그레이션 시점엔 기존 데이터가 없어 백필을 직접 볼 수 없다 — V204 의 백필 UPDATE 를 이 프로젝트로 좁혀 그대로 돌려
    // (project_id, status) 로 대응 범주의 시드 상태를 고르는지 확인한다.
    int updated =
        dsl.execute(
            "UPDATE issue i SET status_id = ps.id FROM project_status ps "
                + "WHERE ps.project_id = i.project_id AND ps.category = i.status AND i.project_id = ?",
            p.id());

    assertThat(updated).isEqualTo(2);
    assertThat(issueStatusId(todoIssue)).isEqualTo(statusId(p.id(), "TODO"));
    assertThat(issueStatusId(canceledIssue)).isEqualTo(statusId(p.id(), "CANCELED"));
  }

  // ---- V206 상태 색(WP-809) ----

  @Test
  void 새프로젝트_시드상태는_범주색을_가진다() {
    Long owner = createUser("ps-k");
    ProjectResponse p = newProject(owner, "PSL");

    var rows =
        dsl.select(PROJECT_STATUS.NAME, PROJECT_STATUS.COLOR)
            .from(PROJECT_STATUS)
            .where(PROJECT_STATUS.PROJECT_ID.eq(p.id()))
            .orderBy(PROJECT_STATUS.POSITION)
            .fetch();

    assertThat(rows)
        .extracting(r -> r.get(PROJECT_STATUS.NAME), r -> r.get(PROJECT_STATUS.COLOR))
        .containsExactly(
            tuple("할 일", "GRAY"), tuple("진행 중", "BLUE"), tuple("완료", "GREEN"), tuple("취소", "GRAY"));
  }

  @Test
  void color없이_INSERT하면_GRAY_기본값() {
    Long owner = createUser("ps-l");
    ProjectResponse p = newProject(owner, "PSM");
    // 롤링 배포 중 color 를 모르는 구 파드의 INSERT 흉내 — DEFAULT 가 있어 깨지지 않고 GRAY 가 된다
    String color =
        dsl.insertInto(PROJECT_STATUS)
            .set(PROJECT_STATUS.PROJECT_ID, p.id())
            .set(PROJECT_STATUS.NAME, "검토 중")
            .set(PROJECT_STATUS.CATEGORY, "IN_PROGRESS")
            .set(PROJECT_STATUS.POSITION, 4)
            .returning(PROJECT_STATUS.COLOR)
            .fetchOne()
            .getColor();

    assertThat(color).isEqualTo("GRAY");
  }

  @Test
  void 색_backfill_SQL은_범주별_기본색을_넣는다() {
    Long owner = createUser("ps-m");
    ProjectResponse p = newProject(owner, "PSN");
    // 마이그레이션 시점의 기존 행은 DEFAULT GRAY 로 채워진 상태 — 그것을 흉내 낸 뒤 V206 백필 UPDATE 를 이 프로젝트로 좁혀 돌린다
    dsl.update(PROJECT_STATUS)
        .set(PROJECT_STATUS.COLOR, "GRAY")
        .where(PROJECT_STATUS.PROJECT_ID.eq(p.id()))
        .execute();
    dsl.execute(
        "UPDATE project_status SET color = CASE category WHEN 'IN_PROGRESS' THEN 'BLUE' "
            + "WHEN 'DONE' THEN 'GREEN' ELSE 'GRAY' END WHERE project_id = ?",
        p.id());

    assertThat(
            dsl.select(PROJECT_STATUS.CATEGORY, PROJECT_STATUS.COLOR)
                .from(PROJECT_STATUS)
                .where(PROJECT_STATUS.PROJECT_ID.eq(p.id()))
                .orderBy(PROJECT_STATUS.POSITION)
                .fetch())
        .extracting(r -> r.get(PROJECT_STATUS.CATEGORY), r -> r.get(PROJECT_STATUS.COLOR))
        .containsExactly(
            tuple("TODO", "GRAY"),
            tuple("IN_PROGRESS", "BLUE"),
            tuple("DONE", "GREEN"),
            tuple("CANCELED", "GRAY"));
  }
}
