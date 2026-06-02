package com.workplace.notify.repository;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_TYPE_DEF;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.notify.dto.NotificationResponse;
import com.workplace.notify.dto.NotificationType;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** NotificationRepository 통합 테스트 — insert/조회/읽음. 직접 호출이라 @Transactional 롤백. */
@Transactional
class NotificationRepositoryTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired NotificationRepository repo;

  private String tok() {
    return UUID.randomUUID().toString().replace("-", "").substring(0, 8);
  }

  private long seedUser(String kind) {
    String s = tok();
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "nr_" + s)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "Nr" + s)
        .set(USER.EMAIL, "nr_" + s + "@example.com")
        .set(USER.KIND, kind)
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  /** project + issue 1건 시드 후 issueId 반환. */
  private long seedIssue(long ownerId, String title) {
    String s = tok();
    long projectId =
        dsl.insertInto(PROJECT)
            .set(PROJECT.KEY, "N" + s.substring(0, 5))
            .set(PROJECT.NAME, "P" + s)
            .set(PROJECT.OWNER_ID, ownerId)
            .returning(PROJECT.ID)
            .fetchOne()
            .getId();
    // 새 프로젝트는 V10 백필 대상이 아니므로 issue_type_def 가 없다 → type_id(NOT NULL) 용 유형 1건 시드.
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
        .set(ISSUE.TITLE, title)
        .set(ISSUE.REPORTER_ID, ownerId)
        .set(ISSUE.TYPE_ID, typeId)
        .returning(ISSUE.ID)
        .fetchOne()
        .getId();
  }

  @Test
  void insertBatch_then_listRecent_joinsDisplayFields() {
    long recipient = seedUser("HUMAN");
    long actor = seedUser("AGENT");
    long issueId = seedIssue(actor, "리팩터링");

    repo.insertBatch(List.of(recipient), NotificationType.COMMENTED, actor, issueId, 77L);

    List<NotificationResponse> list = repo.listRecent(recipient, 20);
    assertThat(list).hasSize(1);
    NotificationResponse n = list.get(0);
    assertThat(n.type()).isEqualTo("COMMENTED");
    assertThat(n.actorId()).isEqualTo(actor);
    assertThat(n.actorKind()).isEqualTo("AGENT");
    assertThat(n.issueId()).isEqualTo(issueId);
    assertThat(n.issueTitle()).isEqualTo("리팩터링");
    assertThat(n.issueNumber()).isEqualTo(1);
    assertThat(n.projectKey()).isNotBlank();
    assertThat(n.commentId()).isEqualTo(77L);
    assertThat(n.read()).isFalse();
    assertThat(n.createdAt()).isNotNull();
  }

  @Test
  void countUnread_and_markRead_areRecipientScoped() {
    long a = seedUser("HUMAN");
    long b = seedUser("HUMAN");
    long issueId = seedIssue(a, "이슈");
    repo.insertBatch(List.of(a, b), NotificationType.STATUS_CHANGED, null, issueId, null);

    assertThat(repo.countUnread(a)).isEqualTo(1);
    long aNotifId = repo.listRecent(a, 20).get(0).id();

    assertThat(repo.markRead(b, aNotifId)).isZero();
    assertThat(repo.countUnread(a)).isEqualTo(1);

    assertThat(repo.markRead(a, aNotifId)).isEqualTo(1);
    assertThat(repo.countUnread(a)).isZero();
    assertThat(repo.listRecent(a, 20).get(0).read()).isTrue();
  }

  @Test
  void markAllRead_clearsOnlyCallerUnread() {
    long a = seedUser("HUMAN");
    long issueId = seedIssue(a, "이슈");
    repo.insertBatch(List.of(a, a), NotificationType.ASSIGNED, null, issueId, null);
    assertThat(repo.countUnread(a)).isEqualTo(2);

    assertThat(repo.markAllRead(a)).isEqualTo(2);
    assertThat(repo.countUnread(a)).isZero();
  }
}
