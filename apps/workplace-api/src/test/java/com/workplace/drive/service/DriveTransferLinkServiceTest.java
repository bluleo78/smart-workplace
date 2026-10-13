package com.workplace.drive.service;

import static com.workplace.jooq.Tables.DRIVE_SPACE_MEMBER;
import static com.workplace.jooq.Tables.DRIVE_TRANSFER_LINK;
import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.TENANT;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.drive.dto.DriveDownloadLinkResponse;
import com.workplace.drive.exception.DriveFileNotFoundException;
import com.workplace.drive.exception.DriveSpaceNotFoundException;
import com.workplace.drive.exception.DriveTransferLinkForbiddenException;
import com.workplace.drive.exception.DriveTransferLinkGoneException;
import com.workplace.drive.exception.DriveTransferLinkNotFoundException;
import com.workplace.drive.repository.DriveTransferLinkRepository;
import com.workplace.drive.repository.DriveTransferLinkRepository.TransferLinkRow;
import com.workplace.file.service.FileUploadService.FileContentResult;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.transaction.annotation.Transactional;

/**
 * 드라이브 전송 링크(WP-369) 발급·소비·발급자 재확인 서비스 통합 테스트. 공개 HTTP 경로(트랜잭션 밖 소비·동시성·HEAD)는 {@code
 * PublicDriveTransferControllerIntegrationTest} 가 커밋된 데이터로 따로 검증한다.
 */
@Transactional
class DriveTransferLinkServiceTest extends IntegrationTestBase {
  @Autowired DSLContext dsl;
  @Autowired DriveTransferLinkService transfers;
  @Autowired DriveTransferLinkRepository links;
  @Autowired DriveFileService fileService;
  @Autowired DriveSpaceService spaceService;

  private long owner;
  private long viewer;
  private long spaceId;
  private long driveFileId;

  @BeforeEach
  void seed() throws Exception {
    TenantContext.set(1L);
    owner = withMembership(TestFixtures.createHuman(dsl));
    viewer = withMembership(TestFixtures.createHuman(dsl));
    String s = UUID.randomUUID().toString().substring(0, 8);
    spaceId = spaceService.createTeamSpace(owner, "전송_" + s).id();
    dsl.insertInto(DRIVE_SPACE_MEMBER)
        .set(DRIVE_SPACE_MEMBER.SPACE_ID, spaceId)
        .set(DRIVE_SPACE_MEMBER.USER_ID, viewer)
        .set(DRIVE_SPACE_MEMBER.ROLE, "VIEWER")
        .execute();
    driveFileId =
        fileService
            .upload(
                owner,
                spaceId,
                null,
                new MockMultipartFile(
                    "file", "보고서.txt", "text/plain", "hello".getBytes(StandardCharsets.UTF_8)))
            .id();
  }

  @AfterEach
  void clearCtx() {
    TenantContext.clear();
  }

  /** 토큰 부분(dl_...)만 떼어낸다. */
  private static String tokenOf(DriveDownloadLinkResponse r) {
    return r.url().substring(r.url().lastIndexOf('/') + 1);
  }

  @Test
  void issue_viewer_returnsSingleUseUrlAndMeta_andStoresOnlyHash() throws Exception {
    OffsetDateTime before = OffsetDateTime.now();
    DriveDownloadLinkResponse r = transfers.issueDownloadLink(viewer, driveFileId);

    assertThat(r.url()).startsWith("http://localhost:6173/api/v1/public/drive/transfer/dl_");
    assertThat(r.singleUse()).isTrue();
    assertThat(r.name()).isEqualTo("보고서.txt");
    assertThat(r.sizeBytes()).isEqualTo(5L);
    assertThat(r.mimeType()).startsWith("text/plain");
    assertThat(r.expiresAt())
        .isAfter(before.plus(Duration.ofMinutes(9)))
        .isBefore(before.plus(Duration.ofMinutes(11)));

    String token = tokenOf(r);
    var row =
        dsl.selectFrom(DRIVE_TRANSFER_LINK)
            .where(DRIVE_TRANSFER_LINK.TOKEN_HASH.eq(DriveShareLinkService.sha256Hex(token)))
            .fetchOne();
    assertThat(row).isNotNull();
    assertThat(row.getKind()).isEqualTo("DOWNLOAD");
    assertThat(row.getUserId()).isEqualTo(viewer);
    assertThat(row.getSpaceId()).isEqualTo(spaceId);
    assertThat(row.getDriveFileId()).isEqualTo(driveFileId);
    assertThat(row.getUsedAt()).isNull();
    assertThat(row.getTenantId()).isEqualTo(1L);
    // 평문 토큰은 어디에도 저장하지 않는다
    assertThat(row.getTokenHash()).isNotEqualTo(token).hasSize(64);
  }

  @Test
  void issue_nonMember_isNotFound() {
    long outsider = withMembership(TestFixtures.createHuman(dsl));
    assertThatThrownBy(() -> transfers.issueDownloadLink(outsider, driveFileId))
        .isInstanceOf(DriveSpaceNotFoundException.class);
  }

  @Test
  void issue_trashedFile_isNotFound() {
    fileService.delete(owner, driveFileId);
    assertThatThrownBy(() -> transfers.issueDownloadLink(owner, driveFileId))
        .isInstanceOf(DriveFileNotFoundException.class);
  }

  /** 발급 시 발급자의 만료 행만 지운다 — 만료 전 사용된 행·다른 사용자 행은 남는다(재사용 410 유지). */
  @Test
  void issue_cleansOnlyIssuersExpiredRows() throws Exception {
    OffsetDateTime past = OffsetDateTime.now().minusMinutes(1);
    OffsetDateTime future = OffsetDateTime.now().plusMinutes(5);
    long expiredMine =
        links.insert("DOWNLOAD", hash(), viewer, spaceId, null, driveFileId, null, past);
    long usedMine =
        links.insert("DOWNLOAD", hash(), viewer, spaceId, null, driveFileId, null, future);
    dsl.update(DRIVE_TRANSFER_LINK)
        .set(DRIVE_TRANSFER_LINK.USED_AT, OffsetDateTime.now())
        .where(DRIVE_TRANSFER_LINK.ID.eq(usedMine))
        .execute();
    long expiredOthers =
        links.insert("DOWNLOAD", hash(), owner, spaceId, null, driveFileId, null, past);

    transfers.issueDownloadLink(viewer, driveFileId);

    assertThat(exists(expiredMine)).isFalse();
    assertThat(exists(usedMine)).isTrue();
    assertThat(exists(expiredOthers)).isTrue();
  }

  @Test
  void consume_once_thenSecondIsGone() throws Exception {
    String token = tokenOf(transfers.issueDownloadLink(viewer, driveFileId));
    TenantContext.clear(); // 공개 경로: 컨텍스트 없음

    TransferLinkRow link = transfers.consume(token, DriveTransferLinkService.KIND_DOWNLOAD);
    assertThat(link.tenantId()).isEqualTo(1L);
    assertThat(link.userId()).isEqualTo(viewer);
    assertThat(link.driveFileId()).isEqualTo(driveFileId);
    assertThat(link.usedAt()).isNotNull();

    assertThatThrownBy(() -> transfers.consume(token, DriveTransferLinkService.KIND_DOWNLOAD))
        .isInstanceOf(DriveTransferLinkGoneException.class)
        .hasMessageContaining("새 링크를 발급받으세요");
  }

  @Test
  void consume_unknownOrWrongPrefix_isNotFound() throws Exception {
    String token = tokenOf(transfers.issueDownloadLink(viewer, driveFileId));
    TenantContext.clear();
    assertThatThrownBy(() -> transfers.consume("dl_nope", DriveTransferLinkService.KIND_DOWNLOAD))
        .isInstanceOf(DriveTransferLinkNotFoundException.class)
        .hasMessageContaining("새 링크를 발급받으세요");
    assertThatThrownBy(() -> transfers.consume("garbage", DriveTransferLinkService.KIND_DOWNLOAD))
        .isInstanceOf(DriveTransferLinkNotFoundException.class);
    // 다운로드 토큰을 업로드 종류로 쓰면 "없는 토큰" — 그리고 소비되지 않는다
    assertThatThrownBy(() -> transfers.consume(token, DriveTransferLinkService.KIND_UPLOAD))
        .isInstanceOf(DriveTransferLinkNotFoundException.class);
    assertThat(transfers.consume(token, DriveTransferLinkService.KIND_DOWNLOAD)).isNotNull();
  }

  @Test
  void consume_expired_isGone() throws Exception {
    String token = tokenOf(transfers.issueDownloadLink(viewer, driveFileId));
    dsl.update(DRIVE_TRANSFER_LINK)
        .set(DRIVE_TRANSFER_LINK.EXPIRES_AT, OffsetDateTime.now().minusSeconds(1))
        .where(DRIVE_TRANSFER_LINK.TOKEN_HASH.eq(DriveShareLinkService.sha256Hex(token)))
        .execute();
    TenantContext.clear();
    assertThatThrownBy(() -> transfers.consume(token, DriveTransferLinkService.KIND_DOWNLOAD))
        .isInstanceOf(DriveTransferLinkGoneException.class);
  }

  /** 정지·삭제된 테넌트의 링크는 "없음"(404) — 링크 존재를 드러내지 않는다. (상태 변경은 테스트 롤백으로 원복, 캐시 TTL=0) */
  @Test
  void consume_inactiveTenant_isNotFound() throws Exception {
    String token = tokenOf(transfers.issueDownloadLink(viewer, driveFileId));
    dsl.update(TENANT).set(TENANT.STATUS, "SUSPENDED").where(TENANT.ID.eq(1L)).execute();
    TenantContext.clear();
    assertThatThrownBy(() -> transfers.consume(token, DriveTransferLinkService.KIND_DOWNLOAD))
        .isInstanceOf(DriveTransferLinkNotFoundException.class);
  }

  @Test
  void open_asIssuer_returnsContentWithDriveName() throws Exception {
    TransferLinkRow link = issueAndConsume(viewer);
    TenantContext.set(link.tenantId());
    FileContentResult c = transfers.openDownloadAsIssuer(link);
    assertThat(c.originalName()).isEqualTo("보고서.txt");
    assertThat(c.size()).isEqualTo(5L);
  }

  /** 발급 뒤 공간 멤버에서 빠지면 403(공간 비멤버의 404 은닉이 아니라 "권한 상실"). */
  @Test
  void open_issuerRemovedFromSpace_isForbidden() throws Exception {
    TransferLinkRow link = issueAndConsume(viewer);
    TenantContext.set(1L);
    dsl.deleteFrom(DRIVE_SPACE_MEMBER)
        .where(DRIVE_SPACE_MEMBER.SPACE_ID.eq(spaceId))
        .and(DRIVE_SPACE_MEMBER.USER_ID.eq(viewer))
        .execute();
    assertThatThrownBy(() -> transfers.openDownloadAsIssuer(link))
        .isInstanceOf(DriveTransferLinkForbiddenException.class)
        .hasMessageContaining("새 링크를 발급받으세요")
        .hasMessageNotContaining(String.valueOf(viewer));
  }

  /** 발급 뒤 워크스페이스 멤버십이 정지되면(공간 멤버 행이 남아 있어도) 403. */
  @Test
  void open_issuerLeftWorkspace_isForbidden() throws Exception {
    TransferLinkRow link = issueAndConsume(viewer);
    TenantContext.set(1L);
    // app_tenant 는 membership DELETE 권한이 없다 — 정지(SUSPENDED)로 "ACTIVE 멤버 아님"을 만든다
    dsl.update(MEMBERSHIP)
        .set(MEMBERSHIP.STATUS, "SUSPENDED")
        .where(MEMBERSHIP.USER_ID.eq(viewer))
        .and(MEMBERSHIP.TENANT_ID.eq(1L))
        .execute();
    assertThatThrownBy(() -> transfers.openDownloadAsIssuer(link))
        .isInstanceOf(DriveTransferLinkForbiddenException.class);
  }

  @Test
  void open_trashedFile_isNotFound() throws Exception {
    TransferLinkRow link = issueAndConsume(viewer);
    TenantContext.set(1L);
    fileService.delete(owner, driveFileId);
    assertThatThrownBy(() -> transfers.openDownloadAsIssuer(link))
        .isInstanceOf(DriveTransferLinkNotFoundException.class)
        .hasMessageContaining("새 링크를 발급받으세요");
  }

  // --- 헬퍼 ---

  private TransferLinkRow issueAndConsume(long issuer) throws Exception {
    String token = tokenOf(transfers.issueDownloadLink(issuer, driveFileId));
    TenantContext.clear();
    return transfers.consume(token, DriveTransferLinkService.KIND_DOWNLOAD);
  }

  private static String hash() {
    return DriveShareLinkService.sha256Hex(UUID.randomUUID().toString());
  }

  private boolean exists(long id) {
    return dsl.fetchExists(DRIVE_TRANSFER_LINK, DRIVE_TRANSFER_LINK.ID.eq(id));
  }
}
