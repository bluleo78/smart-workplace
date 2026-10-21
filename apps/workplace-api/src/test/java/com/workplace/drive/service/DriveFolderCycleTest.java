package com.workplace.drive.service;

import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.DRIVE_FOLDER;
import static com.workplace.jooq.Tables.DRIVE_SPACE;
import static com.workplace.jooq.Tables.DRIVE_SPACE_MEMBER;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertTimeoutPreemptively;

import com.workplace.drive.dto.DriveFolderResponse;
import com.workplace.drive.repository.DriveFolderRepository;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import java.time.Duration;
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
 * 폴더 순환(WP-762) — 서로의 하위로 동시에 옮겨도 순환이 생기지 않고, 이미 생긴 순환 폴더도 서브트리 순회가 끝나 지울 수 있다.
 *
 * <p>이동은 「대상이 내 하위가 아닌지 확인 → 부모 변경」이라, 두 이동이 서로의 확인을 지나친 뒤 각자 바꾸면 둘 다 성공해 A↔B 순환이 생겼다. 그 폴더를 지우면 방문
 * 기록이 없는 BFS 가 끝없이 돌아 요청이 끝나지 않았다. 동시성은 한 이동이 트랜잭션을 연 채(커밋 전) 기다리는 동안 다른 이동을 보내 결정적으로 만든다. 서비스가
 * 커밋하므로 클래스 레벨 @Transactional 없이 돌리고 공간째 정리한다.
 */
class DriveFolderCycleTest extends IntegrationTestBase {

  @Autowired DriveFolderService folderService;
  @Autowired DriveSpaceService spaceService;
  @Autowired DriveFolderRepository folders;

  private long ownerId;
  private long spaceId;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    ownerId =
        baseDsl
            .insertInto(USER)
            .set(USER.USERNAME, "cyc_" + s)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, "Cyc" + s)
            .set(USER.EMAIL, "cyc_" + s + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    spaceId = spaceService.createTeamSpace(ownerId, "순환_" + s).id();
  }

  @AfterEach
  void cleanup() {
    // 순환 행도 함께 지우도록 부모를 먼저 끊는다.
    baseDsl
        .update(DRIVE_FOLDER)
        .setNull(DRIVE_FOLDER.PARENT_ID)
        .where(DRIVE_FOLDER.SPACE_ID.eq(spaceId))
        .execute();
    baseDsl.deleteFrom(DRIVE_FOLDER).where(DRIVE_FOLDER.SPACE_ID.eq(spaceId)).execute();
    baseDsl.deleteFrom(DRIVE_SPACE_MEMBER).where(DRIVE_SPACE_MEMBER.SPACE_ID.eq(spaceId)).execute();
    baseDsl.deleteFrom(DRIVE_SPACE).where(DRIVE_SPACE.ID.eq(spaceId)).execute();
    baseDsl.deleteFrom(AUDIT_LOG).where(AUDIT_LOG.USER_ID.eq(ownerId)).execute();
    baseDsl.deleteFrom(USER).where(USER.ID.eq(ownerId)).execute();
    TenantContext.clear();
  }

  private long folder(Long parentId, String name) {
    DriveFolderResponse f = folderService.create(ownerId, spaceId, parentId, name);
    return f.id();
  }

  private Long parentOf(long folderId) {
    return baseDsl
        .select(DRIVE_FOLDER.PARENT_ID)
        .from(DRIVE_FOLDER)
        .where(DRIVE_FOLDER.ID.eq(folderId))
        .fetchOne(DRIVE_FOLDER.PARENT_ID);
  }

  /** a 에서 부모를 따라 올라가다 a 로 돌아오면 순환. */
  private boolean inCycle(long a) {
    Long cur = parentOf(a);
    for (int i = 0; i < 100 && cur != null; i++) {
      if (cur == a) return true;
      cur = parentOf(cur);
    }
    return false;
  }

  @Test
  void 서로의_하위로_동시에_옮겨도_하나만_성공하고_순환이_생기지_않는다() throws Exception {
    long a = folder(null, "A");
    long a1 = folder(a, "a1");
    long b = folder(null, "B");
    long b1 = folder(b, "b1");

    CountDownLatch firstMoved = new CountDownLatch(1);
    CountDownLatch releaseFirst = new CountDownLatch(1);
    ExecutorService pool = Executors.newFixedThreadPool(2);
    try {
      // 첫 이동(A → b1)은 트랜잭션을 연 채 커밋 전에 멈춘다.
      Future<Boolean> first =
          pool.submit(
              () -> {
                TenantContext.set(1L);
                try {
                  new TransactionTemplate(txManager)
                      .executeWithoutResult(
                          st -> {
                            folderService.move(ownerId, a, b1);
                            firstMoved.countDown();
                            await(releaseFirst);
                          });
                  return true;
                } finally {
                  TenantContext.clear();
                }
              });
      firstMoved.await(10, TimeUnit.SECONDS);
      // 둘째 이동(B → a1) — 첫 이동이 커밋되기 전에 보낸다.
      Future<Boolean> second =
          pool.submit(
              () -> {
                TenantContext.set(1L);
                try {
                  folderService.move(ownerId, b, a1);
                  return true;
                } catch (RuntimeException e) {
                  return false;
                } finally {
                  TenantContext.clear();
                }
              });
      // 둘째가 첫 이동을 기다리든 먼저 끝나든, 잠시 뒤 첫 이동을 커밋시킨다.
      Thread.sleep(1000);
      releaseFirst.countDown();
      assertThat(first.get(20, TimeUnit.SECONDS)).isTrue();
      boolean secondOk = second.get(20, TimeUnit.SECONDS);

      assertThat(secondOk).as("둘째 이동은 첫 이동 뒤 상태로 다시 판정돼 거절돼야 한다").isFalse();
      assertThat(parentOf(a)).isEqualTo(b1);
      assertThat(parentOf(b)).isNull();
      assertThat(inCycle(a)).isFalse();
    } finally {
      releaseFirst.countDown();
      pool.shutdownNow();
      pool.awaitTermination(30, TimeUnit.SECONDS);
    }
  }

  @Test
  void 이미_생긴_순환_폴더도_서브트리_순회가_끝나_지울_수_있다() {
    // 고치기 전 경합으로 저장된 순환을 DB 로 만든다: A → b1 → B → a1 → A
    long a = folder(null, "A");
    long a1 = folder(a, "a1");
    long b = folder(null, "B");
    long b1 = folder(b, "b1");
    baseDsl
        .update(DRIVE_FOLDER)
        .set(DRIVE_FOLDER.PARENT_ID, b1)
        .where(DRIVE_FOLDER.ID.eq(a))
        .execute();
    baseDsl
        .update(DRIVE_FOLDER)
        .set(DRIVE_FOLDER.PARENT_ID, a1)
        .where(DRIVE_FOLDER.ID.eq(b))
        .execute();

    List<Long> subtree =
        assertTimeoutPreemptively(Duration.ofSeconds(5), () -> folders.findSubtreeFolderIds(a));
    assertThat(subtree).containsExactlyInAnyOrder(a, a1, b, b1);
    assertTimeoutPreemptively(Duration.ofSeconds(5), () -> folderService.delete(ownerId, a));
    List<Long> trashed = new ArrayList<>();
    for (long id : List.of(a, a1, b, b1)) {
      if (baseDsl.fetchExists(
          DRIVE_FOLDER, DRIVE_FOLDER.ID.eq(id).and(DRIVE_FOLDER.TRASHED_AT.isNotNull()))) {
        trashed.add(id);
      }
    }
    assertThat(trashed).containsExactlyInAnyOrder(a, a1, b, b1);
  }

  private static void await(CountDownLatch latch) {
    try {
      latch.await(20, TimeUnit.SECONDS);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
    }
  }
}
