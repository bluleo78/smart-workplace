package com.workplace.drive.service;

import static com.workplace.jooq.Tables.FILE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.transaction.annotation.Transactional;

/** purge 시 전 버전 blob 만료 검증 — 트랜잭션 내 롤백으로 공유 test DB 오염 없음. */
@Transactional
class DriveVersionPurgeTest extends IntegrationTestBase {
  @Autowired DriveFileService fileService;
  @Autowired DriveSpaceService spaceService;
  @Autowired DriveTrashService trashService;

  @Autowired com.workplace.drive.repository.DriveFileVersionRepository versions;

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
    return dsl.insertInto(com.workplace.jooq.Tables.USER)
        .set(com.workplace.jooq.Tables.USER.USERNAME, "pg_" + s)
        .set(com.workplace.jooq.Tables.USER.PASSWORD, "pw")
        .set(com.workplace.jooq.Tables.USER.NAME, "Pg" + s)
        .set(com.workplace.jooq.Tables.USER.EMAIL, "pg_" + s + "@example.com")
        .returning(com.workplace.jooq.Tables.USER.ID)
        .fetchOne()
        .getId();
  }

  @Test
  void purge_시_전버전_blob_만료() throws Exception {
    long u = seedUser();
    var sp = spaceService.createTeamSpace(u, "팀");
    // v1 업로드 후 동일 파일에 v2 업로드 → 두 개의 버전 blob 생성
    var f =
        fileService.upload(
            u,
            sp.id(),
            null,
            new MockMultipartFile("file", "x.txt", "text/plain", "v1".getBytes()));
    fileService.upload(
        u, sp.id(), null, new MockMultipartFile("file", "x.txt", "text/plain", "v2".getBytes()));
    var blobIds = versions.fileIdsForDriveFile(f.id());
    assertThat(blobIds).hasSize(2);

    // 휴지통 이동 → cutoff 미래 시각으로 즉시 영구삭제
    fileService.delete(u, f.id());
    trashService.purgeExpired(OffsetDateTime.now(ZoneOffset.UTC).plusDays(1));

    // 두 버전 blob 모두 expires_at 설정되어야 함
    for (Long fid : blobIds) {
      var exp =
          dsl.select(FILE.EXPIRES_AT).from(FILE).where(FILE.ID.eq(fid)).fetchOne(FILE.EXPIRES_AT);
      assertThat(exp).as("blob %s 의 expires_at 미설정", fid).isNotNull();
    }
  }
}
