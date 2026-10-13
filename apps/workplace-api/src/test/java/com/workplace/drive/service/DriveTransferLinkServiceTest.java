package com.workplace.drive.service;

import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.DRIVE_FILE;
import static com.workplace.jooq.Tables.DRIVE_SPACE_MEMBER;
import static com.workplace.jooq.Tables.DRIVE_TRANSFER_LINK;
import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.TENANT;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.drive.dto.CreateUploadLinkRequest;
import com.workplace.drive.dto.DriveDownloadLinkResponse;
import com.workplace.drive.dto.DriveFileResponse;
import com.workplace.drive.dto.DriveUploadLinkResponse;
import com.workplace.drive.exception.DriveFileNotFoundException;
import com.workplace.drive.exception.DriveFolderNotFoundException;
import com.workplace.drive.exception.DriveForbiddenException;
import com.workplace.drive.exception.DriveInvalidTargetException;
import com.workplace.drive.exception.DriveSpaceNotFoundException;
import com.workplace.drive.exception.DriveTransferLinkForbiddenException;
import com.workplace.drive.exception.DriveTransferLinkGoneException;
import com.workplace.drive.exception.DriveTransferLinkNotFoundException;
import com.workplace.drive.exception.DriveTransferUploadRejectedException;
import com.workplace.drive.repository.DriveTransferLinkRepository;
import com.workplace.drive.repository.DriveTransferLinkRepository.TransferLinkRow;
import com.workplace.drive.service.DriveTransferLinkService.ReceivedBody;
import com.workplace.file.service.FileUploadService.FileContentResult;
import com.workplace.file.storage.FileStore;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
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
  @Autowired DriveFolderService folderService;
  @Autowired DriveTransferLinkCleanupScheduler cleanupScheduler;
  @Autowired FileStore fileStore;

  private static final long MB = 1024L * 1024;

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
    FileContentResult c = transfers.openDownloadAsIssuer(link, null, null);
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
    assertThatThrownBy(() -> transfers.openDownloadAsIssuer(link, null, null))
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
    assertThatThrownBy(() -> transfers.openDownloadAsIssuer(link, null, null))
        .isInstanceOf(DriveTransferLinkForbiddenException.class);
  }

  @Test
  void open_trashedFile_isNotFound() throws Exception {
    TransferLinkRow link = issueAndConsume(viewer);
    TenantContext.set(1L);
    fileService.delete(owner, driveFileId);
    assertThatThrownBy(() -> transfers.openDownloadAsIssuer(link, null, null))
        .isInstanceOf(DriveTransferLinkNotFoundException.class)
        .hasMessageContaining("새 링크를 발급받으세요");
  }

  // ── 1b: 감사(R11) · blob 유실 감싸기 ─────────────────────────────────────

  /** 다운로드 링크 발급·사용 모두 감사에 남는다 — actor 는 발급자, 사용 기록엔 요청 IP·User-Agent, 토큰·해시는 없음. */
  @Test
  void downloadLink_issueAndUse_areAudited() throws Exception {
    DriveDownloadLinkResponse r = transfers.issueDownloadLink(viewer, driveFileId);
    String token = tokenOf(r);
    TenantContext.clear();
    TransferLinkRow link = transfers.consume(token, DriveTransferLinkService.KIND_DOWNLOAD);
    TenantContext.set(1L);
    transfers.openDownloadAsIssuer(link, "203.0.113.7", "curl/8.5");

    var created = auditRow(DriveTransferLinkService.AUDIT_LINK_CREATE, viewer);
    assertThat(created.getResourceId()).isEqualTo(String.valueOf(driveFileId));
    assertThat(created.getMetadata().data())
        .contains("\"kind\": \"DOWNLOAD\"")
        .doesNotContain(token);
    var used = auditRow(DriveTransferLinkService.AUDIT_LINK_USE, viewer);
    assertThat(used.getResourceId()).isEqualTo(String.valueOf(driveFileId));
    assertThat(used.getIpAddress()).isEqualTo("203.0.113.7");
    assertThat(used.getUserAgent()).isEqualTo("curl/8.5");
    assertThat(used.getMetadata().data())
        .doesNotContain(token)
        .doesNotContain(DriveShareLinkService.sha256Hex(token));
  }

  /** 익명 요청의 X-Forwarded-For 가 열 길이(45)를 넘어도 감사 기록이 실패하지 않는다(잘라 넣음). */
  @Test
  void use_longClientIp_isTruncated() throws Exception {
    TransferLinkRow link = issueAndConsume(viewer);
    TenantContext.set(1L);
    transfers.openDownloadAsIssuer(link, "x".repeat(200), null);
    assertThat(auditRow(DriveTransferLinkService.AUDIT_LINK_USE, viewer).getIpAddress())
        .hasSize(45);
  }

  /** 원본 blob 이 사라졌으면 전송 링크 전용 404 로 감싼다 — 처리기 문구가 바뀌어도 내부 id 가 새지 않게. */
  @Test
  void open_blobMissing_isWrappedWithoutIds() throws Exception {
    TransferLinkRow link = issueAndConsume(viewer);
    TenantContext.set(1L);
    long fileId =
        dsl.select(DRIVE_FILE.FILE_ID)
            .from(DRIVE_FILE)
            .where(DRIVE_FILE.ID.eq(driveFileId))
            .fetchOne(DRIVE_FILE.FILE_ID);
    String path =
        dsl.select(FILE.STORAGE_PATH)
            .from(FILE)
            .where(FILE.ID.eq(fileId))
            .fetchOne(FILE.STORAGE_PATH);
    fileStore.deleteIfExists(path);

    assertThatThrownBy(() -> transfers.openDownloadAsIssuer(link, null, null))
        .isInstanceOf(DriveTransferLinkNotFoundException.class)
        .hasMessageContaining("원본이 유실")
        .hasMessageNotContaining(String.valueOf(fileId));
  }

  // ── 1b: 업로드 링크 발급 ─────────────────────────────────────────────────

  @Test
  void issueUpload_returnsContract_storesSanitizedName_andAudits() {
    var folder = folderService.create(owner, spaceId, null, "받은편지");
    DriveUploadLinkResponse r =
        transfers.issueUploadLink(
            owner, spaceId, new CreateUploadLinkRequest(folder.id(), "../보고서.md"));

    assertThat(r.url()).startsWith("http://localhost:6173/api/v1/public/drive/transfer/ul_");
    assertThat(r.method()).isEqualTo("PUT");
    assertThat(r.singleUse()).isTrue();
    assertThat(r.name()).isEqualTo(".._보고서.md");
    assertThat(r.maxBytes()).isEqualTo(10 * MB); // md = TEXT 범주
    String token = r.url().substring(r.url().lastIndexOf('/') + 1);
    var row =
        dsl.selectFrom(DRIVE_TRANSFER_LINK)
            .where(DRIVE_TRANSFER_LINK.TOKEN_HASH.eq(DriveShareLinkService.sha256Hex(token)))
            .fetchOne();
    assertThat(row.getKind()).isEqualTo("UPLOAD");
    assertThat(row.getFolderId()).isEqualTo(folder.id());
    assertThat(row.getFileName()).isEqualTo(".._보고서.md");
    assertThat(row.getDriveFileId()).isNull();

    var audit = auditRow(DriveTransferLinkService.AUDIT_LINK_CREATE, owner);
    assertThat(audit.getMetadata().data()).contains("UPLOAD").doesNotContain(token);
  }

  /** maxBytes = min(범주 상한, 멀티파트 25MB) — csv(DATA 256MB)·미분류도 25MB. */
  @Test
  void issueUpload_maxBytes_isCategoryCapBoundedByMultipart() {
    assertThat(
            transfers
                .issueUploadLink(owner, spaceId, new CreateUploadLinkRequest(null, "a.csv"))
                .maxBytes())
        .isEqualTo(25 * MB);
    assertThat(
            transfers
                .issueUploadLink(owner, spaceId, new CreateUploadLinkRequest(null, "a.bin"))
                .maxBytes())
        .isEqualTo(25 * MB);
    assertThat(
            transfers
                .issueUploadLink(owner, spaceId, new CreateUploadLinkRequest(null, "a.pdf"))
                .maxBytes())
        .isEqualTo(10 * MB);
  }

  @Test
  void issueUpload_viewerForbidden_nonMemberHidden() {
    long outsider = withMembership(TestFixtures.createHuman(dsl));
    assertThatThrownBy(
            () ->
                transfers.issueUploadLink(
                    viewer, spaceId, new CreateUploadLinkRequest(null, "a.md")))
        .isInstanceOf(DriveForbiddenException.class);
    assertThatThrownBy(
            () ->
                transfers.issueUploadLink(
                    outsider, spaceId, new CreateUploadLinkRequest(null, "a.md")))
        .isInstanceOf(DriveSpaceNotFoundException.class);
  }

  /** 다른 공간의 폴더는 400, 휴지통 폴더는 404 — 링크를 만들지 않는다. */
  @Test
  void issueUpload_folderOfOtherSpaceOrTrashed_isRejected() {
    long otherSpace =
        spaceService
            .createTeamSpace(owner, "다른_" + UUID.randomUUID().toString().substring(0, 6))
            .id();
    var foreign = folderService.create(owner, otherSpace, null, "남의폴더");
    var trashed = folderService.create(owner, spaceId, null, "지울폴더");
    folderService.delete(owner, trashed.id());

    assertThatThrownBy(
            () ->
                transfers.issueUploadLink(
                    owner, spaceId, new CreateUploadLinkRequest(foreign.id(), "a.md")))
        .isInstanceOf(DriveInvalidTargetException.class);
    assertThatThrownBy(
            () ->
                transfers.issueUploadLink(
                    owner, spaceId, new CreateUploadLinkRequest(trashed.id(), "a.md")))
        .isInstanceOf(DriveFolderNotFoundException.class);
    assertThat(dsl.fetchCount(DRIVE_TRANSFER_LINK, DRIVE_TRANSFER_LINK.KIND.eq("UPLOAD"))).isZero();
  }

  // ── 1b: 업로드 링크 사용(R2 단계별) ──────────────────────────────────────

  /** 1단계 거부(폼 본문 415·선언 크기 초과 400)는 링크를 소비하지 않는다. */
  @Test
  void consumeUpload_preChecks_doNotConsume() {
    String token = uploadToken("a.md", null);
    TenantContext.clear();

    assertThatThrownBy(() -> transfers.consumeUpload(token, "application/x-www-form-urlencoded", 3))
        .isInstanceOfSatisfying(
            DriveTransferUploadRejectedException.class,
            e -> assertThat(e.status()).isEqualTo(HttpStatus.UNSUPPORTED_MEDIA_TYPE));
    assertThatThrownBy(() -> transfers.consumeUpload(token, "multipart/form-data; boundary=x", 3))
        .isInstanceOf(DriveTransferUploadRejectedException.class);
    assertThatThrownBy(() -> transfers.consumeUpload(token, null, 10 * MB + 1))
        .isInstanceOfSatisfying(
            DriveTransferUploadRejectedException.class,
            e -> assertThat(e.status()).isEqualTo(HttpStatus.BAD_REQUEST));

    TransferLinkRow link = transfers.consumeUpload(token, "text/markdown", 3);
    assertThat(link.fileName()).isEqualTo("a.md");
    assertThatThrownBy(() -> transfers.consumeUpload(token, null, 3))
        .isInstanceOf(DriveTransferLinkGoneException.class);
    assertThatThrownBy(() -> transfers.consumeUpload("ul_nope", null, 3))
        .isInstanceOf(DriveTransferLinkNotFoundException.class);
    // 다운로드 토큰은 업로드에 쓸 수 없다
    assertThatThrownBy(() -> transfers.consumeUpload("dl_" + token.substring(3), null, 3))
        .isInstanceOf(DriveTransferLinkNotFoundException.class);
  }

  /**
   * 세는 상한 — Content-Length 없이(chunked) 들어온 본문도 범주 상한을 넘는 순간 끊고 임시 파일을 지운다. Content-Type 의 charset
   * 매개변수는 떼고 범주를 정한다.
   */
  @Test
  void receiveBody_countsAndCutsOverCap_withoutContentLength() throws Exception {
    String token = uploadToken("big.md", null);
    TenantContext.clear();
    TransferLinkRow link = transfers.consumeUpload(token, null, -1);

    InputStream endless =
        new InputStream() {
          long sent = 0;

          @Override
          public int read() {
            return sent++ <= 10 * MB ? 'a' : -1;
          }

          @Override
          public int read(byte[] b, int off, int len) {
            if (sent > 10 * MB) {
              return -1;
            }
            int n = (int) Math.min(len, 10 * MB + 1 - sent);
            java.util.Arrays.fill(b, off, off + n, (byte) 'a');
            sent += n;
            return n;
          }
        };
    assertThatThrownBy(() -> transfers.receiveBody(link, endless, "text/plain; charset=utf-8"))
        .isInstanceOfSatisfying(
            DriveTransferUploadRejectedException.class,
            e -> {
              assertThat(e.status()).isEqualTo(HttpStatus.BAD_REQUEST);
              assertThat(e.getMessage()).contains("10MB").contains("새 링크를 발급받으세요");
            });

    byte[] small = "작은 본문".getBytes(StandardCharsets.UTF_8);
    ReceivedBody body =
        transfers.receiveBody(link, new ByteArrayInputStream(small), "Text/Plain; charset=UTF-8");
    assertThat(body.size()).isEqualTo(small.length);
    assertThat(body.mimeType()).isEqualTo("text/plain");
    assertThat(Files.readAllBytes(body.path())).isEqualTo(small);
    body.close();
    assertThat(Files.exists(body.path())).isFalse();
  }

  /** 3단계 — 발급 뒤 역할이 VIEWER 로 내려가면 403, 대상 폴더가 휴지통이면 404. 문구에 id 없음. */
  @Test
  void requireIssuerCanUpload_rechecksRoleAndFolder() {
    var folder = folderService.create(owner, spaceId, null, "올릴곳");
    String demotedToken = uploadToken("a.md", null);
    String folderToken = uploadToken("b.md", folder.id());
    TenantContext.clear();
    TransferLinkRow demoted = transfers.consumeUpload(demotedToken, null, 1);
    TransferLinkRow toFolder = transfers.consumeUpload(folderToken, null, 1);
    TenantContext.set(1L);

    folderService.delete(owner, folder.id());
    assertThatThrownBy(() -> transfers.requireIssuerCanUpload(toFolder))
        .isInstanceOf(DriveTransferLinkNotFoundException.class)
        .hasMessageContaining("새 링크를 발급받으세요")
        .hasMessageNotContaining(String.valueOf(folder.id()));

    dsl.update(DRIVE_SPACE_MEMBER)
        .set(DRIVE_SPACE_MEMBER.ROLE, "VIEWER")
        .where(DRIVE_SPACE_MEMBER.SPACE_ID.eq(spaceId))
        .and(DRIVE_SPACE_MEMBER.USER_ID.eq(owner))
        .execute();
    assertThatThrownBy(() -> transfers.requireIssuerCanUpload(demoted))
        .isInstanceOf(DriveTransferLinkForbiddenException.class)
        .hasMessageNotContaining(String.valueOf(owner))
        .hasMessageNotContaining(String.valueOf(spaceId));
  }

  /**
   * 5단계 — 업로드 공통 핵심에 발급자로 넘긴다. 인증 주체가 없는 공개 경로라도 감사 actor(FILE_UPLOAD·TRANSFER_LINK_USE)는 발급자다(R3).
   * 같은 이름이면 새 버전.
   */
  @Test
  void completeUpload_storesAsIssuer_auditActorIsIssuer_andSameNameIsNewVersion() throws Exception {
    byte[] bytes = "링크로 올린 내용".getBytes(StandardCharsets.UTF_8);
    DriveFileResponse first = putViaService(uploadToken("링크.txt", null), bytes);

    assertThat(first.name()).isEqualTo("링크.txt");
    assertThat(first.mimeType()).isEqualTo("text/plain");
    assertThat(first.sizeBytes()).isEqualTo(bytes.length);
    assertThat(first.versionCount()).isEqualTo(1);
    assertThat(fileService.download(owner, first.id()).resource().getContentAsByteArray())
        .isEqualTo(bytes);
    var upload =
        dsl.selectFrom(AUDIT_LOG)
            .where(AUDIT_LOG.ACTION_TYPE.eq("FILE_UPLOAD"))
            .and(AUDIT_LOG.RESOURCE_ID.eq(String.valueOf(first.id())))
            .fetchOne();
    assertThat(upload.getUserId()).isEqualTo(owner);
    var use = auditRow(DriveTransferLinkService.AUDIT_LINK_USE, owner);
    assertThat(use.getResourceId()).isEqualTo(String.valueOf(first.id()));
    assertThat(use.getMetadata().data()).contains("UPLOAD");

    DriveFileResponse second = putViaService(uploadToken("링크.txt", null), "v2".getBytes());
    assertThat(second.id()).isEqualTo(first.id());
    assertThat(second.versionCount()).isEqualTo(2);
  }

  /** 5단계 할당량 초과는 409 + 새 링크 안내(링크는 이미 소비됨). */
  @Test
  void completeUpload_overQuota_isConflictWithNewLinkHint() throws Exception {
    String token = uploadToken("q.txt", null);
    dsl.update(TENANT).set(TENANT.QUOTA_BYTES, 0L).where(TENANT.ID.eq(1L)).execute();
    assertThatThrownBy(() -> putViaService(token, "x".getBytes()))
        .isInstanceOfSatisfying(
            DriveTransferUploadRejectedException.class,
            e -> {
              assertThat(e.status()).isEqualTo(HttpStatus.CONFLICT);
              assertThat(e.getMessage()).contains("새 링크를 발급받으세요");
            });
  }

  // ── 1b: 만료 행 주기 정리 ────────────────────────────────────────────────

  /**
   * 만료 뒤 하루가 지난 행만 모든 테넌트에서 지운다 — 막 만료된 행·만료 전 행은 남는다. 정리는 SECURITY DEFINER 함수라 테넌트 GUC 가 다른 테넌트를
   * 가리켜도(= RLS 로는 이 행이 안 보여도) 지운다.
   */
  @Test
  void cleanupScheduler_purgesRowsExpiredOverADay_acrossTenants() {
    long old =
        links.insert(
            "DOWNLOAD",
            hash(),
            viewer,
            spaceId,
            null,
            driveFileId,
            null,
            OffsetDateTime.now().minusDays(2));
    long recent =
        links.insert(
            "DOWNLOAD",
            hash(),
            viewer,
            spaceId,
            null,
            driveFileId,
            null,
            OffsetDateTime.now().minusHours(1));
    long live =
        links.insert(
            "UPLOAD",
            hash(),
            owner,
            spaceId,
            null,
            null,
            "a.md",
            OffsetDateTime.now().plusMinutes(5));

    long otherTenant = TestFixtures.createTenant(dsl, "ACTIVE");
    dsl.execute("SELECT set_config('app.tenant_id', ?, true)", String.valueOf(otherTenant));
    assertThat(dsl.fetchCount(DRIVE_TRANSFER_LINK)).isZero(); // RLS 로는 테넌트 1 행이 보이지 않는다
    cleanupScheduler.purgeExpired();
    dsl.execute("SELECT set_config('app.tenant_id', '1', true)");

    assertThat(exists(old)).isFalse();
    assertThat(exists(recent)).isTrue();
    assertThat(exists(live)).isTrue();
  }

  // --- 헬퍼 ---

  /** 업로드 링크를 발급하고 토큰만 돌려준다(컨텍스트는 테넌트 1 유지). */
  private String uploadToken(String name, Long folderId) {
    DriveUploadLinkResponse r =
        transfers.issueUploadLink(owner, spaceId, new CreateUploadLinkRequest(folderId, name));
    return r.url().substring(r.url().lastIndexOf('/') + 1);
  }

  /** 공개 PUT 과 같은 순서로 서비스 단계를 부른다(소비 → 컨텍스트 → 재확인 → 본문 → 핵심). */
  private DriveFileResponse putViaService(String token, byte[] bytes) throws Exception {
    TenantContext.clear();
    TransferLinkRow link = transfers.consumeUpload(token, null, bytes.length);
    TenantContext.set(link.tenantId());
    transfers.requireIssuerCanUpload(link);
    try (ReceivedBody body = transfers.receiveBody(link, new ByteArrayInputStream(bytes), null)) {
      return transfers.completeUpload(link, body, "198.51.100.1", "curl/8.5");
    }
  }

  /** 해당 사용자의 가장 최근 감사 행(action 별). */
  private com.workplace.jooq.tables.records.AuditLogRecord auditRow(String action, long userId) {
    return dsl.selectFrom(AUDIT_LOG)
        .where(AUDIT_LOG.ACTION_TYPE.eq(action))
        .and(AUDIT_LOG.USER_ID.eq(userId))
        .orderBy(AUDIT_LOG.ID.desc())
        .limit(1)
        .fetchOne();
  }

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
