package com.workplace.issue.service;

import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.issue.dto.CreateIssueFieldDefRequest;
import com.workplace.issue.exception.FieldNameDuplicatedException;
import com.workplace.issue.exception.FieldOptionInUseException;
import com.workplace.issue.exception.InvalidFieldOptionsException;
import com.workplace.issue.exception.InvalidFieldTypeException;
import com.workplace.issue.exception.TypeImmutableException;
import com.workplace.issue.repository.IssueFieldDefRepository;
import com.workplace.issue.repository.IssueFieldValueRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.dto.AddMemberRequest;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.exception.ProjectAccessDeniedException;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** IssueFieldDefService — OWNER 가드, 5 타입 생성, type immutable, 중복/유효성, 삭제 cascade. */
@Transactional
class IssueFieldDefServiceTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired IssueFieldDefService service;
  @Autowired IssueFieldDefRepository defRepo;
  @Autowired IssueFieldValueRepository valueRepo;
  @Autowired IssueRepository issueRepository;
  @Autowired ProjectService projectService;
  @Autowired ObjectMapper om;

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
    // 테넌트#1 ACTIVE 멤버십 — MembershipGuard(#713) 가 addMember 대상의 테넌트 소속을 검증하므로 필요.
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

  @Test
  void owner_creates_all_five_types() {
    Long owner = createUser("a");
    var p = newProject(owner, "FSA");
    var opts = om.createArrayNode().add("x").add("y");

    var t = service.create(owner, p.key(), new CreateIssueFieldDefRequest("텍", "TEXT", null));
    var n = service.create(owner, p.key(), new CreateIssueFieldDefRequest("숫", "NUMBER", null));
    var d = service.create(owner, p.key(), new CreateIssueFieldDefRequest("날", "DATE", null));
    var s = service.create(owner, p.key(), new CreateIssueFieldDefRequest("선", "SELECT", opts));
    var m =
        service.create(owner, p.key(), new CreateIssueFieldDefRequest("다", "MULTI_SELECT", opts));

    assertThat(t.type()).isEqualTo("TEXT");
    assertThat(n.type()).isEqualTo("NUMBER");
    assertThat(d.type()).isEqualTo("DATE");
    assertThat(s.type()).isEqualTo("SELECT");
    assertThat(m.type()).isEqualTo("MULTI_SELECT");
  }

  @Test
  void member_create_forbidden() {
    Long owner = createUser("b");
    Long member = createUser("b-m");
    var p = newProject(owner, "FSB");
    projectService.addMember(owner, p.key(), new AddMemberRequest(member, "MEMBER"));

    assertThatThrownBy(
            () ->
                service.create(member, p.key(), new CreateIssueFieldDefRequest("x", "TEXT", null)))
        .isInstanceOf(ProjectAccessDeniedException.class);
  }

  @Test
  void select_without_options_throws_400() {
    Long owner = createUser("c");
    var p = newProject(owner, "FSC");

    assertThatThrownBy(
            () ->
                service.create(owner, p.key(), new CreateIssueFieldDefRequest("선", "SELECT", null)))
        .isInstanceOf(InvalidFieldOptionsException.class);
  }

  @Test
  void text_with_options_throws_400() {
    Long owner = createUser("d");
    var p = newProject(owner, "FSD");
    var opts = om.createArrayNode().add("x");

    assertThatThrownBy(
            () -> service.create(owner, p.key(), new CreateIssueFieldDefRequest("텍", "TEXT", opts)))
        .isInstanceOf(InvalidFieldOptionsException.class);
  }

  @Test
  void patch_type_change_throws_400() {
    Long owner = createUser("e");
    var p = newProject(owner, "FSE");
    var created = service.create(owner, p.key(), new CreateIssueFieldDefRequest("x", "TEXT", null));

    assertThatThrownBy(
            () ->
                service.update(
                    owner,
                    p.key(),
                    created.id(),
                    new CreateIssueFieldDefRequest("x", "NUMBER", null)))
        .isInstanceOf(TypeImmutableException.class);
  }

  @Test
  void duplicate_name_throws_409() {
    Long owner = createUser("f");
    var p = newProject(owner, "FSF");
    service.create(owner, p.key(), new CreateIssueFieldDefRequest("공통", "TEXT", null));

    assertThatThrownBy(
            () ->
                service.create(
                    owner, p.key(), new CreateIssueFieldDefRequest("공통", "NUMBER", null)))
        .isInstanceOf(FieldNameDuplicatedException.class);
  }

  @Test
  void invalid_type_throws_400() {
    Long owner = createUser("g");
    var p = newProject(owner, "FSG");

    assertThatThrownBy(
            () ->
                service.create(owner, p.key(), new CreateIssueFieldDefRequest("x", "EMAIL", null)))
        .isInstanceOf(InvalidFieldTypeException.class);
  }

  @Test
  void delete_cascades_values() {
    Long owner = createUser("h");
    var p = newProject(owner, "FSH");
    var def = service.create(owner, p.key(), new CreateIssueFieldDefRequest("x", "TEXT", null));
    var issue = issueRepository.insert(p.id(), 1, "t", null, "MID", null, owner);
    valueRepo.upsert(issue.id(), def.id(), om.valueToTree("v"));

    service.delete(owner, p.key(), def.id());

    assertThat(defRepo.findById(def.id())).isEmpty();
    assertThat(valueRepo.findValuesByIssue(issue.id())).isEmpty();
  }

  // --- #707: 참조 중인 옵션 삭제 하드 블록 ---

  @Test
  void patch_removing_referenced_select_option_throws_and_keeps_options() {
    Long owner = createUser("i");
    var p = newProject(owner, "FSI");
    var opts = om.createArrayNode().add("옵션A").add("옵션B").add("옵션C");
    var def = service.create(owner, p.key(), new CreateIssueFieldDefRequest("선", "SELECT", opts));
    var issue = issueRepository.insert(p.id(), 1, "t", null, "MID", null, owner);
    valueRepo.upsert(issue.id(), def.id(), om.valueToTree("옵션C"));

    var shrunk = om.createArrayNode().add("옵션A").add("옵션B");
    assertThatThrownBy(
            () ->
                service.update(
                    owner,
                    p.key(),
                    def.id(),
                    new CreateIssueFieldDefRequest("선", "SELECT", shrunk)))
        .isInstanceOf(FieldOptionInUseException.class)
        .hasMessageContaining("옵션C");

    // 삭제가 차단되었으므로 정의는 원래 옵션 3개를 그대로 유지해야 한다.
    assertThat(defRepo.findById(def.id()).orElseThrow().options().size()).isEqualTo(3);
    assertThat(valueRepo.findValuesByIssue(issue.id()).get(def.id()).asText()).isEqualTo("옵션C");
  }

  @Test
  void patch_removing_referenced_multi_select_option_throws() {
    Long owner = createUser("j");
    var p = newProject(owner, "FSJ");
    var opts = om.createArrayNode().add("라벨1").add("라벨2").add("라벨3");
    var def =
        service.create(owner, p.key(), new CreateIssueFieldDefRequest("다", "MULTI_SELECT", opts));
    var issue = issueRepository.insert(p.id(), 1, "t", null, "MID", null, owner);
    valueRepo.upsert(issue.id(), def.id(), om.createArrayNode().add("라벨2").add("라벨3"));

    var shrunk = om.createArrayNode().add("라벨1").add("라벨2");
    assertThatThrownBy(
            () ->
                service.update(
                    owner,
                    p.key(),
                    def.id(),
                    new CreateIssueFieldDefRequest("다", "MULTI_SELECT", shrunk)))
        .isInstanceOf(FieldOptionInUseException.class)
        .hasMessageContaining("라벨3");
  }

  @Test
  void patch_removing_unreferenced_option_succeeds() {
    Long owner = createUser("k");
    var p = newProject(owner, "FSK");
    var opts = om.createArrayNode().add("옵션A").add("옵션B").add("옵션C");
    var def = service.create(owner, p.key(), new CreateIssueFieldDefRequest("선", "SELECT", opts));
    var issue = issueRepository.insert(p.id(), 1, "t", null, "MID", null, owner);
    valueRepo.upsert(issue.id(), def.id(), om.valueToTree("옵션A"));

    var shrunk = om.createArrayNode().add("옵션A").add("옵션B");
    var updated =
        service.update(
            owner, p.key(), def.id(), new CreateIssueFieldDefRequest("선", "SELECT", shrunk));

    assertThat(updated.options().size()).isEqualTo(2);
  }
}
