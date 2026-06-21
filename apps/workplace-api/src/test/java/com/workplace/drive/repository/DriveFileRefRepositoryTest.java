package com.workplace.drive.repository;

import static com.workplace.jooq.Tables.*;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import java.time.OffsetDateTime;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

@Transactional
class DriveFileRefRepositoryTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired DriveFileRefRepository repo;

  @BeforeEach
  void tenant() {
    TenantContext.set(1L);
  }

  @AfterEach
  void clear() {
    TenantContext.clear();
  }

  // USER + drive_space + drive_file 최소 픽스처를 직접 INSERT 해 driveFileId 확보
  private long seedUser() {
    String s = UUID.randomUUID().toString().substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "u-" + s)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "U")
        .set(USER.EMAIL, "u-" + s + "@x.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  private long seedDriveFile(long owner) {
    long spaceId =
        dsl.insertInto(DRIVE_SPACE)
            .set(DRIVE_SPACE.TYPE, "TEAM")
            .set(DRIVE_SPACE.NAME, "S")
            .set(DRIVE_SPACE.OWNER_ID, owner)
            .returning(DRIVE_SPACE.ID)
            .fetchOne()
            .getId();
    long fileId =
        dsl.insertInto(FILE)
            .set(FILE.ORIGINAL_NAME, "a.txt")
            .set(FILE.STORED_NAME, "s.txt")
            .set(FILE.MIME_TYPE, "text/plain")
            .set(FILE.SIZE_BYTES, 3L)
            .set(FILE.STORAGE_PATH, "/tmp/a")
            .set(FILE.UPLOADED_BY, owner)
            .set(FILE.CREATED_AT, OffsetDateTime.now())
            .returning(FILE.ID)
            .fetchOne()
            .getId();
    return dsl.insertInto(DRIVE_FILE)
        .set(DRIVE_FILE.SPACE_ID, spaceId)
        .set(DRIVE_FILE.FILE_ID, fileId)
        .set(DRIVE_FILE.NAME, "a.txt")
        .returning(DRIVE_FILE.ID)
        .fetchOne()
        .getId();
  }

  @Test
  void insertIgnore_isIdempotent_andLinkExists() {
    long u = seedUser();
    long df = seedDriveFile(u);

    assertThat(repo.linkExists(df, "ISSUE", 42L)).isFalse();
    assertThat(repo.insertIgnore(df, "ISSUE", 42L, u)).isTrue(); // 신규
    assertThat(repo.insertIgnore(df, "ISSUE", 42L, u)).isFalse(); // 중복 → DO NOTHING
    assertThat(repo.linkExists(df, "ISSUE", 42L)).isTrue();
    assertThat(repo.findCreatedBy(df, "ISSUE", 42L)).contains(u);
  }

  @Test
  void findByFile_and_findBySource_and_delete() {
    long u = seedUser();
    long df = seedDriveFile(u);
    repo.insertIgnore(df, "ISSUE", 7L, u);
    repo.insertIgnore(df, "MESSAGE", 9L, u);

    assertThat(repo.findByFile(df))
        .extracting(DriveFileRefRepository.SourceRef::sourceType)
        .containsExactlyInAnyOrder("ISSUE", "MESSAGE");
    assertThat(repo.findBySource("ISSUE", 7L)).hasSize(1);

    assertThat(repo.delete(df, "ISSUE", 7L)).isEqualTo(1);
    assertThat(repo.linkExists(df, "ISSUE", 7L)).isFalse();

    assertThat(repo.deleteAllForSource("MESSAGE", 9L)).isEqualTo(1);
    assertThat(repo.findByFile(df)).isEmpty();
  }
}
