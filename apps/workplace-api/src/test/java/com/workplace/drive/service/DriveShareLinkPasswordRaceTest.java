package com.workplace.drive.service;

import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.DRIVE_FILE;
import static com.workplace.jooq.Tables.DRIVE_SHARE_LINK;
import static com.workplace.jooq.Tables.DRIVE_SHARE_LINK_ATTEMPTS;
import static com.workplace.jooq.Tables.DRIVE_SPACE;
import static com.workplace.jooq.Tables.DRIVE_SPACE_MEMBER;
import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.drive.dto.CreateShareLinkRequest;
import com.workplace.drive.exception.DriveShareLinkLockedException;
import com.workplace.drive.exception.DriveShareLinkUnauthorizedException;
import com.workplace.global.tenant.TenantContext;
import com.workplace.global.util.CapabilityTokens;
import com.workplace.support.IntegrationTestBase;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 공유 링크 비밀번호 잠금(5회 실패 → 15분, #700)이 동시 요청에도 걸린다(WP-783).
 *
 * <p>고치기 전에는 「잠겼나 확인 → 비밀번호 비교 → 실패 카운터 증가」 사이가 비어 있어, 틀린 비밀번호를 한꺼번에 보내면 모두 확인을 통과한 뒤에야 카운터가 올라 한
 * 번에 수십~백 번 넘게 추측할 수 있었다. 이제 비교 전에 시도 한 칸을 원자적으로 잡으므로, 동시에 몇 개를 보내든 비교까지 가는 것은 5번뿐이다. 링크·카운터가 다른
 * 커넥션에 보여야 해서 트랜잭션 없이 커밋하고 끝나면 지운다.
 */
class DriveShareLinkPasswordRaceTest extends IntegrationTestBase {

  private static final int CONCURRENT = 20;

  @Autowired DriveShareLinkService service;

  private final List<Long> users = new ArrayList<>();
  private long spaceId;
  private long coreFileId;
  private long driveFileId;
  private String token;
  private String tokenHash;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    long owner = user();
    spaceId =
        baseDsl
            .insertInto(DRIVE_SPACE)
            .set(DRIVE_SPACE.TYPE, "TEAM")
            .set(DRIVE_SPACE.NAME, "race-" + UUID.randomUUID().toString().substring(0, 8))
            .set(DRIVE_SPACE.OWNER_ID, owner)
            .returning(DRIVE_SPACE.ID)
            .fetchOne()
            .getId();
    baseDsl
        .insertInto(DRIVE_SPACE_MEMBER)
        .set(DRIVE_SPACE_MEMBER.SPACE_ID, spaceId)
        .set(DRIVE_SPACE_MEMBER.USER_ID, owner)
        .set(DRIVE_SPACE_MEMBER.ROLE, "OWNER")
        .execute();
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    coreFileId =
        baseDsl
            .insertInto(FILE)
            .set(FILE.ORIGINAL_NAME, "a.txt")
            .set(FILE.STORED_NAME, "stored-" + s)
            .set(FILE.STORAGE_PATH, "/tmp/a-" + s + ".txt")
            .set(FILE.MIME_TYPE, "text/plain")
            .set(FILE.SIZE_BYTES, 3L)
            .set(FILE.UPLOADED_BY, owner)
            .returning(FILE.ID)
            .fetchOne()
            .getId();
    driveFileId =
        baseDsl
            .insertInto(DRIVE_FILE)
            .set(DRIVE_FILE.SPACE_ID, spaceId)
            .set(DRIVE_FILE.FILE_ID, coreFileId)
            .set(DRIVE_FILE.NAME, "a.txt")
            .returning(DRIVE_FILE.ID)
            .fetchOne()
            .getId();
    token =
        service
            .create(owner, driveFileId, new CreateShareLinkRequest("EXTERNAL", "secret", null))
            .token();
    tokenHash = CapabilityTokens.sha256Hex(token);
    TenantContext.clear();
  }

  @AfterEach
  void cleanup() {
    TenantContext.set(1L);
    baseDsl
        .deleteFrom(DRIVE_SHARE_LINK_ATTEMPTS)
        .where(DRIVE_SHARE_LINK_ATTEMPTS.TOKEN_HASH.eq(tokenHash))
        .execute();
    cleanupInTenant(
        1L,
        () ->
            baseDsl
                .deleteFrom(AUDIT_LOG)
                .where(AUDIT_LOG.RESOURCE_ID.eq(String.valueOf(driveFileId)))
                .and(AUDIT_LOG.RESOURCE.eq("drive"))
                .execute());
    TenantContext.set(1L);
    baseDsl
        .deleteFrom(DRIVE_SHARE_LINK)
        .where(DRIVE_SHARE_LINK.DRIVE_FILE_ID.eq(driveFileId))
        .execute();
    baseDsl.deleteFrom(DRIVE_FILE).where(DRIVE_FILE.ID.eq(driveFileId)).execute();
    baseDsl.deleteFrom(FILE).where(FILE.ID.eq(coreFileId)).execute();
    baseDsl.deleteFrom(DRIVE_SPACE_MEMBER).where(DRIVE_SPACE_MEMBER.SPACE_ID.eq(spaceId)).execute();
    baseDsl.deleteFrom(DRIVE_SPACE).where(DRIVE_SPACE.ID.eq(spaceId)).execute();
    baseDsl.deleteFrom(AUDIT_LOG).where(AUDIT_LOG.USER_ID.in(users)).execute();
    baseDsl.deleteFrom(USER).where(USER.ID.in(users)).execute();
    TenantContext.clear();
  }

  @Test
  void 틀린_비밀번호를_동시에_보내도_비교까지_가는_것은_5번뿐이고_이후_잠긴다() throws Exception {
    List<Object> results = sendWrongPasswordsAtOnce();

    long unauthorized =
        results.stream().filter(r -> r instanceof DriveShareLinkUnauthorizedException).count();
    long locked = results.stream().filter(r -> r instanceof DriveShareLinkLockedException).count();
    assertThat(unauthorized + locked).as("다른 결과 없음: %s", results).isEqualTo(CONCURRENT);
    assertThat(unauthorized).as("비밀번호 비교까지 간 요청(401)").isEqualTo(5);
    // 잠긴 뒤에는 맞는 비밀번호도 15분 동안 거절된다.
    assertThatThrownBy(() -> service.resolveForDownload(token, "secret", null, null, false))
        .isInstanceOf(DriveShareLinkLockedException.class);
  }

  @Test
  void 실패가_5번_미만이면_맞는_비밀번호로_통과하고_카운터가_지워진다() {
    for (int i = 0; i < 4; i++) {
      assertThatThrownBy(() -> service.resolveForDownload(token, "wrong", null, null, false))
          .isInstanceOf(DriveShareLinkUnauthorizedException.class);
    }
    assertThat(service.resolveForDownload(token, "secret", null, null, false).driveFileId())
        .isEqualTo(driveFileId);
    assertThat(
            baseDsl.fetchCount(
                DRIVE_SHARE_LINK_ATTEMPTS, DRIVE_SHARE_LINK_ATTEMPTS.TOKEN_HASH.eq(tokenHash)))
        .isZero();
  }

  /**
   * WP-789: 잠금 감사(SHARE_LINK_LOCKED)는 링크를 만든 워크스페이스의 감사로 남는다. 익명 공개 경로라 테넌트 컨텍스트가 없어, 전에는 tenant_id
   * 가 비어 그 워크스페이스 관리자의 감사 로그에 보이지 않았다.
   */
  @Test
  void 잠금_감사는_링크의_워크스페이스로_남는다() {
    // 운영의 익명 요청처럼 커넥션에 워크스페이스(GUC)가 없는 상태 — 테스트 기본값(세션 GUC 1)이면 우연히 맞게 남는다.
    baseDsl.execute("SELECT set_config('app.tenant_id', '', false)");
    try {
      for (int i = 0; i < 5; i++) {
        assertThatThrownBy(() -> service.resolveForDownload(token, "wrong", null, null, false))
            .isInstanceOf(DriveShareLinkUnauthorizedException.class);
      }
    } finally {
      baseDsl.execute("SELECT set_config('app.tenant_id', '1', false)");
    }
    TenantContext.set(1L);
    try {
      Integer inTenant =
          new TransactionTemplate(txManager)
              .execute(
                  st ->
                      baseDsl.fetchCount(
                          AUDIT_LOG,
                          AUDIT_LOG
                              .ACTION_TYPE
                              .eq("SHARE_LINK_LOCKED")
                              .and(AUDIT_LOG.RESOURCE_ID.eq(String.valueOf(driveFileId)))
                              .and(AUDIT_LOG.TENANT_ID.eq(1L))));
      assertThat(inTenant).isEqualTo(1);
    } finally {
      TenantContext.clear();
    }
  }

  /** 틀린 비밀번호 요청 CONCURRENT 개를 한꺼번에 출발시켜 각 결과(값 또는 예외)를 돌려준다. */
  private List<Object> sendWrongPasswordsAtOnce() throws Exception {
    ExecutorService pool = Executors.newFixedThreadPool(CONCURRENT);
    CountDownLatch start = new CountDownLatch(1);
    try {
      List<Future<Object>> futures = new ArrayList<>();
      for (int i = 0; i < CONCURRENT; i++) {
        futures.add(
            pool.submit(
                () -> {
                  start.await(10, TimeUnit.SECONDS);
                  try {
                    return service.resolveForDownload(token, "wrong", null, null, false);
                  } catch (RuntimeException e) {
                    return e;
                  }
                }));
      }
      start.countDown();
      List<Object> results = new ArrayList<>();
      for (Future<Object> f : futures) results.add(f.get(60, TimeUnit.SECONDS));
      return results;
    } finally {
      pool.shutdownNow();
    }
  }

  private long user() {
    String s = UUID.randomUUID().toString().substring(0, 8);
    long id =
        baseDsl
            .insertInto(USER)
            .set(USER.USERNAME, "race-" + s)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, "race")
            .set(USER.EMAIL, "race-" + s + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    users.add(id);
    return id;
  }
}
