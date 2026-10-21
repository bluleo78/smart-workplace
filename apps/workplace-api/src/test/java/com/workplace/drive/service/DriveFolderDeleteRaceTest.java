package com.workplace.drive.service;

import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.DRIVE_FILE;
import static com.workplace.jooq.Tables.DRIVE_FOLDER;
import static com.workplace.jooq.Tables.DRIVE_SPACE;
import static com.workplace.jooq.Tables.DRIVE_SPACE_MEMBER;
import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.drive.exception.DriveFolderNotFoundException;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 폴더 삭제와 그 폴더로의 쓰기(이동·생성·업로드)가 겹칠 때(WP-764) — 어느 쪽이 먼저든 넣은 항목이 휴지통 폴더 안에 살아 남지 않는다.
 *
 * <p>삭제가 먼저면 나중 쓰기는 휴지통 폴더라 404, 쓰기가 먼저면 삭제가 그 항목까지 함께 휴지통으로 보낸다. 고치기 전에는 삭제가 하위 목록을 먼저 모은 뒤 표시하고,
 * 쓰기는 대상 폴더를 잠그지 않아 둘 다 성공한 채 「휴지통 폴더 안의 살아 있는 항목」이 남았다(어디에도 보이지 않음). 먼저 요청을 트랜잭션을 연 채(커밋 전) 멈춰 두고
 * 나중 요청을 보내 결정적으로 만든다.
 */
class DriveFolderDeleteRaceTest extends IntegrationTestBase {

  @Autowired DriveFolderService folderService;
  @Autowired DriveFileService fileService;
  @Autowired DriveSpaceService spaceService;

  private long ownerId;
  private long spaceId;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    ownerId =
        baseDsl
            .insertInto(USER)
            .set(USER.USERNAME, "dr_" + s)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, "Dr" + s)
            .set(USER.EMAIL, "dr_" + s + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    spaceId = spaceService.createTeamSpace(ownerId, "삭제경합_" + s).id();
  }

  @AfterEach
  void cleanup() {
    baseDsl.deleteFrom(DRIVE_FILE).where(DRIVE_FILE.SPACE_ID.eq(spaceId)).execute();
    baseDsl
        .update(DRIVE_FOLDER)
        .setNull(DRIVE_FOLDER.PARENT_ID)
        .where(DRIVE_FOLDER.SPACE_ID.eq(spaceId))
        .execute();
    baseDsl.deleteFrom(DRIVE_FOLDER).where(DRIVE_FOLDER.SPACE_ID.eq(spaceId)).execute();
    baseDsl.deleteFrom(DRIVE_SPACE_MEMBER).where(DRIVE_SPACE_MEMBER.SPACE_ID.eq(spaceId)).execute();
    baseDsl.deleteFrom(DRIVE_SPACE).where(DRIVE_SPACE.ID.eq(spaceId)).execute();
    baseDsl.deleteFrom(AUDIT_LOG).where(AUDIT_LOG.USER_ID.eq(ownerId)).execute();
    baseDsl.deleteFrom(FILE).where(FILE.UPLOADED_BY.eq(ownerId)).execute();
    baseDsl.deleteFrom(USER).where(USER.ID.eq(ownerId)).execute();
    TenantContext.clear();
  }

  private long folder(Long parentId, String name) {
    return folderService.create(ownerId, spaceId, parentId, name).id();
  }

  private boolean folderTrashed(long id) {
    return baseDsl.fetchExists(
        DRIVE_FOLDER, DRIVE_FOLDER.ID.eq(id).and(DRIVE_FOLDER.TRASHED_AT.isNotNull()));
  }

  private boolean fileTrashed(long driveFileId) {
    return baseDsl.fetchExists(
        DRIVE_FILE, DRIVE_FILE.ID.eq(driveFileId).and(DRIVE_FILE.TRASHED_AT.isNotNull()));
  }

  private long upload(Long folderId) throws Exception {
    return fileService
        .upload(
            ownerId,
            spaceId,
            folderId,
            new MockMultipartFile("file", "u.txt", "text/plain", "x".getBytes()))
        .id();
  }

  /**
   * first 를 트랜잭션 안에서 실행하고 커밋 전에 멈춘 뒤 second 를 보내, 잠시 뒤 first 를 커밋시킨다. second 의 결과(값 또는 예외)를 돌려준다.
   */
  private Object race(Runnable first, Callable<Object> second) throws Exception {
    CountDownLatch firstDone = new CountDownLatch(1);
    CountDownLatch release = new CountDownLatch(1);
    ExecutorService pool = Executors.newFixedThreadPool(2);
    try {
      Future<?> f1 =
          pool.submit(
              () -> {
                TenantContext.set(1L);
                try {
                  new TransactionTemplate(txManager)
                      .executeWithoutResult(
                          st -> {
                            first.run();
                            firstDone.countDown();
                            try {
                              release.await(20, TimeUnit.SECONDS);
                            } catch (InterruptedException e) {
                              Thread.currentThread().interrupt();
                            }
                          });
                } finally {
                  TenantContext.clear();
                }
              });
      firstDone.await(10, TimeUnit.SECONDS);
      Future<Object> f2 =
          pool.submit(
              () -> {
                TenantContext.set(1L);
                try {
                  return second.call();
                } catch (Exception e) {
                  return e;
                } finally {
                  TenantContext.clear();
                }
              });
      Thread.sleep(800);
      release.countDown();
      f1.get(20, TimeUnit.SECONDS);
      return f2.get(20, TimeUnit.SECONDS);
    } finally {
      release.countDown();
      pool.shutdownNow();
      pool.awaitTermination(30, TimeUnit.SECONDS);
    }
  }

  @Test
  void 삭제가_먼저면_그_폴더로의_이동은_404이고_옮길_폴더는_그대로() throws Exception {
    long y = folder(null, "Y");
    long x = folder(null, "X");
    Object r =
        race(
            () -> folderService.delete(ownerId, y),
            () -> {
              folderService.move(ownerId, x, y);
              return "moved";
            });
    assertThat(r).isInstanceOf(DriveFolderNotFoundException.class);
    assertThat(folderTrashed(x)).isFalse();
  }

  @Test
  void 삭제가_먼저면_그_폴더_안_폴더_생성과_업로드는_404() throws Exception {
    long y = folder(null, "Y");
    Object created = race(() -> folderService.delete(ownerId, y), () -> folder(y, "새 폴더"));
    assertThat(created).isInstanceOf(DriveFolderNotFoundException.class);
    long y2 = folder(null, "Y2");
    Object uploaded = race(() -> folderService.delete(ownerId, y2), () -> upload(y2));
    assertThat(uploaded).isInstanceOf(DriveFolderNotFoundException.class);
  }

  @Test
  void 이동이_먼저면_삭제가_옮겨진_폴더까지_휴지통으로_보낸다() throws Exception {
    long y = folder(null, "Y");
    long z = folder(y, "Z");
    long x = folder(null, "X");
    // 깊은 하위(Z)로 옮겨도 함께 간다.
    Object r =
        race(
            () -> folderService.move(ownerId, x, z),
            () -> {
              folderService.delete(ownerId, y);
              return "deleted";
            });
    assertThat(r).isEqualTo("deleted");
    assertThat(folderTrashed(x)).isTrue();
  }

  @Test
  void 업로드가_먼저면_삭제가_그_파일까지_휴지통으로_보낸다() throws Exception {
    long y = folder(null, "Y");
    long[] fileId = new long[1];
    Object r =
        race(
            () -> {
              try {
                fileId[0] = upload(y);
              } catch (Exception e) {
                throw new RuntimeException(e);
              }
            },
            () -> {
              folderService.delete(ownerId, y);
              return "deleted";
            });
    assertThat(r).isEqualTo("deleted");
    assertThat(fileTrashed(fileId[0])).isTrue();
  }
}
