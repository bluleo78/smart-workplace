package com.workplace.project.outbound;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.after;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;

import com.workplace.global.outbound.AiAgentEventClient;
import com.workplace.global.realtime.SseRegistry;
import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.service.IssueService;
import com.workplace.label.dto.CreateLabelRequest;
import com.workplace.label.service.LabelService;
import com.workplace.milestone.dto.CreateMilestoneRequest;
import com.workplace.milestone.service.MilestoneService;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.repository.ProjectMemberRepository;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.view.dto.SaveViewRequest;
import com.workplace.view.service.SavedViewService;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * WP-60 통합 — 프로젝트·멤버·설정·저장된 뷰 변경 → AFTER_COMMIT resource.changed 수신자 검증. AFTER_COMMIT 발화를 위해
 * 클래스에 @Transactional 을 붙이지 않는다.
 */
@DisplayName("프로젝트 설정 변경 → resource.changed fan-out 통합")
class ProjectResourceChangedIntegrationTest extends IntegrationTestBase {

  @MockitoBean SseRegistry registry;
  @MockitoBean AiAgentEventClient aiClient; // ai-agent 실제 호출 차단

  @Autowired DSLContext dsl;
  @Autowired PlatformTransactionManager txManager;
  @Autowired ProjectService projectService;
  @Autowired ProjectMemberRepository memberRepository;
  @Autowired LabelService labelService;
  @Autowired MilestoneService milestoneService;
  @Autowired SavedViewService savedViewService;
  @Autowired IssueService issueService;

  private final List<Long> createdUserIds = new ArrayList<>();
  private final List<Long> createdProjectIds = new ArrayList<>();
  private Long owner;
  private Long viewer;
  private String key;

  @BeforeEach
  void seed() {
    owner = createHuman("owner");
    viewer = createHuman("viewer");
    var proj = projectService.create(owner, new CreateProjectRequest(uniqueKey("WP"), "P-pc", "x"));
    createdProjectIds.add(proj.id());
    memberRepository.insert(proj.id(), viewer, "MEMBER");
    key = proj.key();
  }

  @AfterEach
  void cleanup() {
    dsl.deleteFrom(ISSUE).where(ISSUE.PROJECT_ID.in(createdProjectIds)).execute();
    dsl.deleteFrom(PROJECT).where(PROJECT.ID.in(createdProjectIds)).execute();
    dsl.deleteFrom(USER_ROLE).where(USER_ROLE.USER_ID.in(createdUserIds)).execute();
    dsl.deleteFrom(USER).where(USER.ID.in(createdUserIds)).execute();
    createdProjectIds.clear();
    createdUserIds.clear();
  }

  /** resource/op 조합의 resource.changed 수신자를 캡처한다. */
  @SuppressWarnings("unchecked")
  private Collection<Long> captureRecipients(String resource, String op) {
    ArgumentCaptor<Collection<Long>> ids = ArgumentCaptor.forClass(Collection.class);
    ArgumentCaptor<Object> payload = ArgumentCaptor.forClass(Object.class);
    verify(registry, timeout(2000).atLeastOnce())
        .fanOut(ids.capture(), eq("resource.changed"), payload.capture());
    for (int i = 0; i < payload.getAllValues().size(); i++) {
      var p = (Map<String, Object>) payload.getAllValues().get(i);
      if (resource.equals(p.get("resource")) && op.equals(p.get("op"))) {
        assertThat(p).containsEntry("projectKey", key);
        return ids.getAllValues().get(i);
      }
    }
    throw new AssertionError("resource.changed " + resource + "/" + op + " 미수신");
  }

  @Test
  @DisplayName("라벨 생성은 프로젝트 멤버 전원에게")
  void label_create_publishesToMembers() {
    clearInvocations(registry);
    labelService.create(owner, key, new CreateLabelRequest("rc-label", "BLUE"));
    assertThat(captureRecipients("label", "created")).containsExactlyInAnyOrder(owner, viewer);
  }

  @Test
  @DisplayName("마일스톤 삭제는 deleted")
  void milestone_delete_publishesDeleted() {
    var m =
        milestoneService.create(
            owner, key, new CreateMilestoneRequest("m1", LocalDate.now().plusDays(3), null));
    clearInvocations(registry);
    milestoneService.delete(owner, key, m.id());
    assertThat(captureRecipients("milestone", "deleted")).containsExactlyInAnyOrder(owner, viewer);
  }

  @Test
  @DisplayName("멤버 제거 알림은 제거된 사용자도 받는다")
  void removeMember_includesRemovedUser() {
    clearInvocations(registry);
    projectService.removeMember(owner, key, viewer);
    assertThat(captureRecipients("project-member", "deleted")).contains(viewer, owner);
  }

  @Test
  @DisplayName("멤버 제거 시 담당자에서 빠진 이슈의 issue/updated 도 발행")
  void removeMember_alsoPublishesIssueUpdatedForStrippedAssignees() {
    int n =
        issueService
            .create(
                owner,
                key,
                new CreateIssueRequest("t", "b", "MID", null, List.of(viewer), null, null, null))
            .number();
    clearInvocations(registry);
    projectService.removeMember(owner, key, viewer);
    ArgumentCaptor<Object> payload = ArgumentCaptor.forClass(Object.class);
    verify(registry, timeout(2000).atLeastOnce())
        .fanOut(any(), eq("resource.changed"), payload.capture());
    boolean found =
        payload.getAllValues().stream()
            .map(p -> (Map<?, ?>) p)
            .anyMatch(
                p ->
                    "issue".equals(p.get("resource"))
                        && "updated".equals(p.get("op"))
                        && Integer.valueOf(n).equals(p.get("issueNumber")));
    assertThat(found).isTrue();
  }

  @Test
  @DisplayName("개인 뷰는 소유자에게만")
  void privateSavedView_onlyOwner() {
    clearInvocations(registry);
    savedViewService.create(viewer, key, new SaveViewRequest("mine", "status:OPEN", "PRIVATE"));
    assertThat(captureRecipients("saved-view", "created")).containsExactly(viewer);
  }

  @Test
  @DisplayName("공유→비공개 전환은 프로젝트에 알린다")
  void sharedToPrivateSavedView_reachesProject() {
    var v =
        savedViewService.create(viewer, key, new SaveViewRequest("sh", "status:OPEN", "SHARED"));
    clearInvocations(registry);
    savedViewService.update(
        viewer, key, v.id(), new SaveViewRequest("sh", "status:OPEN", "PRIVATE"));
    assertThat(captureRecipients("saved-view", "updated")).contains(owner, viewer);
  }

  @Test
  @DisplayName("프로젝트 soft-delete 는 멤버 전원에게")
  void projectSoftDelete_publishesToMembers() {
    clearInvocations(registry);
    projectService.softDelete(owner, key);
    assertThat(captureRecipients("project", "deleted")).containsExactlyInAnyOrder(owner, viewer);
  }

  @Test
  @DisplayName("롤백되면 발행하지 않는다")
  void rolledBack_publishesNothing() {
    clearInvocations(registry);
    assertThatThrownBy(
            () ->
                new TransactionTemplate(txManager)
                    .executeWithoutResult(
                        s -> {
                          labelService.create(owner, key, new CreateLabelRequest("rb", "BLUE"));
                          throw new IllegalStateException("force rollback");
                        }))
        .isInstanceOf(IllegalStateException.class);
    verify(registry, after(500).never()).fanOut(any(), eq("resource.changed"), any());
  }

  private Long createHuman(String prefix) {
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
    createdUserIds.add(id);
    return id;
  }

  private String uniqueKey(String prefix) {
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 4);
    String k = prefix + suffix;
    return k.substring(0, Math.min(10, k.length()));
  }
}
