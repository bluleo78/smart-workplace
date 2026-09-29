package com.workplace.issue.outbound;

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
import com.workplace.issue.service.IssueLabelService;
import com.workplace.issue.service.IssueService;
import com.workplace.label.repository.LabelRepository;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.repository.ProjectMemberRepository;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
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
 * WP-59 통합 — 이슈 C/U/D → AFTER_COMMIT ResourceSseDispatcher → resource.changed 가 프로젝트 멤버 전원(watcher
 * 아님)에게 가는지. AFTER_COMMIT 발화를 위해 클래스에 @Transactional 을 붙이지 않는다.
 */
@DisplayName("이슈 C/U/D → resource.changed 프로젝트 멤버 fan-out 통합")
class IssueResourceChangedIntegrationTest extends IntegrationTestBase {

  @MockitoBean SseRegistry registry;
  @MockitoBean AiAgentEventClient aiClient; // ai-agent 실제 호출 차단

  @Autowired DSLContext dsl;
  @Autowired PlatformTransactionManager txManager;
  @Autowired IssueService issueService;
  @Autowired IssueLabelService labelService;
  @Autowired LabelRepository labelRepository;
  @Autowired ProjectService projectService;
  @Autowired ProjectMemberRepository memberRepository;

  private final List<Long> createdUserIds = new ArrayList<>();
  private final List<Long> createdProjectIds = new ArrayList<>();
  private Long owner;
  private Long viewer;
  private String key;
  private Long projectId;

  @BeforeEach
  void seed() {
    owner = createHuman("owner");
    viewer = createHuman("viewer"); // 이슈와 무관한 일반 멤버 — watcher 아님
    var proj = projectService.create(owner, new CreateProjectRequest(uniqueKey("WP"), "P-rc", "x"));
    createdProjectIds.add(proj.id());
    memberRepository.insert(proj.id(), viewer, "MEMBER");
    key = proj.key();
    projectId = proj.id();
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

  private int createIssue() {
    return issueService
        .create(
            owner, key, new CreateIssueRequest("t", "b", "MID", null, List.of(), null, null, null))
        .number();
  }

  /** 지정 op 의 resource.changed 1건을 캡처해 수신자·payload 를 검증. */
  @SuppressWarnings("unchecked")
  private Map<String, Object> captureChanged(String op, int number) {
    ArgumentCaptor<Collection<Long>> ids = ArgumentCaptor.forClass(Collection.class);
    ArgumentCaptor<Object> payload = ArgumentCaptor.forClass(Object.class);
    verify(registry, timeout(2000).atLeastOnce())
        .fanOut(ids.capture(), eq("resource.changed"), payload.capture());
    for (int i = 0; i < payload.getAllValues().size(); i++) {
      var p = (Map<String, Object>) payload.getAllValues().get(i);
      if (op.equals(p.get("op")) && Integer.valueOf(number).equals(p.get("issueNumber"))) {
        assertThat(ids.getAllValues().get(i)).containsExactlyInAnyOrder(owner, viewer);
        assertThat(p).containsEntry("resource", "issue").containsEntry("projectKey", key);
        return p;
      }
    }
    throw new AssertionError("resource.changed op=" + op + " #" + number + " 미수신");
  }

  @Test
  void create_publishesCreatedToAllMembers() {
    int n = createIssue();
    captureChanged("created", n);
  }

  @Test
  void updateStatus_publishesUpdated() {
    int n = createIssue();
    clearInvocations(registry);
    issueService.updateStatus(owner, key, n, "IN_PROGRESS");
    captureChanged("updated", n);
  }

  @Test
  void labelReplace_publishesUpdated() {
    int n = createIssue();
    clearInvocations(registry);
    // 실제 부착 변경이 있어야 발행된다(diff 0 은 no-op) — 라벨을 하나 만들어 붙인다.
    Long labelId = labelRepository.insert(projectId, "rc-label", "blue").id();
    labelService.replace(owner, key, n, List.of(labelId));
    captureChanged("updated", n);
  }

  @Test
  void softDelete_publishesDeleted() {
    int n = createIssue();
    clearInvocations(registry);
    issueService.softDelete(owner, key, n);
    captureChanged("deleted", n);
  }

  /**
   * 롤백된 쓰기는 알리지 않는다 — AFTER_COMMIT 보장. 서비스가 알림을 발행한 "뒤에" 바깥 트랜잭션이 롤백되도록 TransactionTemplate 으로
   * 감싼다(서비스는 바깥 트랜잭션에 참여하므로 changed() 는 실제로 호출된다).
   */
  @Test
  void rolledBackUpdate_publishesNothing() {
    int n = createIssue();
    clearInvocations(registry);
    assertThatThrownBy(
            () ->
                new TransactionTemplate(txManager)
                    .executeWithoutResult(
                        s -> {
                          issueService.updateStatus(owner, key, n, "IN_PROGRESS");
                          throw new IllegalStateException("force rollback");
                        }))
        .isInstanceOf(IllegalStateException.class);
    verify(registry, after(500).never()).fanOut(any(), eq("resource.changed"), any());
  }

  // --- fixtures (IssueEventDispatchIntegrationTest 와 동일 패턴) ---

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
