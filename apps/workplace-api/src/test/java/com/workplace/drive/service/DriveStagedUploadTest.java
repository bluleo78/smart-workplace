package com.workplace.drive.service;

import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.DRIVE_SPACE;
import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.drive.dto.DriveFileResponse;
import com.workplace.drive.exception.DriveDuplicateNameException;
import com.workplace.file.service.UploadSource;
import com.workplace.file.storage.FileStore;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 드라이브 「blob 먼저 쓰기」(WP-1519) — 1GB 동영상 복사 동안 테넌트 할당량 advisory lock·DB 트랜잭션을 쥐지 않도록 blob 을 트랜잭션 밖에서
 * 쓰고, 저장이 실패하면 써 둔 blob 을 지우는지 본다. 운영 요청처럼 트랜잭션 밖에서 불러야 하므로 비-{@code @Transactional}(커밋) 테스트다.
 */
class DriveStagedUploadTest extends IntegrationTestBase {
  @Autowired DSLContext dsl;
  @Autowired DriveStagedUpload stagedUpload;
  @Autowired DriveFileService fileService;
  @Autowired DriveSpaceService spaceService;
  @Autowired FileStore fileStore;

  private final List<Long> userIds = new ArrayList<>();
  private long owner;
  private long spaceId;

  /** 쓰기 시점을 기록하는 출처 — 트랜잭션 안에서 썼는지, 어느 경로에 썼는지. */
  private static final class RecordingWriter implements UploadSource.Writer {
    final byte[] bytes;
    Boolean txActiveAtWrite;
    String writtenPath;

    RecordingWriter(byte[] bytes) {
      this.bytes = bytes;
    }

    @Override
    public void writeTo(FileStore store, String relativePath) {
      txActiveAtWrite = TransactionSynchronizationManager.isActualTransactionActive();
      writtenPath = relativePath;
      store.storeBytes(relativePath, bytes);
    }
  }

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    new TransactionTemplate(txManager)
        .executeWithoutResult(
            st -> {
              owner = withMembership(TestFixtures.createHuman(dsl));
              userIds.add(owner);
              spaceId =
                  spaceService
                      .createTeamSpace(
                          owner, "먼저쓰기_" + UUID.randomUUID().toString().substring(0, 8))
                      .id();
            });
  }

  @AfterEach
  void cleanup() {
    TenantContext.clear();
    cleanupInTenant(
        1L,
        () -> {
          dsl.deleteFrom(DRIVE_SPACE).where(DRIVE_SPACE.ID.eq(spaceId)).execute();
          dsl.deleteFrom(AUDIT_LOG).where(AUDIT_LOG.USER_ID.in(userIds)).execute();
          dsl.deleteFrom(FILE).where(FILE.UPLOADED_BY.in(userIds)).execute();
          dsl.deleteFrom(USER).where(USER.ID.in(userIds)).execute();
        });
    userIds.clear();
  }

  @Test
  void blob_isWrittenOutsideTransaction_andFileRowPointsToThatBlob() throws Exception {
    byte[] content = "fake-mp4".getBytes(StandardCharsets.UTF_8);
    RecordingWriter writer = new RecordingWriter(content);
    UploadSource source = new UploadSource("영상.mp4", "video/mp4", content.length, writer);

    DriveFileResponse saved =
        stagedUpload.run(source, s -> fileService.upload(owner, spaceId, null, s));

    // 바이트는 트랜잭션(=advisory xact lock·풀 커넥션) 밖에서 한 번만 썼다
    assertThat(writer.txActiveAtWrite).isFalse();
    String storagePath =
        new TransactionTemplate(txManager)
            .execute(
                st ->
                    dsl.select(FILE.STORAGE_PATH, FILE.CATEGORY)
                        .from(FILE)
                        .where(FILE.ID.eq(saved.fileId()))
                        .fetchOne(FILE.STORAGE_PATH));
    assertThat(storagePath).isEqualTo(writer.writtenPath);
    assertThat(fileStore.exists(storagePath)).isTrue();
  }

  @Test
  void failedSave_deletesStagedBlob() throws Exception {
    byte[] first = "first".getBytes(StandardCharsets.UTF_8);
    stagedUpload.run(
        new UploadSource("같은이름.mp4", "video/mp4", first.length, new RecordingWriter(first)),
        s -> fileService.upload(owner, spaceId, null, s));

    // 새 파일로만 저장(메일 첨부 저장 경로) — 같은 이름이 있어 잠금 아래에서 409. 미리 써 둔 blob 은 남지 않아야 한다.
    byte[] second = "second".getBytes(StandardCharsets.UTF_8);
    RecordingWriter writer = new RecordingWriter(second);
    assertThatThrownBy(
            () ->
                stagedUpload.run(
                    new UploadSource("같은이름.mp4", "video/mp4", second.length, writer),
                    s -> fileService.uploadNew(owner, spaceId, null, s)))
        .isInstanceOf(DriveDuplicateNameException.class);

    assertThat(writer.writtenPath).isNotNull();
    assertThat(fileStore.exists(writer.writtenPath)).isFalse();
  }
}
