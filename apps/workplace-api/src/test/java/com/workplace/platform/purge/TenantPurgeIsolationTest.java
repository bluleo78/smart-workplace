package com.workplace.platform.purge;

import static com.workplace.jooq.Tables.*;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.file.storage.FileStore;
import com.workplace.global.tenant.TenantScopedRunner;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.PostgresTestContainer;
import com.workplace.support.TestFixtures;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * 영구 삭제 격리 — 테넌트 A 를 영구 삭제하면 A 의 모든 테넌트 테이블이 0행·디스크 디렉터리 제거·전용 AGENT 삭제가 되고, 테넌트 B 의 데이터·파일과 양쪽 소속
 * 사람 계정은 그대로여야 한다.
 */
class TenantPurgeIsolationTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired TenantPurgeService purgeService;
  @Autowired TenantScopedRunner runner;
  @Autowired FileStore fileStore;

  long a, b, shared, agentA;

  /** 소유자(app, BYPASSRLS) 커넥션 — tenant 정리와 RLS 무관 행 수 집계용. */
  private static Connection owner() throws Exception {
    var c = PostgresTestContainer.INSTANCE;
    return DriverManager.getConnection(c.getJdbcUrl(), c.getUsername(), c.getPassword());
  }

  /** 테넌트 GUC 아래에서 순서 제약 간선을 모두 포함한 대표 행과 디스크 파일을 만든다. */
  private void seed(long tid, long user) throws Exception {
    runner.runForTenant(
        tid,
        t -> {
          // 이슈: project ← issue_type_def(RESTRICT 대상) ← issue
          long project =
              dsl.insertInto(PROJECT)
                  .set(PROJECT.KEY, "P" + t)
                  .set(PROJECT.NAME, "p")
                  .set(PROJECT.OWNER_ID, user)
                  .returning(PROJECT.ID)
                  .fetchOne()
                  .getId();
          long type =
              dsl.insertInto(ISSUE_TYPE_DEF)
                  .set(ISSUE_TYPE_DEF.PROJECT_ID, project)
                  .set(ISSUE_TYPE_DEF.NAME, "TASK")
                  .set(ISSUE_TYPE_DEF.COLOR_TOKEN, "BLUE")
                  .set(ISSUE_TYPE_DEF.ICON, "Circle")
                  .returning(ISSUE_TYPE_DEF.ID)
                  .fetchOne()
                  .getId();
          dsl.insertInto(ISSUE)
              .set(ISSUE.PROJECT_ID, project)
              .set(ISSUE.NUMBER, 1)
              .set(ISSUE.TITLE, "i")
              .set(ISSUE.REPORTER_ID, user)
              .set(ISSUE.TYPE_ID, type)
              .execute();
          // 메일: account ← folder ← message(content_id RESTRICT) ← attachment(content_attachment_id
          // RESTRICT)
          long account =
              dsl.insertInto(EMAIL_ACCOUNT)
                  .set(EMAIL_ACCOUNT.USER_ID, user)
                  .set(EMAIL_ACCOUNT.EMAIL_ADDRESS, "m" + t + "@example.com")
                  .returning(EMAIL_ACCOUNT.ID)
                  .fetchOne()
                  .getId();
          long folder =
              dsl.insertInto(EMAIL_FOLDER)
                  .set(EMAIL_FOLDER.ACCOUNT_ID, account)
                  .set(EMAIL_FOLDER.NAME, "INBOX")
                  .returning(EMAIL_FOLDER.ID)
                  .fetchOne()
                  .getId();
          long content =
              dsl.insertInto(EMAIL_CONTENT)
                  .set(EMAIL_CONTENT.TENANT_ID, t)
                  .set(EMAIL_CONTENT.THREAD_ID, "th")
                  .returning(EMAIL_CONTENT.ID)
                  .fetchOne()
                  .getId();
          long contentAtt =
              dsl.insertInto(CONTENT_ATTACHMENT)
                  .set(CONTENT_ATTACHMENT.CONTENT_ID, content)
                  .set(CONTENT_ATTACHMENT.ORDINAL, 0)
                  .returning(CONTENT_ATTACHMENT.ID)
                  .fetchOne()
                  .getId();
          long msg =
              dsl.insertInto(EMAIL_MESSAGE)
                  .set(EMAIL_MESSAGE.ACCOUNT_ID, account)
                  .set(EMAIL_MESSAGE.FOLDER_ID, folder)
                  .set(EMAIL_MESSAGE.THREAD_ID, "th")
                  .set(EMAIL_MESSAGE.CONTENT_ID, content)
                  .returning(EMAIL_MESSAGE.ID)
                  .fetchOne()
                  .getId();
          dsl.insertInto(EMAIL_ATTACHMENT)
              .set(EMAIL_ATTACHMENT.MESSAGE_ID, msg)
              .set(EMAIL_ATTACHMENT.CONTENT_ATTACHMENT_ID, contentAtt)
              .execute();
          // FK 없는 테이블: mail_attachment_blob
          dsl.insertInto(MAIL_ATTACHMENT_BLOB)
              .set(MAIL_ATTACHMENT_BLOB.TENANT_ID, t)
              .set(MAIL_ATTACHMENT_BLOB.CONTENT_HASH, "h" + t)
              .set(MAIL_ATTACHMENT_BLOB.FILE_REF, "tenant-" + t + "/mail/00/x.enc")
              .set(MAIL_ATTACHMENT_BLOB.SIZE_BYTES, 1L)
              .execute();
          // 드라이브: file ← drive_file(NO ACTION) ← drive_file_version(file_id NO ACTION)
          long file =
              dsl.insertInto(FILE)
                  .set(FILE.ORIGINAL_NAME, "x.txt")
                  .set(FILE.STORED_NAME, "x.txt")
                  .set(FILE.MIME_TYPE, "text/plain")
                  .set(FILE.SIZE_BYTES, 1L)
                  .set(FILE.STORAGE_PATH, "tenant-" + t + "/files/2026-10-12/x.txt")
                  .set(FILE.UPLOADED_BY, user)
                  .returning(FILE.ID)
                  .fetchOne()
                  .getId();
          long space =
              dsl.insertInto(DRIVE_SPACE)
                  .set(DRIVE_SPACE.TYPE, "TEAM")
                  .set(DRIVE_SPACE.NAME, "s")
                  .set(DRIVE_SPACE.OWNER_ID, user)
                  .returning(DRIVE_SPACE.ID)
                  .fetchOne()
                  .getId();
          long driveFile =
              dsl.insertInto(DRIVE_FILE)
                  .set(DRIVE_FILE.SPACE_ID, space)
                  .set(DRIVE_FILE.FILE_ID, file)
                  .set(DRIVE_FILE.NAME, "x.txt")
                  .returning(DRIVE_FILE.ID)
                  .fetchOne()
                  .getId();
          dsl.insertInto(DRIVE_FILE_VERSION)
              .set(DRIVE_FILE_VERSION.DRIVE_FILE_ID, driveFile)
              .set(DRIVE_FILE_VERSION.VERSION_NO, 1)
              .set(DRIVE_FILE_VERSION.FILE_ID, file)
              .set(DRIVE_FILE_VERSION.SIZE_BYTES, 1L)
              .set(DRIVE_FILE_VERSION.UPLOADED_BY, user)
              .execute();
          // 메시징 + FK 없는 conversation_attention
          long channel =
              dsl.insertInto(CHANNEL)
                  .set(CHANNEL.NAME, "c")
                  .set(CHANNEL.CREATED_BY, user)
                  .returning(CHANNEL.ID)
                  .fetchOne()
                  .getId();
          long message =
              dsl.insertInto(MESSAGE)
                  .set(MESSAGE.CHANNEL_ID, channel)
                  .set(MESSAGE.AUTHOR_ID, user)
                  .returning(MESSAGE.ID)
                  .fetchOne()
                  .getId();
          dsl.insertInto(CONVERSATION_ATTENTION)
              .set(CONVERSATION_ATTENTION.CHANNEL_ID, channel)
              .set(CONVERSATION_ATTENTION.USER_ID, user)
              .set(CONVERSATION_ATTENTION.CLASSIFIED_MESSAGE_ID, message)
              .execute();
          // 감사 로그(tenant FK NO ACTION — 남으면 tenant 행 삭제를 막는다)
          dsl.insertInto(AUDIT_LOG)
              .set(AUDIT_LOG.USERNAME, "u")
              .set(AUDIT_LOG.ACTION_TYPE, "CREATE")
              .set(AUDIT_LOG.RESOURCE, "issue")
              .execute();
        });
    Path f = fileStore.rootDir().resolve("tenant-" + tid + "/files/2026-10-12/x.txt");
    Files.createDirectories(f.getParent());
    Files.writeString(f, "x");
  }

  @BeforeEach
  void setUp() throws Exception {
    a = TestFixtures.createTenant(dsl, "ACTIVE");
    b = TestFixtures.createTenant(dsl, "ACTIVE");
    shared = TestFixtures.createHuman(dsl);
    agentA = TestFixtures.createAgentNoToken(dsl);
    // 픽스처는 멤버십을 만들지 않는다 — 소속은 아래에서 명시한다(app_tenant 는 membership DELETE 권한도 없다).
    TestFixtures.addMember(dsl, shared, a);
    TestFixtures.addMember(dsl, shared, b);
    TestFixtures.addMember(dsl, agentA, a);
    seed(a, shared);
    seed(b, shared);
    dsl.update(TENANT).set(TENANT.STATUS, "PURGING").where(TENANT.ID.eq(a)).execute();
  }

  /** B(및 실패 테스트에서 남은 A)를 같은 서비스로 정리하고 공유 계정을 지운다. */
  @AfterEach
  void cleanup() {
    for (long t : new long[] {a, b}) {
      dsl.update(TENANT).set(TENANT.STATUS, "PURGING").where(TENANT.ID.eq(t)).execute();
      purgeService.purge(t);
    }
    dsl.deleteFrom(USER).where(USER.ID.in(shared, agentA)).execute();
  }

  @Test
  void purgesOnlyTargetTenant() throws Exception {
    purgeService.purge(a);

    assertThat(dsl.fetchExists(TENANT, TENANT.ID.eq(a))).isFalse();
    assertThat(countRowsOwner(a)).isZero();
    assertThat(Files.exists(fileStore.rootDir().resolve("tenant-" + a))).isFalse();
    assertThat(dsl.fetchExists(USER, USER.ID.eq(agentA))).isFalse();
    assertThat(countRowsOwner(b)).isPositive();
    assertThat(Files.exists(fileStore.rootDir().resolve("tenant-" + b + "/files/2026-10-12/x.txt")))
        .isTrue();
    assertThat(dsl.fetchExists(USER, USER.ID.eq(shared))).isTrue();
    assertThat(
            dsl.fetchExists(
                MEMBERSHIP, MEMBERSHIP.USER_ID.eq(shared).and(MEMBERSHIP.TENANT_ID.eq(b))))
        .isTrue();
  }

  @Test
  void leftoverRow_revertsToDeletedWithError_andRollsBack() throws Exception {
    // 테스트 훅으로 conversation_attention 을 건너뛰어 잔여 확인 실패를 만든다.
    purgeService.purge(a, Set.of("conversation_attention"));

    var t = dsl.selectFrom(TENANT).where(TENANT.ID.eq(a)).fetchOne();
    assertThat(t.getStatus()).isEqualTo("DELETED");
    assertThat(t.getPurgeError()).contains("conversation_attention");
    assertThat(countRowsOwner(a)).isGreaterThan(1); // 단계 1 원자성: 다른 데이터도 롤백되어 남아 있다
    assertThat(Files.exists(fileStore.rootDir().resolve("tenant-" + a + "/files/2026-10-12/x.txt")))
        .isTrue();
  }

  @Test
  void notPurging_deletesNothing() throws Exception {
    // 잡이 들고 있던 오래된 id 목록 시나리오 — 그 사이 복원(ACTIVE)되었거나 단계 1 실패로 DELETED 가 된 테넌트는 건드리면 안 된다.
    long before = countRowsOwner(b);
    for (String status : new String[] {"ACTIVE", "DELETED"}) {
      dsl.update(TENANT).set(TENANT.STATUS, status).where(TENANT.ID.eq(b)).execute();

      purgeService.purge(b);

      var t = dsl.selectFrom(TENANT).where(TENANT.ID.eq(b)).fetchOne();
      assertThat(t).isNotNull();
      assertThat(t.getStatus()).isEqualTo(status);
      assertThat(t.getPurgeError()).isNull();
      assertThat(countRowsOwner(b)).isEqualTo(before);
      assertThat(
              Files.exists(fileStore.rootDir().resolve("tenant-" + b + "/files/2026-10-12/x.txt")))
          .isTrue();
    }
  }

  @Test
  void rowRemovalFailure_staysPurgingWithError_thenRetrySucceeds() throws Exception {
    // 단계 3 실패를 결정적으로 만들기 위해 런타임 롤의 purge_tenant 실행 권한을 잠시 회수한다.
    try (Connection c = owner()) {
      c.createStatement()
          .execute("REVOKE EXECUTE ON FUNCTION purge_tenant(BIGINT, BIGINT[]) FROM app_tenant");
    }
    try {
      purgeService.purge(a);
    } finally {
      try (Connection c = owner()) {
        c.createStatement()
            .execute("GRANT EXECUTE ON FUNCTION purge_tenant(BIGINT, BIGINT[]) TO app_tenant");
      }
    }

    // 데이터는 이미 지워졌으므로 복원 가능 상태(DELETED)로 되돌리지 않고 PURGING 유지 + 사유 기록.
    var t = dsl.selectFrom(TENANT).where(TENANT.ID.eq(a)).fetchOne();
    assertThat(t.getStatus()).isEqualTo("PURGING");
    assertThat(t.getPurgeError()).contains("purge_tenant");
    assertThat(countRowsOwner(a)).isZero();
    assertThat(Files.exists(fileStore.rootDir().resolve("tenant-" + a))).isFalse();

    // 재시도 — 단계 1 은 0행으로 통과하고 단계 3 이 끝낸다(멱등).
    purgeService.purge(a);
    assertThat(dsl.fetchExists(TENANT, TENANT.ID.eq(a))).isFalse();
    assertThat(dsl.fetchExists(USER, USER.ID.eq(agentA))).isFalse();
  }

  /**
   * 소유자 커넥션(RLS 우회)으로 tenant_id 를 가진 모든 BASE TABLE 의 해당 테넌트 행 수 합계. membership·user_api_token 제외.
   * 카탈로그는 pg_class/pg_attribute 로 읽는다(information_schema 는 권한 있는 테이블만 보여준다).
   */
  private long countRowsOwner(long tenantId) throws Exception {
    try (Connection conn = owner()) {
      List<String> tables = new ArrayList<>();
      try (PreparedStatement ps = conn.prepareStatement(TenantPurgePlan.TENANT_TABLES_SQL);
          ResultSet rs = ps.executeQuery()) {
        while (rs.next()) tables.add(rs.getString(1));
      }
      long total = 0;
      for (String t : tables) {
        if (TenantPurgePlan.EXCLUDED.contains(t)) continue;
        try (PreparedStatement ps =
            conn.prepareStatement("SELECT count(*) FROM \"" + t + "\" WHERE tenant_id = ?")) {
          ps.setLong(1, tenantId);
          try (ResultSet rs = ps.executeQuery()) {
            rs.next();
            total += rs.getLong(1);
          }
        }
      }
      return total;
    }
  }
}
