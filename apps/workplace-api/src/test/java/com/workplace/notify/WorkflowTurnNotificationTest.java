package com.workplace.notify;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_TYPE_DEF;
import static com.workplace.jooq.Tables.NOTIFICATION;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.PROJECT_MEMBER;
import static com.workplace.support.TestFixtures.uniqueProjectKey;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.global.tenant.TenantContext;
import com.workplace.notify.dto.NotificationType;
import com.workplace.notify.service.NotificationService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * 워크플로우 차례 타이머 알림(WP-1987) — 행위자 없이 담당자(REMIND)·관리자(ESCALATE)에게 가고, 두 종류 말고는 거부한다. 열람 권한·설정 필터는 기존
 * create 경로 그대로다.
 */
@Transactional
class WorkflowTurnNotificationTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired NotificationService service;

  private long assignee;
  private long owner;
  private long issueId;

  @BeforeEach
  void setUp() {
    TenantContext.set(1L);
    assignee = member();
    owner = member();
    String key = uniqueProjectKey("T");
    long projectId =
        dsl.insertInto(PROJECT)
            .set(PROJECT.KEY, key)
            .set(PROJECT.NAME, "N")
            .set(PROJECT.OWNER_ID, owner)
            .returning(PROJECT.ID)
            .fetchOne()
            .getId();
    addMember(projectId, owner, "OWNER");
    addMember(projectId, assignee, "MEMBER");
    long typeId =
        dsl.insertInto(ISSUE_TYPE_DEF)
            .set(ISSUE_TYPE_DEF.PROJECT_ID, projectId)
            .set(ISSUE_TYPE_DEF.NAME, "TASK")
            .set(ISSUE_TYPE_DEF.COLOR_TOKEN, "BLUE")
            .set(ISSUE_TYPE_DEF.ICON, "Circle")
            .returning(ISSUE_TYPE_DEF.ID)
            .fetchOne()
            .getId();
    issueId =
        dsl.insertInto(ISSUE)
            .set(ISSUE.PROJECT_ID, projectId)
            .set(ISSUE.STATUS_ID, TestFixtures.defaultStatusId(projectId, "TODO"))
            .set(ISSUE.NUMBER, 1)
            .set(ISSUE.TITLE, "워크플로우")
            .set(ISSUE.REPORTER_ID, owner)
            .set(ISSUE.TYPE_ID, typeId)
            .returning(ISSUE.ID)
            .fetchOne()
            .getId();
  }

  @AfterEach
  void tearDown() {
    TenantContext.clear();
  }

  private long member() {
    long id = TestFixtures.createHuman(dsl);
    TestFixtures.ensureActiveMember(dsl, id, 1L);
    return id;
  }

  private void addMember(long projectId, long userId, String role) {
    dsl.insertInto(PROJECT_MEMBER)
        .set(PROJECT_MEMBER.PROJECT_ID, projectId)
        .set(PROJECT_MEMBER.USER_ID, userId)
        .set(PROJECT_MEMBER.ROLE, role)
        .execute();
  }

  /** 담당자에게 행위자 없이 REMIND 한 줄이 생긴다. */
  @Test
  void remind_reachesRecipientsWithoutActor() {
    service.createWorkflowTurnAndFanOut(
        NotificationType.WORKFLOW_TURN_REMIND, issueId, List.of(assignee));

    var rows = dsl.selectFrom(NOTIFICATION).where(NOTIFICATION.ISSUE_ID.eq(issueId)).fetch();
    assertThat(rows).hasSize(1);
    assertThat(rows.get(0).getRecipientId()).isEqualTo(assignee);
    assertThat(rows.get(0).getType()).isEqualTo("WORKFLOW_TURN_REMIND");
    assertThat(rows.get(0).getActorId()).isNull();
  }

  /** 관리자 목록에 프로젝트 OWNER(사람)가 들고, 그 목록으로 ESCALATE 하면 OWNER 가 받는다. */
  @Test
  void escalate_toOwners() {
    List<Long> managers = service.workflowManagerIds(issueId);
    assertThat(managers).contains(owner);

    service.createWorkflowTurnAndFanOut(NotificationType.WORKFLOW_TURN_ESCALATE, issueId, managers);

    assertThat(
            dsl.select(NOTIFICATION.RECIPIENT_ID)
                .from(NOTIFICATION)
                .where(NOTIFICATION.ISSUE_ID.eq(issueId))
                .and(NOTIFICATION.TYPE.eq("WORKFLOW_TURN_ESCALATE"))
                .fetch(NOTIFICATION.RECIPIENT_ID))
        .contains(owner);
  }

  /** 두 종류 말고는 거부한다. */
  @Test
  void otherType_rejected() {
    assertThatThrownBy(
            () ->
                service.createWorkflowTurnAndFanOut(
                    NotificationType.ASSIGNED, issueId, List.of(assignee)))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
