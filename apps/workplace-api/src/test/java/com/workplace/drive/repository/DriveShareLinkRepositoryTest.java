package com.workplace.drive.repository;

import static com.workplace.jooq.Tables.DRIVE_FILE;
import static com.workplace.jooq.Tables.DRIVE_SHARE_LINK;
import static com.workplace.jooq.Tables.DRIVE_SPACE;
import static com.workplace.jooq.Tables.DRIVE_SPACE_MEMBER;
import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import java.time.OffsetDateTime;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

@Transactional
class DriveShareLinkRepositoryTest extends IntegrationTestBase {
  @Autowired DSLContext dsl;
  @Autowired DriveShareLinkRepository repo;

  @BeforeEach
  void setCtx() {
    TenantContext.set(1L);
  }

  @AfterEach
  void clearCtx() {
    TenantContext.clear();
  }

  @Test
  void insert_list_revoke_roundtrip() {
    long userId = seedUser();
    long spaceId = seedSpace(userId);
    long fileId = seedFile(userId, spaceId);

    long linkId = repo.insert(fileId, spaceId, "hash1", "enc1", "EXTERNAL", null, null, userId);
    var list = repo.listByFile(fileId);
    assertThat(list).hasSize(1);
    assertThat(list.get(0).id()).isEqualTo(linkId);
    assertThat(list.get(0).revoked()).isFalse();
    assertThat(list.get(0).hasPassword()).isFalse();
    assertThat(list.get(0).active()).isTrue();
    assertThat(list.get(0).tokenEncrypted()).isEqualTo("enc1");
    assertThat(list.get(0).tokenHash()).isEqualTo("hash1");
    assertThat(repo.findRow(linkId)).contains(list.get(0));

    assertThat(repo.findSpaceIdOfActive(linkId)).contains(spaceId);
    assertThat(repo.revoke(linkId)).isEqualTo(1);
    assertThat(repo.revoke(linkId)).isZero(); // 멱등
    assertThat(repo.findSpaceIdOfActive(linkId)).isEmpty();
    assertThat(repo.listByFile(fileId).get(0).revoked()).isTrue();
    assertThat(repo.listByFile(fileId).get(0).active()).isFalse();
  }

  @Test
  void resolve_returnsTenantAndFile() {
    long userId = seedUser();
    long spaceId = seedSpace(userId);
    long fileId = seedFile(userId, spaceId);
    repo.insert(fileId, spaceId, "hash2", "enc2", "EXTERNAL", "pw", null, userId);

    var resolved = repo.resolve("hash2");
    assertThat(resolved).isPresent();
    assertThat(resolved.get().driveFileId()).isEqualTo(fileId);
    assertThat(resolved.get().tenantId()).isEqualTo(1L);
    assertThat(resolved.get().passwordHash()).isEqualTo("pw");
    assertThat(repo.resolve("nope")).isEmpty();
  }

  // 코드 리뷰: 같은 시각에 만든 링크(한 트랜잭션 안 now() 가 같음)도 순서가 흔들리지 않게 id 내림차순으로 끊는다.
  @Test
  void listByFile_sameCreatedAt_ordersByIdDesc() {
    long userId = seedUser();
    long spaceId = seedSpace(userId);
    long fileId = seedFile(userId, spaceId);
    long first = repo.insert(fileId, spaceId, "hash_t1", "enc", "EXTERNAL", null, null, userId);
    long second = repo.insert(fileId, spaceId, "hash_t2", "enc", "EXTERNAL", null, null, userId);
    long third = repo.insert(fileId, spaceId, "hash_t3", "enc", "EXTERNAL", null, null, userId);
    dsl.update(DRIVE_SHARE_LINK)
        .set(DRIVE_SHARE_LINK.CREATED_AT, OffsetDateTime.parse("2026-11-12T00:00:00Z"))
        .where(DRIVE_SHARE_LINK.DRIVE_FILE_ID.eq(fileId))
        .execute();

    assertThat(repo.listByFile(fileId).stream().map(r -> r.id()).toList())
        .containsExactly(third, second, first);
  }

  // --- 시드 헬퍼 (DriveFileServiceTest UUID-suffix 패턴) ---
  private long seedUser() {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "sl_" + s)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "Sl" + s)
        .set(USER.EMAIL, "sl_" + s + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  private long seedSpace(long ownerId) {
    long spaceId =
        dsl.insertInto(DRIVE_SPACE)
            .set(DRIVE_SPACE.TYPE, "TEAM")
            .set(DRIVE_SPACE.NAME, "sp")
            .set(DRIVE_SPACE.OWNER_ID, ownerId)
            .returning(DRIVE_SPACE.ID)
            .fetchOne()
            .getId();
    dsl.insertInto(DRIVE_SPACE_MEMBER)
        .set(DRIVE_SPACE_MEMBER.SPACE_ID, spaceId)
        .set(DRIVE_SPACE_MEMBER.USER_ID, ownerId)
        .set(DRIVE_SPACE_MEMBER.ROLE, "OWNER")
        .execute();
    return spaceId;
  }

  /** file core + drive_file 행 삽입. FILE 테이블의 NOT NULL 컬럼 전부 포함. */
  private long seedFile(long uploadedBy, long spaceId) {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    long coreFileId =
        dsl.insertInto(FILE)
            .set(FILE.ORIGINAL_NAME, "a.txt")
            .set(FILE.STORED_NAME, "stored-" + s)
            .set(FILE.STORAGE_PATH, "/tmp/a-" + s + ".txt")
            .set(FILE.MIME_TYPE, "text/plain")
            .set(FILE.SIZE_BYTES, 3L)
            .set(FILE.UPLOADED_BY, uploadedBy)
            .returning(FILE.ID)
            .fetchOne()
            .getId();
    return dsl.insertInto(DRIVE_FILE)
        .set(DRIVE_FILE.SPACE_ID, spaceId)
        .set(DRIVE_FILE.FILE_ID, coreFileId)
        .set(DRIVE_FILE.NAME, "a.txt")
        .returning(DRIVE_FILE.ID)
        .fetchOne()
        .getId();
  }
}
