package com.workplace.messaging;

import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.tables.File.FILE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.jooq.tables.records.FileRecord;
import com.workplace.messaging.service.MessageAttachmentStorage;
import com.workplace.support.IntegrationTestBase;
import java.time.OffsetDateTime;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.transaction.annotation.Transactional;

/** MessageAttachmentStorage 통합 테스트 — 임시 file 행 INSERT 검증. */
@Transactional
class MessageAttachmentStorageTest extends IntegrationTestBase {

  @Autowired MessageAttachmentStorage storage;
  @Autowired DSLContext dsl;

  private long uploaderId;

  /** 테스트 격리를 위해 UUID suffix 유니크 유저 INSERT 후 ID 반환. */
  private long seedUser() {
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "attch_" + suffix)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "Attch" + suffix)
        .set(USER.EMAIL, "attch_" + suffix + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  @BeforeEach
  void setUp() {
    uploaderId = seedUser();
  }

  @Test
  void storeTemporary_setsAttachmentCategoryAndExpiry() throws Exception {
    var mf = new MockMultipartFile("files", "a.png", "image/png", new byte[] {1, 2, 3});

    Long fileId = storage.storeTemporary(mf, uploaderId);

    FileRecord row = dsl.selectFrom(FILE).where(FILE.ID.eq(fileId)).fetchOne();
    assertThat(row).isNotNull();
    assertThat(row.getCategory()).isEqualTo("ATTACHMENT");
    assertThat(row.getMimeType()).isEqualTo("image/png");
    assertThat(row.getExpiresAt()).isAfter(OffsetDateTime.now());
  }
}
