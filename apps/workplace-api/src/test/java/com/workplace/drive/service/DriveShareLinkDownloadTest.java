package com.workplace.drive.service;

import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.DRIVE_FILE;
import static com.workplace.jooq.Tables.DRIVE_SHARE_LINK_ATTEMPTS;
import static com.workplace.jooq.Tables.DRIVE_SPACE;
import static com.workplace.jooq.Tables.DRIVE_SPACE_MEMBER;
import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.drive.dto.CreateShareLinkRequest;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** 공유 링크 공개 resolve + 2-트랜잭션 다운로드 통합 테스트. */
@Transactional
class DriveShareLinkDownloadTest extends IntegrationTestBase {
  @Autowired DSLContext dsl;
  @Autowired DriveShareLinkService service;
  @Autowired DriveFileService fileService;

  // 잠금 카운터는 REQUIRES_NEW 로 독립 커밋되어 테스트 트랜잭션 롤백에 영향받지 않으므로, 사용한 token_hash 를
  // 추적해 @AfterEach 에서 회수한다(#700).
  private final List<String> createdTokenHashes = new ArrayList<>();

  @BeforeEach
  void setCtx() {
    TenantContext.set(1L);
  }

  @AfterEach
  void clearCtx() {
    TenantContext.clear();
    if (!createdTokenHashes.isEmpty()) {
      dsl.deleteFrom(DRIVE_SHARE_LINK_ATTEMPTS)
          .where(DRIVE_SHARE_LINK_ATTEMPTS.TOKEN_HASH.in(createdTokenHashes))
          .execute();
      createdTokenHashes.clear();
    }
  }

  @Test
  void resolve_external_noPassword_succeeds() {
    long owner = seedUser();
    long fileId = seedFile(seedSpace(owner));
    var created = service.create(owner, fileId, new CreateShareLinkRequest("EXTERNAL", null, null));
    TenantContext.clear(); // 익명 상황 모사
    var target = service.resolveForDownload(created.token(), null, null, false);
    assertThat(target.driveFileId()).isEqualTo(fileId);
    assertThat(target.tenantId()).isEqualTo(1L);
  }

  @Test
  void resolve_revoked_isGone() {
    long owner = seedUser();
    long fileId = seedFile(seedSpace(owner));
    var created = service.create(owner, fileId, new CreateShareLinkRequest("EXTERNAL", null, null));
    service.revoke(owner, created.id());
    TenantContext.clear();
    assertThatThrownBy(() -> service.resolveForDownload(created.token(), null, null, false))
        .isInstanceOf(com.workplace.drive.exception.DriveShareLinkGoneException.class);
  }

  @Test
  void resolve_wrongPassword_unauthorized() {
    long owner = seedUser();
    long fileId = seedFile(seedSpace(owner));
    var created =
        service.create(owner, fileId, new CreateShareLinkRequest("EXTERNAL", "secret", null));
    TenantContext.clear();
    assertThatThrownBy(() -> service.resolveForDownload(created.token(), "wrong", null, false))
        .isInstanceOf(com.workplace.drive.exception.DriveShareLinkUnauthorizedException.class);
    // 정답이면 통과
    assertThat(service.resolveForDownload(created.token(), "secret", null, false).driveFileId())
        .isEqualTo(fileId);
  }

  /** 5회 연속 실패 시 잠금 + 감사 로그 기록, 잠금 중에는 정답 비밀번호도 거부(#700). */
  @Test
  void resolve_wrongPassword_5thFailure_locksAndAudits() {
    long owner = seedUser();
    long fileId = seedFile(seedSpace(owner));
    var created =
        service.create(owner, fileId, new CreateShareLinkRequest("EXTERNAL", "secret", null));
    String tokenHash = DriveShareLinkService.sha256Hex(created.token());
    createdTokenHashes.add(tokenHash);
    TenantContext.clear();

    // 4회는 일반 실패(401 상당) — 아직 잠기지 않음
    for (int i = 0; i < 4; i++) {
      assertThatThrownBy(() -> service.resolveForDownload(created.token(), "wrong", null, false))
          .isInstanceOf(com.workplace.drive.exception.DriveShareLinkUnauthorizedException.class);
    }
    // 5번째 실패 — 이번 실패로 잠금 발동 + 감사 로그 기록
    assertThatThrownBy(() -> service.resolveForDownload(created.token(), "wrong", null, false))
        .isInstanceOf(com.workplace.drive.exception.DriveShareLinkUnauthorizedException.class);

    // 잠긴 상태에서는 정답 비밀번호도 429 상당 예외로 거부
    assertThatThrownBy(() -> service.resolveForDownload(created.token(), "secret", null, false))
        .isInstanceOf(com.workplace.drive.exception.DriveShareLinkLockedException.class);

    int auditCount =
        dsl.fetchCount(
            dsl.selectOne()
                .from(AUDIT_LOG)
                .where(AUDIT_LOG.ACTION_TYPE.eq("SHARE_LINK_LOCKED"))
                .and(AUDIT_LOG.RESOURCE_ID.eq(String.valueOf(fileId))));
    assertThat(auditCount).isGreaterThanOrEqualTo(1);
  }

  /** 실패 4회 이하로는 잠기지 않고, 정답 비밀번호로 카운터가 리셋된다(#700). */
  @Test
  void resolve_wrongPassword_underThreshold_thenCorrect_resetsCounter() {
    long owner = seedUser();
    long fileId = seedFile(seedSpace(owner));
    var created =
        service.create(owner, fileId, new CreateShareLinkRequest("EXTERNAL", "secret", null));
    createdTokenHashes.add(DriveShareLinkService.sha256Hex(created.token()));
    TenantContext.clear();

    for (int i = 0; i < 3; i++) {
      assertThatThrownBy(() -> service.resolveForDownload(created.token(), "wrong", null, false))
          .isInstanceOf(com.workplace.drive.exception.DriveShareLinkUnauthorizedException.class);
    }
    // 잠금 임계치(5) 미달 — 정답이면 통과하고 카운터 리셋
    assertThat(service.resolveForDownload(created.token(), "secret", null, false).driveFileId())
        .isEqualTo(fileId);
  }

  @Test
  void resolve_internal_anonymous_unauthorized() {
    long owner = seedUser();
    long fileId = seedFile(seedSpace(owner));
    var created = service.create(owner, fileId, new CreateShareLinkRequest("INTERNAL", null, null));
    TenantContext.clear();
    assertThatThrownBy(() -> service.resolveForDownload(created.token(), null, null, false))
        .isInstanceOf(com.workplace.drive.exception.DriveShareLinkUnauthorizedException.class);
    // 같은 테넌트 인증 사용자는 통과
    assertThat(service.resolveForDownload(created.token(), null, 1L, true).driveFileId())
        .isEqualTo(fileId);
  }

  /** 사내(INTERNAL) 링크에 다른 테넌트 사용자가 접근하면 403 DriveForbiddenException. */
  @Test
  void resolve_internal_crossTenant_isForbidden() {
    long owner = seedUser();
    long fileId = seedFile(seedSpace(owner));
    var created = service.create(owner, fileId, new CreateShareLinkRequest("INTERNAL", null, null));
    // requesterTenantId=2L(다른 테넌트) → 크로스테넌트 접근 차단
    assertThatThrownBy(() -> service.resolveForDownload(created.token(), null, 2L, true))
        .isInstanceOf(com.workplace.drive.exception.DriveForbiddenException.class);
  }

  @Test
  void resolve_trashedFile_thenDownload_notFound() throws Exception {
    long owner = seedUser();
    long spaceId = seedSpace(owner);
    long fileId = seedFile(spaceId);
    var created = service.create(owner, fileId, new CreateShareLinkRequest("EXTERNAL", null, null));
    fileService.delete(owner, fileId); // 휴지통(soft) → findRow 제외
    TenantContext.clear();
    var target = service.resolveForDownload(created.token(), null, null, false);
    // 2-트랜잭션: 컨텍스트 설정 후 다운로드 시도 → trashed → NotFound
    TenantContext.set(target.tenantId());
    assertThatThrownBy(() -> fileService.downloadViaShareLink(target.driveFileId()))
        .isInstanceOf(com.workplace.drive.exception.DriveFileNotFoundException.class);
  }

  // --- 시드 헬퍼 ---

  private long seedUser() {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "dl_" + s)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "Dl" + s)
        .set(USER.EMAIL, "dl_" + s + "@example.com")
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

  /** file core + drive_file 행 삽입. UPLOADED_BY 는 임시 사용자로 자동 생성. */
  private long seedFile(long spaceId) {
    long uploadedBy = seedUser();
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
