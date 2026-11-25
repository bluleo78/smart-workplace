package com.workplace.issue.service;

import static com.workplace.jooq.Tables.ISSUE_RELATION;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.issue.domain.IssueRelationBuiltIns;
import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.dto.IssueResponse;
import com.workplace.issue.exception.InvalidTypeForProjectException;
import com.workplace.issue.exception.SubtaskConversionRequiredException;
import com.workplace.issue.repository.IssueHistoryRepository;
import com.workplace.issue.repository.IssueRelationTypeRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.issue.repository.IssueTypeRepository;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.exception.ProjectNotFoundException;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/** WP-2098 — 하위 태스크가 달린 이슈를 에픽으로 바꿀 때 하위 태스크를 함께 일반 유형으로 바꾸는 옵션(convertSubtasksToTypeId). */
class IssueSetTypeConvertSubtasksTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired IssueService issueService;
  @Autowired IssueTypeRepository typeRepository;
  @Autowired IssueHistoryRepository historyRepository;
  @Autowired ProjectService projectService;
  @Autowired IssueRepository issueRepository;
  @Autowired IssueRelationTypeRepository relationTypeRepository;

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

  private ProjectResponse newProject(Long ownerId, String prefix) {
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 4);
    String key = (prefix + suffix).substring(0, Math.min(10, (prefix + suffix).length()));
    return projectService.create(ownerId, new CreateProjectRequest(key, "P-" + prefix, "x"));
  }

  private Long typeId(ProjectResponse p, String name) {
    return typeRepository.findByProjectAndName(p.id(), name).orElseThrow().id();
  }

  private IssueResponse issue(
      Long owner, ProjectResponse p, String title, Long typeId, Integer parentNumber) {
    return issueService.create(
        owner,
        p.key(),
        new CreateIssueRequest(title, null, null, null, null, typeId, parentNumber, null));
  }

  private int typeChangedCount(Long issueId) {
    return (int)
        historyRepository.findByIssue(issueId).stream()
            .filter(h -> "TYPE_CHANGED".equals(h.eventType()))
            .count();
  }

  @Test
  void converts_subtasks_and_becomes_epic() {
    Long owner = createUser("a");
    var p = newProject(owner, "CVA");
    Long epicId = typeId(p, "EPIC");
    Long taskId = typeId(p, "TASK");
    Long subId = typeId(p, "SUBTASK");
    var e = issue(owner, p, "e", epicId, null);
    var t = issue(owner, p, "t", taskId, e.number());
    var s1 = issue(owner, p, "s1", subId, t.number());
    var s2 = issue(owner, p, "s2", subId, t.number());
    issueService.updateStatus(owner, p.key(), s2.number(), "DONE");

    issueService.setType(owner, p.key(), t.number(), epicId, null, null, true, taskId);

    var tRow = issueRepository.findById(t.id()).orElseThrow();
    assertThat(tRow.typeId()).isEqualTo(epicId);
    assertThat(tRow.parentIssueId()).isNull();
    for (var child : List.of(s1, s2)) {
      assertThat(issueRepository.findById(child.id()).orElseThrow().parentIssueId())
          .isEqualTo(t.id());
    }
    assertThat(issueRepository.findById(s1.id()).orElseThrow().typeId()).isEqualTo(taskId);
    assertThat(issueRepository.findById(s2.id()).orElseThrow().typeId()).isEqualTo(taskId);
    assertThat(typeChangedCount(s1.id())).isEqualTo(1);
    assertThat(typeChangedCount(s2.id())).isEqualTo(1);
    assertThat(historyRepository.findByIssue(t.id()))
        .anyMatch(h -> "PARENT_CHANGED".equals(h.eventType()));
    // relateToReleasedParent=true — 옛 상위(E)와 T 사이에 RELATES 관계가 남는다.
    long lo = Math.min(t.id(), e.id());
    long hi = Math.max(t.id(), e.id());
    long relatesType =
        relationTypeRepository.findByCode(IssueRelationBuiltIns.RELATES).orElseThrow().id();
    assertThat(
            dsl.selectCount()
                .from(ISSUE_RELATION)
                .where(ISSUE_RELATION.TYPE_ID.eq(relatesType))
                .and(ISSUE_RELATION.SOURCE_ISSUE_ID.eq(lo))
                .and(ISSUE_RELATION.TARGET_ISSUE_ID.eq(hi))
                .fetchOne(0, Integer.class))
        .isEqualTo(1);
  }

  /** 호출자가 읽을 수 없는 프로젝트의 하위 태스크 키는 드러내지 않고 「외 n개」에만 센다. */
  @Test
  void unreadable_subtask_keys_are_hidden_but_counted() {
    Long owner = createUser("u");
    Long stranger = createUser("u2");
    var p = newProject(owner, "CVJ");
    var foreign = newProject(stranger, "CVK");
    Long epicId = typeId(p, "EPIC");
    Long taskId = typeId(p, "TASK");
    Long subId = typeId(p, "SUBTASK");
    var t = issue(owner, p, "t", taskId, null);
    var s1 = issue(owner, p, "s1", subId, t.number());
    var s2 = issue(owner, p, "s2", subId, t.number());
    var fTask = issue(stranger, foreign, "ft", typeId(foreign, "TASK"), null);
    var fSub = issue(stranger, foreign, "fs", typeId(foreign, "SUBTASK"), fTask.number());
    issueRepository.updateParent(fSub.id(), t.id());
    String k1 = p.key() + "-" + s1.number();
    String k2 = p.key() + "-" + s2.number();

    assertThatThrownBy(() -> issueService.setType(owner, p.key(), t.number(), epicId))
        .isInstanceOfSatisfying(
            SubtaskConversionRequiredException.class,
            ex -> {
              assertThat(ex.getIssueKeys()).containsExactly(k1, k2);
              assertThat(ex.getMessage())
                  .isEqualTo("하위 태스크 " + k1 + ", " + k2 + " 외 1개가 있어 에픽으로 바꿀 수 없습니다");
              assertThat(ex.getMessage()).doesNotContain(foreign.key());
            });
  }

  @Test
  void without_option_throws_conversion_required_with_keys() {
    Long owner = createUser("b");
    var p = newProject(owner, "CVB");
    Long epicId = typeId(p, "EPIC");
    Long taskId = typeId(p, "TASK");
    Long subId = typeId(p, "SUBTASK");
    var t = issue(owner, p, "t", taskId, null);
    var s = new java.util.ArrayList<IssueResponse>();
    for (int i = 0; i < 4; i++) s.add(issue(owner, p, "s" + i, subId, t.number()));
    String k1 = p.key() + "-" + s.get(0).number();
    String k2 = p.key() + "-" + s.get(1).number();
    String k3 = p.key() + "-" + s.get(2).number();
    String k4 = p.key() + "-" + s.get(3).number();

    assertThatThrownBy(() -> issueService.setType(owner, p.key(), t.number(), epicId))
        .isInstanceOfSatisfying(
            SubtaskConversionRequiredException.class,
            ex -> {
              assertThat(ex.getIssueKeys()).containsExactly(k1, k2, k3, k4);
              assertThat(ex.getMessage())
                  .isEqualTo("하위 태스크 " + k1 + ", " + k2 + ", " + k3 + " 외 1개가 있어 에픽으로 바꿀 수 없습니다");
            });
    assertThat(issueRepository.findById(t.id()).orElseThrow().typeId()).isEqualTo(taskId);
  }

  @Test
  void three_or_fewer_keys_have_no_remainder_phrase() {
    var ex = new SubtaskConversionRequiredException(List.of("A-1", "A-2", "A-3"));
    assertThat(ex.getMessage()).doesNotContain("외 ").contains("A-1, A-2, A-3");
  }

  /** 남는 것이 없으면 조사를 「개」 뒤에 붙인다 — 키 끝 숫자의 소리(1·3 → 「이」)에 따라 「가」가 틀리지 않게. */
  @Test
  void message_without_remainder_puts_particle_after_count() {
    assertThat(new SubtaskConversionRequiredException(List.of("A-11")).getMessage())
        .isEqualTo("하위 태스크 1개(A-11)가 있어 에픽으로 바꿀 수 없습니다");
    assertThat(new SubtaskConversionRequiredException(List.of("A-1", "A-3")).getMessage())
        .isEqualTo("하위 태스크 2개(A-1, A-3)가 있어 에픽으로 바꿀 수 없습니다");
  }

  @Test
  void rejects_invalid_target_type_and_changes_nothing() {
    Long owner = createUser("c");
    var p = newProject(owner, "CVC");
    var other = newProject(owner, "CVD");
    Long epicId = typeId(p, "EPIC");
    Long taskId = typeId(p, "TASK");
    Long subId = typeId(p, "SUBTASK");
    var t = issue(owner, p, "t", taskId, null);
    var s = issue(owner, p, "s", subId, t.number());

    for (Long bad : List.of(epicId, subId, typeId(other, "TASK"))) {
      assertThatThrownBy(
              () ->
                  issueService.setType(owner, p.key(), t.number(), epicId, null, null, false, bad))
          .isInstanceOf(InvalidTypeForProjectException.class);
    }
    assertThat(issueRepository.findById(t.id()).orElseThrow().typeId()).isEqualTo(taskId);
    assertThat(issueRepository.findById(s.id()).orElseThrow().typeId()).isEqualTo(subId);
  }

  /** 하위 태스크가 없어도 잘못된 대상 유형은 400 — 같은 요청이 하위 유무에 따라 200·400 으로 갈리지 않는다. */
  @Test
  void rejects_invalid_target_type_even_without_subtasks() {
    Long owner = createUser("c3");
    var p = newProject(owner, "CVL");
    Long epicId = typeId(p, "EPIC");
    Long taskId = typeId(p, "TASK");
    var t = issue(owner, p, "t", taskId, null);

    assertThatThrownBy(
            () ->
                issueService.setType(
                    owner, p.key(), t.number(), epicId, null, null, false, typeId(p, "SUBTASK")))
        .isInstanceOf(InvalidTypeForProjectException.class);
    assertThat(issueRepository.findById(t.id()).orElseThrow().typeId()).isEqualTo(taskId);
  }

  @Test
  void rolls_back_when_a_child_cannot_be_converted() {
    Long owner = createUser("d");
    Long stranger = createUser("d2");
    var p = newProject(owner, "CVE");
    var foreign = newProject(stranger, "CVF");
    Long epicId = typeId(p, "EPIC");
    Long taskId = typeId(p, "TASK");
    Long subId = typeId(p, "SUBTASK");
    var t = issue(owner, p, "t", taskId, null);
    var s1 = issue(owner, p, "s1", subId, t.number());
    // 다른 프로젝트의 하위 태스크 — 호출자(owner)는 그 프로젝트 멤버가 아니다.
    var fTask = issue(stranger, foreign, "ft", typeId(foreign, "TASK"), null);
    var fSub = issue(stranger, foreign, "fs", typeId(foreign, "SUBTASK"), fTask.number());
    issueRepository.updateParent(fSub.id(), t.id());

    assertThatThrownBy(
            () ->
                issueService.setType(owner, p.key(), t.number(), epicId, null, null, false, taskId))
        .isInstanceOf(ProjectNotFoundException.class);

    assertThat(issueRepository.findById(t.id()).orElseThrow().typeId()).isEqualTo(taskId);
    assertThat(issueRepository.findById(s1.id()).orElseThrow().typeId()).isEqualTo(subId);
  }

  @Test
  void cross_project_subtask_uses_same_named_type() {
    Long owner = createUser("e");
    var p = newProject(owner, "CVG");
    var other = newProject(owner, "CVH");
    Long epicId = typeId(p, "EPIC");
    Long taskId = typeId(p, "TASK");
    var t = issue(owner, p, "t", taskId, null);
    var oTask = issue(owner, other, "ot", typeId(other, "TASK"), null);
    var oSub = issue(owner, other, "os", typeId(other, "SUBTASK"), oTask.number());
    issueRepository.updateParent(oSub.id(), t.id());

    issueService.setType(owner, p.key(), t.number(), epicId, null, null, false, taskId);

    assertThat(issueRepository.findById(t.id()).orElseThrow().typeId()).isEqualTo(epicId);
    assertThat(issueRepository.findById(oSub.id()).orElseThrow().typeId())
        .isEqualTo(typeId(other, "TASK"));
    assertThat(typeChangedCount(oSub.id())).isEqualTo(1);
  }

  /** 하위 태스크가 없으면 옵션이 있어도 그냥 에픽이 된다(변환 뒤 재검증이 자식을 다시 읽어도 통과). */
  @Test
  void option_with_no_subtasks_just_becomes_epic() {
    Long owner = createUser("f");
    var p = newProject(owner, "CVI");
    Long epicId = typeId(p, "EPIC");
    Long taskId = typeId(p, "TASK");
    var t = issue(owner, p, "t", taskId, null);

    issueService.setType(owner, p.key(), t.number(), epicId, null, null, false, taskId);

    assertThat(issueRepository.findById(t.id()).orElseThrow().typeId()).isEqualTo(epicId);
  }
}
