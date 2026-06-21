package com.workplace.drive.repository;

import static com.workplace.jooq.Tables.*;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

@Transactional
class DriveFileRepositoryLinkMetaTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired DriveFileRepository repo;

  @BeforeEach
  void t() {
    TenantContext.set(1L);
  }

  @AfterEach
  void c() {
    TenantContext.clear();
  }

  @Test
  void findLinkMeta_returnsMeta_evenWhenTrashed() {
    String s = UUID.randomUUID().toString().substring(0, 8);
    long u =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "u" + s)
            .set(USER.PASSWORD, "p")
            .set(USER.NAME, "U")
            .set(USER.EMAIL, "u" + s + "@x.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    long space =
        dsl.insertInto(DRIVE_SPACE)
            .set(DRIVE_SPACE.TYPE, "TEAM")
            .set(DRIVE_SPACE.NAME, "마케팅")
            .set(DRIVE_SPACE.OWNER_ID, u)
            .returning(DRIVE_SPACE.ID)
            .fetchOne()
            .getId();
    long file =
        dsl.insertInto(FILE)
            .set(FILE.ORIGINAL_NAME, "p.xlsx")
            .set(FILE.STORED_NAME, "x")
            .set(FILE.MIME_TYPE, "application/vnd.ms-excel")
            .set(FILE.SIZE_BYTES, 88L)
            .set(FILE.STORAGE_PATH, "/tmp/x")
            .set(FILE.UPLOADED_BY, u)
            .set(FILE.CREATED_AT, OffsetDateTime.now())
            .returning(FILE.ID)
            .fetchOne()
            .getId();
    long df =
        dsl.insertInto(DRIVE_FILE)
            .set(DRIVE_FILE.SPACE_ID, space)
            .set(DRIVE_FILE.FILE_ID, file)
            .set(DRIVE_FILE.NAME, "2026_로드맵.xlsx")
            .set(DRIVE_FILE.TRASHED_AT, OffsetDateTime.now(ZoneOffset.UTC)) // 휴지통 상태
            .returning(DRIVE_FILE.ID)
            .fetchOne()
            .getId();

    var meta = repo.findLinkMeta(df).orElseThrow();
    assertThat(meta.name()).isEqualTo("2026_로드맵.xlsx");
    assertThat(meta.spaceName()).isEqualTo("마케팅");
    assertThat(meta.sizeBytes()).isEqualTo(88L);
    assertThat(meta.trashed()).isTrue();
  }
}
