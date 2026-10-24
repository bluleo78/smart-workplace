package com.workplace.label.service;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_HISTORY;
import static com.workplace.jooq.Tables.ISSUE_LABEL;
import static com.workplace.jooq.Tables.LABEL;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.issue.repository.IssueRepository;
import com.workplace.issue.support.IssueSeeds;
import com.workplace.label.dto.CreateLabelRequest;
import com.workplace.label.exception.InvalidColorTokenException;
import com.workplace.label.exception.LabelNameDuplicatedException;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.exception.ProjectAccessDeniedException;
import com.workplace.project.exception.ProjectNotFoundException;
import com.workplace.project.repository.ProjectMemberRepository;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** LabelService 통합 테스트 — 생성(멤버)·수정/삭제(OWNER 또는 만든 사람) 가드, 중복/색상 검증. */
@Transactional
class LabelServiceTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired LabelService labelService;
  @Autowired ProjectService projectService;
  @Autowired ProjectMemberRepository memberRepository;
  @Autowired IssueRepository issueRepository;

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

  @Test
  void owner_can_create_label() {
    Long owner = createUser("o");
    ProjectResponse p = newProject(owner, "LA");

    var resp = labelService.create(owner, p.key(), new CreateLabelRequest("버그", "RED"));
    assertThat(resp.name()).isEqualTo("버그");
    assertThat(resp.colorToken()).isEqualTo("RED");
  }

  @Test
  void member_can_create_and_is_recorded_as_creator() {
    Long owner = createUser("o2");
    Long member = createUser("m2");
    ProjectResponse p = newProject(owner, "LB");
    memberRepository.insert(p.id(), member, "MEMBER");

    var resp = labelService.create(member, p.key(), new CreateLabelRequest("ai-fix", "GRAY"));
    assertThat(resp.viewerCanManage()).isTrue();
    assertThat(
            dsl.select(LABEL.CREATED_BY)
                .from(LABEL)
                .where(LABEL.ID.eq(resp.id()))
                .fetchOne(LABEL.CREATED_BY))
        .isEqualTo(member);
  }

  @Test
  void non_member_cannot_create() {
    Long owner = createUser("o6");
    Long outsider = createUser("x6");
    ProjectResponse p = newProject(owner, "LG");

    assertThatThrownBy(
            () -> labelService.create(outsider, p.key(), new CreateLabelRequest("버그", "RED")))
        .isInstanceOf(ProjectNotFoundException.class);
  }

  @Test
  void creator_member_can_update_and_delete_own_label() {
    Long owner = createUser("o7");
    Long member = createUser("m7");
    ProjectResponse p = newProject(owner, "LH");
    memberRepository.insert(p.id(), member, "MEMBER");
    var label = labelService.create(member, p.key(), new CreateLabelRequest("ai-fix", "GRAY"));

    var updated =
        labelService.update(
            member, p.key(), label.id(), new CreateLabelRequest("ai-fixed", "GREEN"));
    assertThat(updated.name()).isEqualTo("ai-fixed");
    assertThat(updated.colorToken()).isEqualTo("GREEN");

    labelService.delete(member, p.key(), label.id());
    assertThat(labelService.list(owner, p.key())).isEmpty();
  }

  /** WP-488 — 라벨 삭제는 붙어 있던 이슈 이력에 「라벨 제거」를 남기고, 확인창용 이슈 수를 센다(삭제된 이슈 제외). */
  @Test
  void delete_records_label_removal_history_and_counts_issues() {
    Long owner = createUser("o10");
    ProjectResponse p = newProject(owner, "LK");
    var label = labelService.create(owner, p.key(), new CreateLabelRequest("버그", "RED"));
    Long live =
        IssueSeeds.insert(issueRepository, baseDsl, p.id(), 1, "a", null, "MID", null, owner).id();
    Long gone =
        IssueSeeds.insert(issueRepository, baseDsl, p.id(), 2, "b", null, "MID", null, owner).id();
    dsl.insertInto(ISSUE_LABEL)
        .set(ISSUE_LABEL.ISSUE_ID, live)
        .set(ISSUE_LABEL.LABEL_ID, label.id())
        .execute();
    dsl.insertInto(ISSUE_LABEL)
        .set(ISSUE_LABEL.ISSUE_ID, gone)
        .set(ISSUE_LABEL.LABEL_ID, label.id())
        .execute();
    dsl.update(ISSUE)
        .set(ISSUE.DELETED_AT, java.time.OffsetDateTime.now())
        .where(ISSUE.ID.eq(gone))
        .execute();

    assertThat(labelService.issueCount(owner, p.key(), label.id())).isEqualTo(1);

    labelService.delete(owner, p.key(), label.id());

    var history =
        dsl.selectFrom(ISSUE_HISTORY)
            .where(ISSUE_HISTORY.ISSUE_ID.eq(live), ISSUE_HISTORY.EVENT_TYPE.eq("LABELS_CHANGED"))
            .fetch();
    assertThat(history).hasSize(1);
    assertThat(history.get(0).getActorId()).isEqualTo(owner);
    assertThat(history.get(0).getToValue()).contains("\"removed\"").contains("버그");
  }

  @Test
  void other_member_cannot_update_or_delete_label_they_did_not_create() {
    Long owner = createUser("o8");
    Long creator = createUser("c8");
    Long other = createUser("m8");
    ProjectResponse p = newProject(owner, "LI");
    memberRepository.insert(p.id(), creator, "MEMBER");
    memberRepository.insert(p.id(), other, "MEMBER");
    var label = labelService.create(creator, p.key(), new CreateLabelRequest("ai-fix", "GRAY"));

    assertThatThrownBy(
            () ->
                labelService.update(other, p.key(), label.id(), new CreateLabelRequest("x", "RED")))
        .isInstanceOf(ProjectAccessDeniedException.class);
    assertThatThrownBy(() -> labelService.delete(other, p.key(), label.id()))
        .isInstanceOf(ProjectAccessDeniedException.class);
  }

  @Test
  void owner_can_update_and_delete_label_created_by_member() {
    Long owner = createUser("o9");
    Long member = createUser("m9");
    ProjectResponse p = newProject(owner, "LJ");
    memberRepository.insert(p.id(), member, "MEMBER");
    var label = labelService.create(member, p.key(), new CreateLabelRequest("ai-fix", "GRAY"));

    labelService.update(owner, p.key(), label.id(), new CreateLabelRequest("ai-fix", "RED"));
    labelService.delete(owner, p.key(), label.id());
    assertThat(labelService.list(owner, p.key())).isEmpty();
  }

  @Test
  void creator_who_left_project_can_no_longer_update() {
    Long owner = createUser("o10");
    Long member = createUser("m10");
    ProjectResponse p = newProject(owner, "LK");
    memberRepository.insert(p.id(), member, "MEMBER");
    var label = labelService.create(member, p.key(), new CreateLabelRequest("ai-fix", "GRAY"));
    memberRepository.delete(p.id(), member);

    assertThatThrownBy(
            () ->
                labelService.update(
                    member, p.key(), label.id(), new CreateLabelRequest("x", "RED")))
        .isInstanceOf(ProjectNotFoundException.class);
  }

  @Test
  void legacy_label_without_creator_is_owner_only() {
    Long owner = createUser("o11");
    Long member = createUser("m11");
    ProjectResponse p = newProject(owner, "LL");
    memberRepository.insert(p.id(), member, "MEMBER");
    var label = labelService.create(owner, p.key(), new CreateLabelRequest("버그", "RED"));
    // WP-394 이전에 만든 라벨 — 만든 사람 기록이 없다.
    dsl.update(LABEL).setNull(LABEL.CREATED_BY).where(LABEL.ID.eq(label.id())).execute();

    assertThatThrownBy(
            () ->
                labelService.update(
                    member, p.key(), label.id(), new CreateLabelRequest("x", "RED")))
        .isInstanceOf(ProjectAccessDeniedException.class);
    assertThat(labelService.list(member, p.key()).get(0).viewerCanManage()).isFalse();
    assertThat(labelService.list(owner, p.key()).get(0).viewerCanManage()).isTrue();
  }

  @Test
  void list_marks_only_labels_viewer_can_manage() {
    Long owner = createUser("o12");
    Long member = createUser("m12");
    ProjectResponse p = newProject(owner, "LM");
    memberRepository.insert(p.id(), member, "MEMBER");
    labelService.create(owner, p.key(), new CreateLabelRequest("a-owner", "RED"));
    labelService.create(member, p.key(), new CreateLabelRequest("b-member", "GRAY"));

    var forMember = labelService.list(member, p.key());
    assertThat(forMember)
        .extracting(l -> l.name() + "=" + l.viewerCanManage())
        .containsExactly("a-owner=false", "b-member=true");
    var forOwner = labelService.list(owner, p.key());
    assertThat(forOwner)
        .extracting(l -> l.name() + "=" + l.viewerCanManage())
        .containsExactly("a-owner=true", "b-member=true");
  }

  @Test
  void duplicate_name_in_same_project_throws_409() {
    Long owner = createUser("o3");
    ProjectResponse p = newProject(owner, "LC");
    labelService.create(owner, p.key(), new CreateLabelRequest("버그", "RED"));

    assertThatThrownBy(
            () -> labelService.create(owner, p.key(), new CreateLabelRequest("버그", "BLUE")))
        .isInstanceOf(LabelNameDuplicatedException.class);
  }

  /** WP-911 — 대소문자만 다른 이름으로 새로 만들면 409. (한 테스트에 위반 한 번 — 위반 뒤 트랜잭션이 깨진다) */
  @Test
  void case_only_different_name_on_create_throws_409() {
    Long owner = createUser("o3c");
    ProjectResponse p = newProject(owner, "LCC");
    labelService.create(owner, p.key(), new CreateLabelRequest("DupL", "RED"));

    assertThatThrownBy(
            () -> labelService.create(owner, p.key(), new CreateLabelRequest("dupl", "BLUE")))
        .isInstanceOf(LabelNameDuplicatedException.class);
  }

  /** WP-911 — 다른 라벨 이름을 대소문자만 다르게 바꿔도 409. */
  @Test
  void case_only_different_name_on_update_throws_409() {
    Long owner = createUser("o3d");
    ProjectResponse p = newProject(owner, "LCD");
    labelService.create(owner, p.key(), new CreateLabelRequest("DupL", "RED"));
    var other = labelService.create(owner, p.key(), new CreateLabelRequest("other", "RED"));

    assertThatThrownBy(
            () ->
                labelService.update(
                    owner, p.key(), other.id(), new CreateLabelRequest("DUPL", "BLUE")))
        .isInstanceOf(LabelNameDuplicatedException.class);
  }

  @Test
  void invalid_color_token_throws_400() {
    Long owner = createUser("o4");
    ProjectResponse p = newProject(owner, "LD");

    assertThatThrownBy(
            () -> labelService.create(owner, p.key(), new CreateLabelRequest("버그", "MAGENTA")))
        .isInstanceOf(InvalidColorTokenException.class);
  }

  @Test
  void same_name_across_different_projects_allowed() {
    Long owner = createUser("o5");
    ProjectResponse p1 = newProject(owner, "LE");
    ProjectResponse p2 = newProject(owner, "LF");

    labelService.create(owner, p1.key(), new CreateLabelRequest("버그", "RED"));
    var r = labelService.create(owner, p2.key(), new CreateLabelRequest("버그", "BLUE"));
    assertThat(r.id()).isNotNull();
  }
}
