package com.workplace.file.service;

import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.file.storage.FileStore;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * FileCleanupService 통합 테스트.
 *
 * <p>jOOQ DSLContext를 실제 DB와 함께 사용하여 만료 파일 정리 로직을 검증한다. FILE 테이블에 만료된/유효한 레코드를 삽입하고
 * cleanupExpiredFiles() 호출 후 DB 레코드 삭제 여부를 검증한다. 실제 파일 I/O는 @TempDir을 활용하여 격리한다.
 */
@Transactional
class FileCleanupServiceTest extends IntegrationTestBase {

  @Autowired private FileCleanupService fileCleanupService;
  @Autowired private DSLContext dsl;
  @Autowired private FileStore fileStore;

  /** 테스트용 사용자 ID — uploaded_by FK 제약 충족을 위해 필요 */
  private Long testUserId;

  @BeforeEach
  void setUp() {
    // RLS(V53) 적용 후 FILE INSERT 가 WITH CHECK 를 통과하려면 트랜잭션에 app.tenant_id GUC 가
    // 있어야 한다. 요청 필터를 흉내내 tenant#1 컨텍스트를 명시(세션 기본 GUC 에 암묵 의존하지 않도록).
    TenantContext.set(1L);
    testUserId =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "file_cleanup_user")
            .set(USER.PASSWORD, "password")
            .set(USER.NAME, "File Cleanup User")
            .set(USER.EMAIL, "file_cleanup@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  // =========================================================================
  // cleanupExpiredFiles — 만료 파일 정리
  // =========================================================================

  /**
   * 정상: 만료된 파일 레코드가 있으면 DB에서 삭제되어야 한다. expires_at이 과거인 레코드를 삽입 후 cleanupExpiredFiles() 호출 시 해당 레코드가
   * 삭제된다.
   */
  @Test
  void cleanupExpiredFiles_expiredRecord_deletedFromDb(@TempDir Path tempDir) throws IOException {
    // 만료된 파일 생성 (실제 파일 경로를 DB에 저장)
    Path expiredFile = tempDir.resolve("expired-upload.csv");
    Files.createFile(expiredFile);

    // FILE 테이블에 만료된 레코드 삽입 (expires_at = 1시간 전)
    OffsetDateTime expiredAt = OffsetDateTime.now(ZoneOffset.UTC).minusHours(1);
    dsl.insertInto(FILE)
        .set(FILE.ORIGINAL_NAME, "expired-upload.csv")
        .set(FILE.STORED_NAME, "expired-upload-stored.csv")
        .set(FILE.STORAGE_PATH, expiredFile.toString())
        .set(FILE.MIME_TYPE, "text/csv")
        .set(FILE.SIZE_BYTES, 100L)
        .set(FILE.CATEGORY, "IMPORT")
        .set(FILE.UPLOADED_BY, testUserId)
        .set(FILE.EXPIRES_AT, expiredAt)
        .execute();

    fileCleanupService.cleanupExpiredForCurrentTenant();

    // DB 레코드가 삭제되어야 함
    int remaining = dsl.fetchCount(FILE, FILE.STORAGE_PATH.eq(expiredFile.toString()));
    assertThat(remaining).isEqualTo(0);

    // 실제 파일도 삭제되어야 함
    assertThat(expiredFile).doesNotExist();
  }

  /** 정상: 만료되지 않은 파일 레코드는 삭제되지 않아야 한다. expires_at이 미래인 레코드는 cleanupExpiredFiles() 호출 후에도 유지된다. */
  @Test
  void cleanupExpiredFiles_validRecord_notDeleted(@TempDir Path tempDir) throws IOException {
    Path validFile = tempDir.resolve("valid-upload.csv");
    Files.createFile(validFile);

    // 유효한 레코드 삽입 (expires_at = 1시간 후)
    OffsetDateTime futureExpiry = OffsetDateTime.now(ZoneOffset.UTC).plusHours(1);
    dsl.insertInto(FILE)
        .set(FILE.ORIGINAL_NAME, "valid-upload.csv")
        .set(FILE.STORED_NAME, "valid-upload-stored.csv")
        .set(FILE.STORAGE_PATH, validFile.toString())
        .set(FILE.MIME_TYPE, "text/csv")
        .set(FILE.SIZE_BYTES, 100L)
        .set(FILE.CATEGORY, "IMPORT")
        .set(FILE.UPLOADED_BY, testUserId)
        .set(FILE.EXPIRES_AT, futureExpiry)
        .execute();

    fileCleanupService.cleanupExpiredForCurrentTenant();

    // DB 레코드가 유지되어야 함
    int remaining = dsl.fetchCount(FILE, FILE.STORAGE_PATH.eq(validFile.toString()));
    assertThat(remaining).isEqualTo(1);

    // 실제 파일도 유지되어야 함
    assertThat(validFile).exists();
  }

  /** 엣지 케이스: 만료된 레코드가 없으면 아무것도 삭제하지 않아야 한다. 빈 테이블에서 cleanupExpiredFiles() 호출 시 예외 없이 종료된다. */
  @Test
  void cleanupExpiredFiles_noExpiredRecords_noException() {
    // FILE 테이블이 비어있는 상태에서 호출
    fileCleanupService.cleanupExpiredForCurrentTenant();

    // 예외 없이 완료 (assertion 불필요 — 예외 발생 시 테스트 실패)
  }

  /**
   * 버그 회귀: 디스크 파일 삭제 실패 시 DB 레코드는 유지되어야 한다.
   *
   * <p>존재하지 않는 경로(삭제 불가 경로)를 DB에 등록한 후 cleanupExpiredFiles() 호출 시 DB 레코드가 유지되는지 검증한다. 이슈 #152: 디스크
   * 삭제 실패 시에도 DB 레코드가 삭제되어 고아 파일(orphan) 발생하는 버그 재현 방지.
   */
  @Test
  void cleanupExpiredFiles_diskDeleteFails_dbRecordRetained(@TempDir Path tempDir)
      throws IOException {
    // 만료된 파일을 생성하고 권한을 제거하여 삭제 불가 상태로 만듦
    Path undeletableFile = tempDir.resolve("locked-upload.csv");
    Files.createFile(undeletableFile);
    // 부모 디렉토리를 읽기 전용으로 설정하여 Files.deleteIfExists() 실패 유도
    undeletableFile.toFile().getParentFile().setWritable(false);

    OffsetDateTime expiredAt = OffsetDateTime.now(ZoneOffset.UTC).minusHours(1);
    dsl.insertInto(FILE)
        .set(FILE.ORIGINAL_NAME, "locked-upload.csv")
        .set(FILE.STORED_NAME, "locked-upload-stored.csv")
        .set(FILE.STORAGE_PATH, undeletableFile.toString())
        .set(FILE.MIME_TYPE, "text/csv")
        .set(FILE.SIZE_BYTES, 100L)
        .set(FILE.CATEGORY, "IMPORT")
        .set(FILE.UPLOADED_BY, testUserId)
        .set(FILE.EXPIRES_AT, expiredAt)
        .execute();

    try {
      fileCleanupService.cleanupExpiredForCurrentTenant();

      // 디스크 삭제 실패 시 DB 레코드는 반드시 유지되어야 함 (고아 파일 방지)
      int remaining = dsl.fetchCount(FILE, FILE.STORAGE_PATH.eq(undeletableFile.toString()));
      assertThat(remaining).isEqualTo(1);
    } finally {
      // 테스트 후 디렉토리 쓰기 권한 복원 (TempDir 정리를 위해)
      undeletableFile.toFile().getParentFile().setWritable(true);
    }
  }

  /**
   * 회귀 가드: DB 에 상대경로로 저장된 만료 파일이 FileStore.resolve() 를 경유해 올바르게 삭제되어야 한다.
   *
   * <p>storage_path 를 상대경로(예: tenant-1/files/uuid.txt) 로 저장하고 FileStore 루트 기준으로 실제 파일을 생성한다.
   * cleanup 호출 후 디스크 파일이 삭제되고 DB 레코드도 제거됨을 검증한다. 이전 코드(Path.of(relativeStoragePath)) 는 CWD 기준으로 해석해
   * 파일을 찾지 못해 이 테스트가 실패했을 것이다.
   */
  @Test
  void cleanupExpiredFiles_relativeStoragePath_deletesFileAndDbRow() throws IOException {
    // 상대경로로 저장되는 신규 방식 경로 (storage root 기준)
    String relativeStoragePath = "tenant-1/files/cleanup-regression-test.txt";
    Path absolutePath = fileStore.resolve(relativeStoragePath);
    Files.createDirectories(absolutePath.getParent());
    Files.writeString(absolutePath, "regression-guard");

    OffsetDateTime expiredAt = OffsetDateTime.now(ZoneOffset.UTC).minusHours(1);
    dsl.insertInto(FILE)
        .set(FILE.ORIGINAL_NAME, "cleanup-regression-test.txt")
        .set(FILE.STORED_NAME, "cleanup-regression-test.txt")
        .set(FILE.STORAGE_PATH, relativeStoragePath) // 상대경로 저장
        .set(FILE.MIME_TYPE, "text/plain")
        .set(FILE.SIZE_BYTES, 16L)
        .set(FILE.CATEGORY, "IMPORT")
        .set(FILE.UPLOADED_BY, testUserId)
        .set(FILE.EXPIRES_AT, expiredAt)
        .execute();

    fileCleanupService.cleanupExpiredForCurrentTenant();

    // 디스크 파일이 삭제되어야 함 (이전 코드는 CWD 에서 찾아 실패 → 파일 잔존)
    assertThat(absolutePath).doesNotExist();
    // DB 레코드도 삭제되어야 함
    int remaining = dsl.fetchCount(FILE, FILE.STORAGE_PATH.eq(relativeStoragePath));
    assertThat(remaining).isEqualTo(0);
  }

  /**
   * 혼합 시나리오: 일부 파일 삭제 성공, 일부 실패 시 성공한 파일의 DB 레코드만 삭제되어야 한다.
   *
   * <p>이슈 #152 수정 검증 — 디스크 삭제 성공 경로만 IN 절로 지정하여 DB 삭제하는 로직을 확인한다.
   */
  @Test
  void cleanupExpiredFiles_partialDiskFailure_onlySuccessfulRecordsDeleted(@TempDir Path tempDir)
      throws IOException {
    // 삭제 가능한 만료 파일
    Path deletableFile = tempDir.resolve("deletable-upload.csv");
    Files.createFile(deletableFile);

    // 삭제 불가 만료 파일 (부모 디렉토리를 별도 서브디렉토리로 분리)
    Path lockedDir = tempDir.resolve("locked");
    Files.createDirectory(lockedDir);
    Path undeletableFile = lockedDir.resolve("locked-upload.csv");
    Files.createFile(undeletableFile);

    OffsetDateTime expiredAt = OffsetDateTime.now(ZoneOffset.UTC).minusHours(1);

    dsl.insertInto(FILE)
        .set(FILE.ORIGINAL_NAME, "deletable-upload.csv")
        .set(FILE.STORED_NAME, "deletable-stored.csv")
        .set(FILE.STORAGE_PATH, deletableFile.toString())
        .set(FILE.MIME_TYPE, "text/csv")
        .set(FILE.SIZE_BYTES, 100L)
        .set(FILE.CATEGORY, "IMPORT")
        .set(FILE.UPLOADED_BY, testUserId)
        .set(FILE.EXPIRES_AT, expiredAt)
        .execute();

    dsl.insertInto(FILE)
        .set(FILE.ORIGINAL_NAME, "locked-upload.csv")
        .set(FILE.STORED_NAME, "locked-stored.csv")
        .set(FILE.STORAGE_PATH, undeletableFile.toString())
        .set(FILE.MIME_TYPE, "text/csv")
        .set(FILE.SIZE_BYTES, 100L)
        .set(FILE.CATEGORY, "IMPORT")
        .set(FILE.UPLOADED_BY, testUserId)
        .set(FILE.EXPIRES_AT, expiredAt)
        .execute();

    // lockedDir 쓰기 권한 제거로 undeletableFile 삭제 불가 유도
    lockedDir.toFile().setWritable(false);

    try {
      fileCleanupService.cleanupExpiredForCurrentTenant();

      // 삭제 성공한 파일의 DB 레코드는 삭제되어야 함
      int deletableRemaining = dsl.fetchCount(FILE, FILE.STORAGE_PATH.eq(deletableFile.toString()));
      assertThat(deletableRemaining).isEqualTo(0);

      // 삭제 실패한 파일의 DB 레코드는 유지되어야 함
      int undeletableRemaining =
          dsl.fetchCount(FILE, FILE.STORAGE_PATH.eq(undeletableFile.toString()));
      assertThat(undeletableRemaining).isEqualTo(1);
    } finally {
      lockedDir.toFile().setWritable(true);
    }
  }
}
