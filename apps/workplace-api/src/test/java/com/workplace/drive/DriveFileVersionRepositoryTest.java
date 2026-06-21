package com.workplace.drive;

import static com.workplace.jooq.Tables.DRIVE_FILE;
import static com.workplace.jooq.Tables.DRIVE_SPACE;
import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.drive.repository.DriveFileVersionRepository;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** 클래스-레벨 {@code @Transactional}: 종료 후 자동 롤백으로 공유 test DB 오염(쿼터 합산) 방지. */
@Transactional
class DriveFileVersionRepositoryTest extends IntegrationTestBase {
  @Autowired DriveFileVersionRepository versions;
  @Autowired DSLContext dsl;

  @BeforeEach
  void setTenant() {
    TenantContext.set(1L);
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  private long seedUser() {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "v_" + s)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "Ver" + s)
        .set(USER.EMAIL, "v_" + s + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  private long seedFile(long uploader) {
    return dsl.insertInto(FILE)
        .set(FILE.ORIGINAL_NAME, "a.txt")
        .set(FILE.STORED_NAME, UUID.randomUUID() + ".txt")
        .set(FILE.MIME_TYPE, "text/plain")
        .set(FILE.SIZE_BYTES, 100L)
        .set(FILE.STORAGE_PATH, "/tmp/x")
        .set(FILE.UPLOADED_BY, uploader)
        .returning(FILE.ID)
        .fetchOne()
        .getId();
  }

  private long seedDriveFile(long spaceId, long fileId) {
    return dsl.insertInto(DRIVE_FILE)
        .set(DRIVE_FILE.SPACE_ID, spaceId)
        .set(DRIVE_FILE.FILE_ID, fileId)
        .set(DRIVE_FILE.NAME, "a.txt")
        .returning(DRIVE_FILE.ID)
        .fetchOne()
        .getId();
  }

  private long seedSpace(long owner) {
    return dsl.insertInto(DRIVE_SPACE)
        .set(DRIVE_SPACE.TYPE, "TEAM")
        .set(DRIVE_SPACE.NAME, "S")
        .set(DRIVE_SPACE.OWNER_ID, owner)
        .returning(DRIVE_SPACE.ID)
        .fetchOne()
        .getId();
  }

  @Test
  void insert_후_nextVersionNo_와_목록() {
    long u = seedUser();
    long sp = seedSpace(u);
    long f1 = seedFile(u);
    long df = seedDriveFile(sp, f1);

    assertThat(versions.nextVersionNo(df)).isEqualTo(1);
    versions.insert(df, 1, f1, 100L, u, null);
    assertThat(versions.nextVersionNo(df)).isEqualTo(2);

    long f2 = seedFile(u);
    versions.insert(df, 2, f2, 100L, u, "v1에서 복원");

    var list = versions.listForDriveFile(df);
    assertThat(list).hasSize(2);
    assertThat(list.get(0).versionNo()).isEqualTo(2); // DESC
    assertThat(list.get(0).comment()).isEqualTo("v1에서 복원");
    assertThat(list.get(0).uploadedByName()).isNotBlank();

    assertThat(versions.findVersion(df, 1)).isPresent();
    assertThat(versions.fileIdsForDriveFile(df)).containsExactlyInAnyOrder(f1, f2);
  }
}
