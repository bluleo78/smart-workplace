package com.workplace.drive.service;

import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.DRIVE_FILE;
import static com.workplace.jooq.Tables.DRIVE_SPACE;
import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.doAnswer;

import com.workplace.drive.dto.DriveFileResponse;
import com.workplace.drive.exception.DriveFileNotFoundException;
import com.workplace.drive.repository.DriveFileVersionRepository;
import com.workplace.drive.repository.DriveQuotaRepository;
import com.workplace.file.service.UploadSource;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 지정 파일 새 버전과 휴지통 이동·이름 변경의 경합(WP-369). 호출부의 findRow 를 통과한 뒤 다른 트랜잭션이 휴지통 이동을 커밋하면, 공유 저장 핵심이
 * advisory lock 다음에 잡는 행 잠금(FOR UPDATE)이 trashed_at 을 다시 보고 404 로 거절해야 한다 — 휴지통 파일에 버전이 붙거나 고아 blob
 * 이 남지 않게.
 *
 * <p>결정적 재현: advisory lock 을 스파이로 감싸, 잠금을 잡은 바로 그 순간 별도 트랜잭션(REQUIRES_NEW, 다른 커넥션)에서 휴지통 이동·이름 변경을
 * 커밋한다. 스레드·시간 대기 없이 "findRow 뒤 · 행 잠금 전" 지점에 정확히 끼운다(부하에 흔들리지 않는다). 다른 커넥션의 커밋을 봐야 하므로
 * {@code @Transactional} 을 붙이지 않고 수동 정리한다. 스파이로 컨텍스트가 하나 더 생기므로 이 경합만 따로 둔다.
 */
class DriveFileVersionLockRaceTest extends IntegrationTestBase {
  @MockitoSpyBean DriveQuotaRepository quotaRepo;
  @Autowired DSLContext dsl;
  @Autowired DriveFileService fileService;
  @Autowired DriveSpaceService spaceService;
  @Autowired DriveFileVersionRepository versionsRepo;

  /** advisory lock 을 잡은 직후 한 번 실행할 끼워 넣기 동작(없으면 그대로 통과). */
  private final AtomicReference<Runnable> afterAdvisoryLock = new AtomicReference<>();

  private long owner;
  private long spaceId;
  private long driveFileId;

  @BeforeEach
  void seed() throws Exception {
    TenantContext.set(1L);
    doAnswer(
            inv -> {
              inv.callRealMethod();
              Runnable hook = afterAdvisoryLock.getAndSet(null);
              if (hook != null) {
                hook.run();
              }
              return null;
            })
        .when(quotaRepo)
        .advisoryLockTenant(anyLong());
    new TransactionTemplate(txManager)
        .executeWithoutResult(
            st -> {
              owner = withMembership(TestFixtures.createHuman(dsl));
              spaceId =
                  spaceService
                      .createTeamSpace(owner, "경합_" + UUID.randomUUID().toString().substring(0, 8))
                      .id();
            });
    driveFileId = fileService.createTextFile(owner, spaceId, null, "경합.md", "v1", null).id();
  }

  @AfterEach
  void cleanup() {
    afterAdvisoryLock.set(null);
    cleanupInTenant(
        1L,
        () -> {
          // 공간 삭제가 파일·버전을 FK CASCADE 로 함께 지운다.
          dsl.deleteFrom(DRIVE_SPACE).where(DRIVE_SPACE.ID.eq(spaceId)).execute();
          dsl.deleteFrom(AUDIT_LOG).where(AUDIT_LOG.USER_ID.eq(owner)).execute();
          dsl.deleteFrom(FILE).where(FILE.UPLOADED_BY.eq(owner)).execute();
          dsl.deleteFrom(USER).where(USER.ID.eq(owner)).execute();
        });
    TenantContext.clear();
  }

  /** 끼워 넣을 동작을 별도 트랜잭션(다른 커넥션)에서 커밋한다 — 호출 스레드의 테넌트 컨텍스트(1)로 GUC 가 들어간다. */
  private Runnable committedElsewhere(Runnable action) {
    return () -> {
      TransactionTemplate tx = new TransactionTemplate(txManager);
      tx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
      tx.executeWithoutResult(st -> action.run());
    };
  }

  private int fileRowsOfOwner() {
    int[] count = new int[1];
    cleanupInTenant(1L, () -> count[0] = dsl.fetchCount(FILE, FILE.UPLOADED_BY.eq(owner)));
    return count[0];
  }

  private UploadSource body(String name) {
    return UploadSource.ofBytes(name, null, "v2".getBytes(StandardCharsets.UTF_8));
  }

  /**
   * findRow 뒤 · 행 잠금 전에 휴지통 이동이 커밋되면 버전 추가는 404 — 휴지통 파일의 버전은 1 그대로이고 새 FILE(blob) 행도 생기지 않는다(blob
   * 저장 전에 거절).
   */
  @Test
  void addVersion_trashCommittedAfterFindRow_isNotFound_andLeavesNoBlob() {
    int filesBefore = fileRowsOfOwner();
    afterAdvisoryLock.set(committedElsewhere(() -> fileService.delete(owner, driveFileId)));

    assertThatThrownBy(() -> fileService.addVersion(owner, driveFileId, body("경합.md")))
        .isInstanceOf(DriveFileNotFoundException.class);

    assertThat(afterAdvisoryLock.get()).as("끼워 넣기가 실제로 실행됐다").isNull();
    assertThat(fileRowsOfOwner()).isEqualTo(filesBefore);
    cleanupInTenant(
        1L,
        () -> {
          assertThat(versionsRepo.listForDriveFile(driveFileId)).hasSize(1);
          assertThat(
                  dsl.select(DRIVE_FILE.TRASHED_AT)
                      .from(DRIVE_FILE)
                      .where(DRIVE_FILE.ID.eq(driveFileId))
                      .fetchOne(DRIVE_FILE.TRASHED_AT))
              .isNotNull();
        });
  }

  /** 텍스트 갱신도 같은 핵심을 탄다 — 같은 지점의 휴지통 이동이면 404, 버전은 1 그대로. */
  @Test
  void updateTextFile_trashCommittedAfterFindRow_isNotFound() {
    afterAdvisoryLock.set(committedElsewhere(() -> fileService.delete(owner, driveFileId)));

    assertThatThrownBy(() -> fileService.updateTextFile(owner, driveFileId, "v2", null))
        .isInstanceOf(DriveFileNotFoundException.class);

    assertThat(afterAdvisoryLock.get()).isNull();
    cleanupInTenant(1L, () -> assertThat(versionsRepo.listForDriveFile(driveFileId)).hasSize(1));
  }

  /** findRow 뒤 · 행 잠금 전에 이름이 바뀌면 저장 이름(FILE 원본 이름)은 잠금 아래에서 읽은 새 이름이다. */
  @Test
  void addVersion_renameCommittedAfterFindRow_storesLockedName() throws Exception {
    afterAdvisoryLock.set(
        committedElsewhere(() -> fileService.rename(owner, driveFileId, "바뀐 경합.md")));

    DriveFileResponse v2 = fileService.addVersion(owner, driveFileId, body("경합.md"));

    assertThat(afterAdvisoryLock.get()).isNull();
    assertThat(v2.id()).isEqualTo(driveFileId);
    assertThat(v2.versionCount()).isEqualTo(2);
    assertThat(v2.name()).isEqualTo("바뀐 경합.md");
    cleanupInTenant(
        1L,
        () ->
            assertThat(
                    dsl.select(FILE.ORIGINAL_NAME)
                        .from(FILE)
                        .where(FILE.ID.eq(v2.fileId()))
                        .fetchOne(FILE.ORIGINAL_NAME))
                .isEqualTo("바뀐 경합.md"));
  }
}
