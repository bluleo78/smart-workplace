package com.workplace.notify.push;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_TYPE_DEF;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.notify.dto.NotificationType;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** 인박스 알림 → 푸시 문구/url/tag 조립. 표시 문구는 프론트 InboxPanel ACTION_LABEL 과 같은 표현을 쓴다. */
@Transactional
class PushContentServiceTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired PushContentService content;

  long actor;
  String key;
  long issueId;

  private void seedIssue() {
    actor = TestFixtures.createHuman(dsl);
    // 푸시 문구가 행위자 이름을 쓰므로 검증용 이름을 지정한다.
    dsl.update(USER).set(USER.NAME, "박민수").where(USER.ID.eq(actor)).execute();
    key = "P" + UUID.randomUUID().toString().replace("-", "").substring(0, 4).toUpperCase();
    long projectId =
        dsl.insertInto(PROJECT)
            .set(PROJECT.KEY, key)
            .set(PROJECT.NAME, "N")
            .set(PROJECT.OWNER_ID, actor)
            .returning(PROJECT.ID)
            .fetchOne()
            .getId();
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
            .set(ISSUE.NUMBER, 7)
            .set(ISSUE.TITLE, "로그인 버그")
            .set(ISSUE.REPORTER_ID, actor)
            .set(ISSUE.TYPE_ID, typeId)
            .returning(ISSUE.ID)
            .fetchOne()
            .getId();
  }

  @Test
  void forInbox_assigned_buildsIssueMessage() {
    seedIssue();
    PushMessage m =
        content.forInbox(
            new InboxPushRequestedEvent(
                1L, NotificationType.ASSIGNED, List.of(99L), actor, issueId, null));

    assertThat(m.category()).isEqualTo(PushCategory.ISSUE);
    assertThat(m.title()).isEqualTo(key + "-7 로그인 버그");
    assertThat(m.body()).isEqualTo("박민수님이 회원님을 배정했습니다");
    assertThat(m.url()).isEqualTo("/projects/" + key + "/issues/7");
    assertThat(m.tag()).isEqualTo("issue-" + issueId);
    assertThat(m.urgency()).isEqualTo("normal");
    assertThat(m.ttlSeconds()).isEqualTo(259200);
    assertThat(m.tenantId()).isEqualTo(1L);
  }

  @Test
  void forInbox_deletedIssue_returnsNull() {
    PushMessage m =
        content.forInbox(
            new InboxPushRequestedEvent(
                1L, NotificationType.COMMENTED, List.of(1L), null, -1L, null));
    assertThat(m).isNull();
  }

  @Test
  void forInbox_missingEvent_returnsNull() {
    assertThat(
            content.forInbox(
                new InboxPushRequestedEvent(
                    1L, NotificationType.REMINDER, List.of(1L), null, null, -1L)))
        .isNull();
  }
}
