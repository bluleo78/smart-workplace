package com.workplace.notify.service;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_TYPE_DEF;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.notify.dto.NotificationType;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** NotificationService 통합 테스트 — actor 제외·중복 제거·빈 수신자 no-op·스코프. */
@Transactional
class NotificationServiceTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired NotificationService service;

  private long seedUser() {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "ns_" + s)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "Ns" + s)
        .set(USER.EMAIL, "ns_" + s + "@example.com")
        .set(USER.KIND, "HUMAN")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  /** project + issue_type_def + issue 1건 시드 후 issueId 반환. */
  private long seedIssue(long ownerId) {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 5);
    long projectId =
        dsl.insertInto(PROJECT)
            .set(PROJECT.KEY, "S" + s)
            .set(PROJECT.NAME, "P" + s)
            .set(PROJECT.OWNER_ID, ownerId)
            .returning(PROJECT.ID)
            .fetchOne()
            .getId();
    // 새 프로젝트는 V10 백필 대상이 아니므로 type_id(NOT NULL)용 유형 1건 시드.
    long typeId =
        dsl.insertInto(ISSUE_TYPE_DEF)
            .set(ISSUE_TYPE_DEF.PROJECT_ID, projectId)
            .set(ISSUE_TYPE_DEF.NAME, "TASK")
            .set(ISSUE_TYPE_DEF.COLOR_TOKEN, "BLUE")
            .set(ISSUE_TYPE_DEF.ICON, "Circle")
            .returning(ISSUE_TYPE_DEF.ID)
            .fetchOne()
            .getId();
    return dsl.insertInto(ISSUE)
        .set(ISSUE.PROJECT_ID, projectId)
        .set(ISSUE.NUMBER, 1)
        .set(ISSUE.TITLE, "t")
        .set(ISSUE.REPORTER_ID, ownerId)
        .set(ISSUE.TYPE_ID, typeId)
        .returning(ISSUE.ID)
        .fetchOne()
        .getId();
  }

  @Test
  void createAndFanOut_excludesActor_andDedupes() {
    long actor = seedUser();
    long r1 = seedUser();
    long issueId = seedIssue(actor);

    service.createAndFanOut(
        NotificationType.COMMENTED, List.of(actor, r1, r1, actor), actor, issueId, 5L);

    assertThat(service.countUnread(actor)).isZero();
    assertThat(service.countUnread(r1)).isEqualTo(1);
  }

  @Test
  void createAndFanOut_emptyRecipients_isNoOp() {
    long actor = seedUser();
    long issueId = seedIssue(actor);
    service.createAndFanOut(NotificationType.ASSIGNED, List.of(actor), actor, issueId, null);
    assertThat(service.countUnread(actor)).isZero();
    assertThat(service.listRecent(actor, 20)).isEmpty();
  }

  @Test
  void markAllRead_isCallerScoped() {
    long a = seedUser();
    long b = seedUser();
    long issueId = seedIssue(a);
    service.createAndFanOut(NotificationType.STATUS_CHANGED, List.of(a, b), null, issueId, null);

    service.markAllRead(a);
    assertThat(service.countUnread(a)).isZero();
    assertThat(service.countUnread(b)).isEqualTo(1);
  }
}
