package com.workplace.drive.service;

import static com.workplace.global.realtime.ResourceChangedEvent.OP_CREATED;
import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.DRIVE_FILE;
import static com.workplace.jooq.Tables.DRIVE_SPACE;
import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.nullable;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.verify;

import com.workplace.drive.dto.DriveFileResponse;
import com.workplace.drive.exception.DriveFileNotFoundException;
import com.workplace.drive.exception.DriveTransferUploadRejectedException;
import com.workplace.drive.outbound.DriveChangeNotifier;
import com.workplace.drive.repository.DriveFileRepository;
import com.workplace.drive.repository.DriveFileVersionRepository;
import com.workplace.drive.repository.DriveQuotaRepository;
import com.workplace.drive.repository.DriveTransferLinkRepository.TransferLinkRow;
import com.workplace.drive.service.DriveTransferLinkService.ReceivedBody;
import com.workplace.file.service.UploadSource;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
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
 *
 * <p>이름 경로(같은 이름 업로드·텍스트 만들기)는 동명 행 조회가 이미 advisory lock 뒤라, 끼워 넣기를 조회({@code findActiveByName})
 * 직후에 둔다 — advisory 직후에 두면 고치기 전 코드도 조회에서 휴지통 파일을 못 찾아 통과해 버린다.
 *
 * <p>검증 한계(최종 리뷰 M5): 끼워 넣은 변경은 행 잠금 시도 <b>전에</b> 커밋되므로, 이 테스트는 "잠글 때 다시 본다"만 검증하고 FOR UPDATE 가 상대
 * 트랜잭션 커밋을 <b>기다린 뒤</b> 다시 평가하는 경로(READ COMMITTED 의 EvalPlanQual)는 PostgreSQL 표준 의미에 맡긴다 — 그 경로를
 * 결정적으로 만들려면 스레드·대기가 필요하다.
 */
class DriveFileVersionLockRaceTest extends IntegrationTestBase {
  @MockitoSpyBean DriveQuotaRepository quotaRepo;
  @MockitoSpyBean DriveFileRepository filesRepo;

  /**
   * 변경 알림은 끈다 — 끼워 넣은 트랜잭션의 커밋 뒤(AFTER_COMMIT) SSE 디스패처가 REQUIRES_NEW 로 커넥션을 하나 더 열려 하는데, 테스트
   * 풀(2개)은 바깥 트랜잭션과 끼워 넣은 트랜잭션이 이미 쥐고 있어 30초(Hikari 대기 상한)를 기다린 뒤 실패한다. 경합 검증과 무관한 실시간 대기를 없앤다.
   */
  @MockitoBean DriveChangeNotifier notifier;

  @Autowired DSLContext dsl;
  @Autowired DriveFileService fileService;
  @Autowired DriveSpaceService spaceService;
  @Autowired DriveFileVersionRepository versionsRepo;
  @Autowired DriveTransferLinkService transfers;

  /** advisory lock 을 잡은 직후 한 번 실행할 끼워 넣기 동작(없으면 그대로 통과). */
  private final AtomicReference<Runnable> afterAdvisoryLock = new AtomicReference<>();

  /** 동명 활성 파일 조회 직후 한 번 실행할 끼워 넣기 동작(이름 경로용, 없으면 그대로 통과). */
  private final AtomicReference<Runnable> afterFindByName = new AtomicReference<>();

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
    doAnswer(
            inv -> {
              Object found = inv.callRealMethod();
              Runnable hook = afterFindByName.getAndSet(null);
              if (hook != null) {
                hook.run();
              }
              return found;
            })
        .when(filesRepo)
        .findActiveByName(anyLong(), nullable(Long.class), anyString());
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
    afterFindByName.set(null);
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

  /**
   * 이름 경로(최종 리뷰 I1): 같은 이름으로 텍스트를 만들 때 동명 행을 찾은 직후 휴지통 이동이 커밋되면, 잠글 때 다시 보고 휴지통 파일 대신 새 파일 + v1 이
   * 된다 — 휴지통 파일의 버전은 1 그대로라 올린 내용이 휴지통으로 사라지지 않는다.
   */
  @Test
  void createTextFile_sameNameTrashedAfterLookup_becomesNewFile() throws Exception {
    afterFindByName.set(committedElsewhere(() -> fileService.delete(owner, driveFileId)));

    DriveFileResponse created =
        fileService.createTextFile(owner, spaceId, null, "경합.md", "v2", null);

    assertThat(afterFindByName.get()).as("끼워 넣기가 실제로 실행됐다").isNull();
    assertThat(created.id()).isNotEqualTo(driveFileId);
    assertThat(created.versionCount()).isEqualTo(1);
    // 변경 알림도 휴지통 파일이 아니라 새 파일 id 로 나간다.
    verify(notifier).itemsChanged(OP_CREATED, spaceId, List.of(created.id()), owner);
    cleanupInTenant(1L, () -> assertThat(versionsRepo.listForDriveFile(driveFileId)).hasSize(1));
  }

  /**
   * 롤백(최종 리뷰 I1): findRow 뒤 · 행 잠금 전에 휴지통 이동이 커밋되면 404 — 휴지통 파일에 버전이 붙지 않고 복제 blob(FILE 행)도 남지 않는다.
   */
  @Test
  void rollback_trashCommittedAfterFindRow_isNotFound_andLeavesNoCopy() {
    int filesBefore = fileRowsOfOwner();
    afterAdvisoryLock.set(committedElsewhere(() -> fileService.delete(owner, driveFileId)));

    assertThatThrownBy(() -> fileService.rollback(owner, driveFileId, 1))
        .isInstanceOf(DriveFileNotFoundException.class);

    assertThat(afterAdvisoryLock.get()).isNull();
    assertThat(fileRowsOfOwner()).isEqualTo(filesBefore);
    cleanupInTenant(1L, () -> assertThat(versionsRepo.listForDriveFile(driveFileId)).hasSize(1));
  }

  /**
   * 3자 경합(최종 리뷰 m1): 같은 이름 파일을 찾은 직후 그 파일은 다른 이름으로, 다른 파일은 이 이름으로 바뀌면(한 트랜잭션으로 커밋) 잠근 행이 이름 검사에서
   * 빠진다. 한 번 더 찾아 새로 그 이름이 된 파일을 잠가 새 버전으로 흡수한다 — 새 파일을 만들다 유일 인덱스에 걸리지 않는다.
   */
  @Test
  void createTextFile_renamedAwayAndInAfterLookup_absorbsIntoNewHolder() throws Exception {
    long other = fileService.createTextFile(owner, spaceId, null, "다른.md", "o1", null).id();
    afterFindByName.set(
        committedElsewhere(
            () -> {
              fileService.rename(owner, driveFileId, "비켜난.md");
              fileService.rename(owner, other, "경합.md");
            }));

    DriveFileResponse saved = fileService.createTextFile(owner, spaceId, null, "경합.md", "v2", null);

    assertThat(afterFindByName.get()).isNull();
    assertThat(saved.id()).isEqualTo(other);
    assertThat(saved.versionCount()).isEqualTo(2);
    cleanupInTenant(1L, () -> assertThat(versionsRepo.listForDriveFile(driveFileId)).hasSize(1));
  }

  /**
   * 동명 파일이 없다고 본 직후 다른 파일이 그 이름으로 바뀌면 새 파일 삽입이 유일 인덱스에 걸린다 — 업로드 링크 PUT 은 이를 409 "같은 이름의 파일이 방금
   * 생겼습니다"로 바꾼다(최종 리뷰 m1). 끼워 넣기는 advisory lock 을 잡지 않는 이름 변경이라 교착하지 않는다.
   */
  @Test
  void completeUpload_nameTakenAfterLookup_isConflict() throws Exception {
    afterFindByName.set(committedElsewhere(() -> fileService.rename(owner, driveFileId, "새이름.md")));
    Path body = Files.createTempFile("wp369-race", ".md");
    Files.writeString(body, "본문");
    TransferLinkRow link =
        new TransferLinkRow(
            0L,
            1L,
            DriveTransferLinkService.KIND_UPLOAD,
            owner,
            spaceId,
            null,
            null,
            "새이름.md",
            OffsetDateTime.now().plusMinutes(10),
            OffsetDateTime.now());

    try (ReceivedBody received = new ReceivedBody(body, Files.size(body), "text/markdown")) {
      assertThatThrownBy(() -> transfers.completeUpload(link, received, "127.0.0.1", "test"))
          .isInstanceOfSatisfying(
              DriveTransferUploadRejectedException.class,
              e -> {
                assertThat(e.status()).isEqualTo(HttpStatus.CONFLICT);
                assertThat(e.getMessage()).isEqualTo("같은 이름의 파일이 방금 생겼습니다. 새 링크를 발급받으세요");
              });
    }
    assertThat(afterFindByName.get()).isNull();
  }
}
