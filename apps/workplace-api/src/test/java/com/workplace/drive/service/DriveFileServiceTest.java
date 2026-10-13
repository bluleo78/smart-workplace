package com.workplace.drive.service;

import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.FILE_EXTRACTION;
import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.drive.dto.DriveFileResponse;
import com.workplace.drive.dto.DriveFolderResponse;
import com.workplace.drive.dto.DriveSpaceResponse;
import com.workplace.drive.exception.DriveDuplicateNameException;
import com.workplace.drive.exception.DriveFileNotFoundException;
import com.workplace.drive.repository.DriveFileVersionRepository;
import com.workplace.file.service.FileUploadService;
import com.workplace.file.service.FileUploadService.FileContentResult;
import com.workplace.fileai.repository.WorkerJobRepository;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.util.Optional;
import java.util.UUID;
import javax.imageio.ImageIO;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.transaction.annotation.Transactional;

@Transactional
class DriveFileServiceTest extends IntegrationTestBase {
  @Autowired DSLContext dsl;
  @Autowired DriveSpaceService spaceService;
  @Autowired DriveFileService fileService;
  @Autowired DriveFolderService folderService;
  @Autowired DriveQuotaService quotaService;
  @Autowired DriveFileVersionRepository versionsRepo;
  @Autowired WorkerJobRepository jobRepo;

  /** drive 복사(copyFile)는 TenantContext 를 요구한다 — 테스트에선 tenant#1 로 고정. */
  @BeforeEach
  void setTenantContext() {
    TenantContext.set(1L);
  }

  /** ThreadLocal 누수 방지. */
  @AfterEach
  void clearTenantContext() {
    TenantContext.clear();
  }

  private long seedUser() {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "fi_" + s)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, "Fi" + s)
            .set(USER.EMAIL, "fi_" + s + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    // 테넌트#1 ACTIVE 멤버십 — MembershipGuard(#713) 가 addMember 대상의 테넌트 소속을 검증하므로 필요.
    dsl.insertInto(MEMBERSHIP)
        .set(MEMBERSHIP.USER_ID, id)
        .set(MEMBERSHIP.TENANT_ID, 1L)
        .set(MEMBERSHIP.STATUS, "ACTIVE")
        .execute();
    return id;
  }

  private MockMultipartFile txt() {
    return new MockMultipartFile("file", "memo.txt", "text/plain", "hello".getBytes());
  }

  private MockMultipartFile png() throws Exception {
    BufferedImage img = new BufferedImage(300, 200, BufferedImage.TYPE_INT_RGB);
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    ImageIO.write(img, "png", out);
    return new MockMultipartFile("file", "pic.png", "image/png", out.toByteArray());
  }

  /** 이미지 업로드 후 thumbnail() 이 콘텐츠를 반환. */
  @Test
  void thumbnail_returnsContent_forImage() throws Exception {
    long u = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(u, "팀");
    DriveFileResponse f = fileService.upload(u, sp.id(), null, png());

    Optional<FileContentResult> thumb = fileService.thumbnail(u, f.id());

    assertThat(thumb).isPresent();
    assertThat(thumb.get().mimeType()).isEqualTo("image/png");
  }

  /** 텍스트 파일은 썸네일이 없어 빈 Optional. */
  @Test
  void thumbnail_isEmpty_forText() throws Exception {
    long u = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(u, "팀");
    DriveFileResponse f = fileService.upload(u, sp.id(), null, txt());

    assertThat(fileService.thumbnail(u, f.id())).isEmpty();
  }

  /** 비멤버는 썸네일 접근 불가(공간 존재 은닉 → NotFound). */
  @Test
  void thumbnail_byNonMember_isRejected() throws Exception {
    long owner = seedUser();
    long outsider = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(owner, "팀");
    DriveFileResponse f = fileService.upload(owner, sp.id(), null, png());

    assertThatThrownBy(() -> fileService.thumbnail(outsider, f.id()))
        .isInstanceOf(com.workplace.drive.exception.DriveSpaceNotFoundException.class);
  }

  @Test
  void upload_makesFilePermanent_andListable() throws Exception {
    long u = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(u, "팀");
    DriveFileResponse f = fileService.upload(u, sp.id(), null, txt());
    assertThat(f.name()).isEqualTo("memo.txt");
    var exp =
        dsl.select(FILE.EXPIRES_AT)
            .from(FILE)
            .where(FILE.ID.eq(f.fileId()))
            .fetchOne(FILE.EXPIRES_AT);
    assertThat(exp).isNull();
  }

  @Test
  void download_returnsContent_forAnotherSpaceMember() throws Exception {
    long owner = seedUser();
    long viewer = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(owner, "팀");
    spaceService.addMember(owner, sp.id(), viewer, "VIEWER");
    DriveFileResponse f = fileService.upload(owner, sp.id(), null, txt());
    FileUploadService.FileContentResult content = fileService.download(viewer, f.id());
    assertThat(content.originalName()).isEqualTo("memo.txt");
  }

  /** 삭제 = 휴지통으로(soft). drive_file 행 보존·trashed 표시, blob 은 보존(expires_at NULL 유지). */
  @Test
  void delete_movesToTrash_preservesBlob() throws Exception {
    long u = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(u, "팀");
    DriveFileResponse f = fileService.upload(u, sp.id(), null, txt());

    fileService.delete(u, f.id());

    // 브라우즈/다운로드에서 사라짐
    assertThatThrownBy(() -> fileService.download(u, f.id()))
        .isInstanceOf(DriveFileNotFoundException.class);
    // 행은 보존(trashed_at 표시)
    var trashedAt =
        dsl.select(com.workplace.jooq.Tables.DRIVE_FILE.TRASHED_AT)
            .from(com.workplace.jooq.Tables.DRIVE_FILE)
            .where(com.workplace.jooq.Tables.DRIVE_FILE.ID.eq(f.id()))
            .fetchOne(com.workplace.jooq.Tables.DRIVE_FILE.TRASHED_AT);
    assertThat(trashedAt).isNotNull();
    // blob 은 보존 — expires_at 여전히 NULL
    var exp =
        dsl.select(FILE.EXPIRES_AT)
            .from(FILE)
            .where(FILE.ID.eq(f.fileId()))
            .fetchOne(FILE.EXPIRES_AT);
    assertThat(exp).isNull();
  }

  @Test
  void move_changesFolder() throws Exception {
    long u = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(u, "팀");
    var folder = folderService.create(u, sp.id(), null, "대상");
    DriveFileResponse f = fileService.upload(u, sp.id(), null, txt());

    fileService.move(u, f.id(), folder.id());

    var moved =
        dsl.select(com.workplace.jooq.Tables.DRIVE_FILE.FOLDER_ID)
            .from(com.workplace.jooq.Tables.DRIVE_FILE)
            .where(com.workplace.jooq.Tables.DRIVE_FILE.ID.eq(f.id()))
            .fetchOne(com.workplace.jooq.Tables.DRIVE_FILE.FOLDER_ID);
    assertThat(moved).isEqualTo(folder.id());
  }

  /**
   * #799: 목록 3열(이름/크기/수정일) 노출용 updatedAt 회귀 — 업로드 직후 DriveFileResponse.updatedAt 이 createdAt 과
   * 같고(DEFAULT NOW()), 이동(move) 후에도 listInFolder 프로젝션이 drive_file.updated_at 을 정확히 반영하는지 확인 (#799
   * 이슈 코멘트 전제조건 — "거짓 수정일" 방지).
   */
  @Test
  void upload_thenMove_updatedAtReflectsDbColumn() throws Exception {
    long u = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(u, "팀");
    var folder = folderService.create(u, sp.id(), null, "대상");
    DriveFileResponse f = fileService.upload(u, sp.id(), null, txt());
    assertThat(f.updatedAt()).isEqualTo(f.createdAt());

    fileService.move(u, f.id(), folder.id());

    var dbUpdatedAt =
        dsl.select(com.workplace.jooq.Tables.DRIVE_FILE.UPDATED_AT)
            .from(com.workplace.jooq.Tables.DRIVE_FILE)
            .where(com.workplace.jooq.Tables.DRIVE_FILE.ID.eq(f.id()))
            .fetchOne(com.workplace.jooq.Tables.DRIVE_FILE.UPDATED_AT);
    DriveFileResponse moved =
        folderService.listItems(u, sp.id(), folder.id()).files().stream()
            .filter(r -> r.id() == f.id())
            .findFirst()
            .orElseThrow();
    assertThat(moved.updatedAt()).isEqualTo(dbUpdatedAt);
    assertThat(moved.updatedAt()).isAfterOrEqualTo(moved.createdAt());
  }

  /** 복사 — 대상 폴더(서브폴더)에 blob 물리 복제 + 독립 스토리지 경로 검증. 동명이 없는 폴더로 복사하므로 충돌 없음(#79). */
  @Test
  void copy_physicallyDuplicatesBlob_independentStoragePath() throws Exception {
    long u = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(u, "팀");
    DriveFileResponse f = fileService.upload(u, sp.id(), null, txt());
    // 대상: 루트가 아닌 서브폴더 — 동명 파일 없으므로 충돌 없이 복사
    DriveFolderResponse dest = folderService.create(u, sp.id(), null, "대상");

    DriveFileResponse copy = fileService.copy(u, f.id(), dest.id());

    assertThat(copy.id()).isNotEqualTo(f.id());
    assertThat(copy.fileId()).isNotEqualTo(f.fileId());
    String srcPath =
        dsl.select(FILE.STORAGE_PATH)
            .from(FILE)
            .where(FILE.ID.eq(f.fileId()))
            .fetchOne(FILE.STORAGE_PATH);
    String copyPath =
        dsl.select(FILE.STORAGE_PATH)
            .from(FILE)
            .where(FILE.ID.eq(copy.fileId()))
            .fetchOne(FILE.STORAGE_PATH);
    assertThat(copyPath).isNotEqualTo(srcPath);
    var exp =
        dsl.select(FILE.EXPIRES_AT)
            .from(FILE)
            .where(FILE.ID.eq(copy.fileId()))
            .fetchOne(FILE.EXPIRES_AT);
    assertThat(exp).isNull();
    fileService.delete(u, f.id());
    assertThat(fileService.download(u, copy.id()).originalName()).isEqualTo("memo.txt");
  }

  /** 대상 폴더에 동명 파일이 있으면 복사 시 DriveDuplicateNameException(#79). */
  @Test
  void copy_whenTargetHasSameName_conflicts() throws Exception {
    long u = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(u, "팀");
    // 루트에 memo.txt 업로드
    DriveFileResponse src = fileService.upload(u, sp.id(), null, txt());
    // 서브폴더에도 동명 파일 업로드
    DriveFolderResponse sub = folderService.create(u, sp.id(), null, "하위");
    fileService.upload(u, sp.id(), sub.id(), txt());

    // 루트 파일을 서브폴더로 복사 → 동명 충돌 → 409
    assertThatThrownBy(() -> fileService.copy(u, src.id(), sub.id()))
        .isInstanceOf(DriveDuplicateNameException.class);
  }

  /** 대상 폴더에 동명 파일이 있으면 이동 시 DriveDuplicateNameException(#79). */
  @Test
  void move_whenTargetHasSameName_conflicts() throws Exception {
    long u = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(u, "팀");
    DriveFileResponse src = fileService.upload(u, sp.id(), null, txt());
    DriveFolderResponse sub = folderService.create(u, sp.id(), null, "하위");
    fileService.upload(u, sp.id(), sub.id(), txt());

    // 루트 파일을 서브폴더로 이동 → 동명 충돌 → 409
    assertThatThrownBy(() -> fileService.move(u, src.id(), sub.id()))
        .isInstanceOf(DriveDuplicateNameException.class);
  }

  @Test
  void move_byViewer_isForbidden() throws Exception {
    long owner = seedUser();
    long viewer = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(owner, "팀");
    spaceService.addMember(owner, sp.id(), viewer, "VIEWER");
    DriveFileResponse f = fileService.upload(owner, sp.id(), null, txt());
    var folder = folderService.create(owner, sp.id(), null, "대상");

    assertThatThrownBy(() -> fileService.move(viewer, f.id(), folder.id()))
        .isInstanceOf(com.workplace.drive.exception.DriveForbiddenException.class);
  }

  @Test
  void move_toFolderInAnotherSpace_isRejected() throws Exception {
    long u = seedUser();
    DriveSpaceResponse sp1 = spaceService.createTeamSpace(u, "팀1");
    DriveSpaceResponse sp2 = spaceService.createTeamSpace(u, "팀2");
    DriveFileResponse f = fileService.upload(u, sp1.id(), null, txt());
    var otherFolder = folderService.create(u, sp2.id(), null, "남의공간");

    assertThatThrownBy(() -> fileService.move(u, f.id(), otherFolder.id()))
        .isInstanceOf(com.workplace.drive.exception.DriveInvalidTargetException.class);
  }

  /** 휴지통에 있는 파일은 이동 대상이 아님 — findRow 의 trashed 필터로 NotFound(하드닝). */
  @Test
  void move_trashedFile_isNotFound() throws Exception {
    long u = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(u, "팀");
    var folder = folderService.create(u, sp.id(), null, "대상");
    DriveFileResponse f = fileService.upload(u, sp.id(), null, txt());
    fileService.delete(u, f.id());

    assertThatThrownBy(() -> fileService.move(u, f.id(), folder.id()))
        .isInstanceOf(DriveFileNotFoundException.class);
  }

  /**
   * C1 회귀 테스트(#79): 복사된 파일이 quota 집계 대상에 포함되고 v1 버전 행이 생성된다.
   *
   * <p>이전에는 copy() 가 drive_file 만 삽입하고 drive_file_version 을 생성하지 않아 sumDriveUsageBytes
   * (drive_file_version JOIN 기반)에서 복사본이 누락됐다(quota bypass). 이 테스트는 원본 업로드 후 복사했을 때 usedBytes 가 원본
   * 크기만큼 증가하고 복사본에 정확히 1개의 버전 행이 존재함을 검증한다.
   */
  @Test
  void copy_countsTowardQuota_andHasOneVersionRow() throws Exception {
    long u = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(u, "팀");
    DriveFolderResponse dest = folderService.create(u, sp.id(), null, "대상");

    // 업로드 후 기준 사용량 측정
    DriveFileResponse original = fileService.upload(u, sp.id(), null, txt());
    long usedAfterUpload = quotaService.usedBytes();

    // 복사 — copy 전후로 usedBytes 가 원본 크기만큼 증가해야 한다(#79 C1 버그: 이전엔 불변)
    DriveFileResponse copy = fileService.copy(u, original.id(), dest.id());
    long usedAfterCopy = quotaService.usedBytes();

    long copiedSize = original.sizeBytes();
    assertThat(usedAfterCopy).as("복사본도 quota 에 반영돼야 한다").isEqualTo(usedAfterUpload + copiedSize);

    // 복사본에 정확히 v1 버전 행 1개 존재 검증
    var versions = versionsRepo.listForDriveFile(copy.id());
    assertThat(versions).as("복사본은 v1 버전 행 1개를 가져야 한다").hasSize(1);
    assertThat(versions.get(0).versionNo()).isEqualTo(1);
    assertThat(versions.get(0).sizeBytes()).isEqualTo(copiedSize);
  }

  // ── WP-335: 파일 이름 변경 ──

  /** 이름을 바꾸면 목록·다운로드 파일명에 새 이름이 반영된다(앞뒤 공백 제거). 감사 로그 FILE_RENAME 기록. */
  @Test
  void rename_updatesListAndDownloadName() throws Exception {
    long u = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(u, "팀");
    DriveFileResponse f = fileService.upload(u, sp.id(), null, txt());

    DriveFileResponse renamed = fileService.rename(u, f.id(), "  회의록.txt ");

    assertThat(renamed.name()).isEqualTo("회의록.txt");
    assertThat(fileService.download(u, f.id()).originalName()).isEqualTo("회의록.txt");
    assertThat(fileService.downloadViaShareLink(f.id()).originalName()).isEqualTo("회의록.txt");
    // 지난 버전은 올릴 때 이름 그대로(확장자를 바꿔도 옛 형식 버전이 새 확장자로 내려가지 않게).
    assertThat(fileService.downloadVersion(u, f.id(), 1).originalName()).isEqualTo("memo.txt");
    assertThat(
            dsl.fetchCount(
                com.workplace.jooq.Tables.AUDIT_LOG,
                com.workplace.jooq.Tables.AUDIT_LOG
                    .ACTION_TYPE
                    .eq("FILE_RENAME")
                    .and(
                        com.workplace.jooq.Tables.AUDIT_LOG.RESOURCE_ID.eq(
                            String.valueOf(f.id())))))
        .isEqualTo(1);
  }

  /** 같은 폴더에 같은 이름의 활성 파일이 있으면 409(DriveDuplicateNameException). */
  @Test
  void rename_toExistingNameInSameFolder_conflicts() throws Exception {
    long u = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(u, "팀");
    DriveFileResponse a = fileService.upload(u, sp.id(), null, txt());
    fileService.upload(u, sp.id(), null, png());

    assertThatThrownBy(() -> fileService.rename(u, a.id(), "pic.png"))
        .isInstanceOf(DriveDuplicateNameException.class);
  }

  /** 다른 폴더의 동명 파일·휴지통의 동명 파일은 충돌이 아니다. */
  @Test
  void rename_sameNameInOtherFolderOrTrash_isAllowed() throws Exception {
    long u = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(u, "팀");
    DriveFolderResponse sub = folderService.create(u, sp.id(), null, "하위");
    fileService.upload(u, sp.id(), sub.id(), png());
    DriveFileResponse trashed =
        fileService.upload(
            u,
            sp.id(),
            null,
            new MockMultipartFile("file", "old.png", "image/png", "x".getBytes()));
    fileService.delete(u, trashed.id());
    DriveFileResponse f = fileService.upload(u, sp.id(), null, txt());

    assertThat(fileService.rename(u, f.id(), "pic.png").name()).isEqualTo("pic.png");
    assertThat(fileService.rename(u, f.id(), "old.png").name()).isEqualTo("old.png");
  }

  /** 현재 이름 그대로면 자기 자신과의 충돌 없이 그대로 돌려준다. */
  @Test
  void rename_toSameName_isNoop() throws Exception {
    long u = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(u, "팀");
    DriveFileResponse f = fileService.upload(u, sp.id(), null, txt());

    assertThat(fileService.rename(u, f.id(), "memo.txt").name()).isEqualTo("memo.txt");
  }

  /** 이름을 바꾼 뒤 새 이름으로 다시 올리면 같은 파일의 새 버전으로 흡수된다(#79 동명 자동 버전화와 일관). */
  @Test
  void rename_thenUploadWithNewName_becomesNewVersion() throws Exception {
    long u = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(u, "팀");
    DriveFileResponse f = fileService.upload(u, sp.id(), null, txt());
    fileService.rename(u, f.id(), "report.txt");

    DriveFileResponse again =
        fileService.upload(
            u,
            sp.id(),
            null,
            new MockMultipartFile("file", "report.txt", "text/plain", "v2".getBytes()));

    assertThat(again.id()).isEqualTo(f.id());
    assertThat(again.versionCount()).isEqualTo(2);
  }

  /**
   * 앞뒤 공백(유니코드 공백 포함)을 지운 뒤 빈 이름·"."·".."·경로 구분자·제어 문자·줄 구분자·양방향 제어 문자는
   * 400(IllegalArgumentException).
   */
  @Test
  void rename_invalidNames_areRejected() throws Exception {
    long u = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(u, "팀");
    DriveFileResponse f = fileService.upload(u, sp.id(), null, txt());

    for (String bad :
        new String[] {
          "\u3000",
          "\u3000..\u3000",
          " . ",
          "a/b.txt",
          "a\\b.txt",
          "a\u0000b.txt",
          "a\nb.txt",
          "a\u0085b.txt",
          "a\u2028b.txt",
          "invoice\u202Efdp.exe"
        }) {
      assertThatThrownBy(() -> fileService.rename(u, f.id(), bad))
          .as(bad)
          .isInstanceOf(IllegalArgumentException.class);
    }
    assertThat(fileService.rename(u, f.id(), "..a.b.txt").name()).isEqualTo("..a.b.txt");
  }

  /**
   * API·MCP 로 경로·양방향 문자가 든 파일명이 와도 막지 않고 "_" 로 바꿔 저장한다(WP-339). 잘라 내지 않으므로 같은 폴더의 다른 파일과 겹쳐 새 버전으로
   * 합쳐지지 않는다.
   */
  @Test
  void upload_pathLikeName_isSanitized() throws Exception {
    long u = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(u, "팀");
    String[][] cases = {
      {"../../evil.txt", ".._.._evil.txt"},
      {"a\\b\\c.txt", "a_b_c.txt"},
      {"invoice\u202Efdp.exe", "invoice_fdp.exe"},
      {"..", "file"}
    };
    for (String[] c : cases) {
      MockMultipartFile mf = new MockMultipartFile("file", c[0], "text/plain", "x".getBytes());
      DriveFileResponse f = fileService.upload(u, sp.id(), null, mf);
      assertThat(f.name()).as(c[0]).isEqualTo(c[1]);
    }
  }

  /** 요약 문맥은 드라이브 이름을 쓴다 — 이름을 바꾼 뒤 재시도·재요약에도 새 이름이 AI 에 간다(WP-339). */
  @Test
  void summaryContext_usesRenamedDriveName() throws Exception {
    long u = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(u, "팀");
    DriveFileResponse f = fileService.upload(u, sp.id(), null, txt());
    fileService.rename(u, f.id(), "보고서.txt");
    dsl.insertInto(FILE_EXTRACTION)
        .set(FILE_EXTRACTION.FILE_ID, f.fileId())
        .set(FILE_EXTRACTION.TENANT_ID, 1L)
        .set(FILE_EXTRACTION.EXTRACTED_TEXT, "본문")
        .onConflictDoNothing()
        .execute();

    assertThat(jobRepo.findSummaryContext(f.fileId()).fileName()).isEqualTo("보고서.txt");
  }

  /** VIEWER 는 이름을 바꿀 수 없다. */
  @Test
  void rename_byViewer_isForbidden() throws Exception {
    long owner = seedUser();
    long viewer = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(owner, "팀");
    spaceService.addMember(owner, sp.id(), viewer, "VIEWER");
    DriveFileResponse f = fileService.upload(owner, sp.id(), null, txt());

    assertThatThrownBy(() -> fileService.rename(viewer, f.id(), "x.txt"))
        .isInstanceOf(com.workplace.drive.exception.DriveForbiddenException.class);
  }

  /** 휴지통에 있는 파일은 이름 변경 대상이 아니다(NotFound). */
  @Test
  void rename_trashedFile_isNotFound() throws Exception {
    long u = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(u, "팀");
    DriveFileResponse f = fileService.upload(u, sp.id(), null, txt());
    fileService.delete(u, f.id());

    assertThatThrownBy(() -> fileService.rename(u, f.id(), "x.txt"))
        .isInstanceOf(DriveFileNotFoundException.class);
  }

  // ── WP-369: 업로드 폴더 검증 · 텍스트로 파일 만들기 ──────────────────────────────

  /** 멀티파트 업로드도 폴더가 그 공간 소속인지 본다 — 다른 공간 폴더 id 로는 올릴 수 없다(400). */
  @Test
  void upload_toFolderInAnotherSpace_isRejected() throws Exception {
    long u = seedUser();
    DriveSpaceResponse sp1 = spaceService.createTeamSpace(u, "팀1");
    DriveSpaceResponse sp2 = spaceService.createTeamSpace(u, "팀2");
    var otherFolder = folderService.create(u, sp2.id(), null, "남의공간");

    assertThatThrownBy(() -> fileService.upload(u, sp1.id(), otherFolder.id(), txt()))
        .isInstanceOf(com.workplace.drive.exception.DriveInvalidTargetException.class)
        .hasMessageContaining("다른 공간의 폴더");
  }

  /** 휴지통 폴더·없는 폴더로는 올릴 수 없다(404). */
  @Test
  void upload_toTrashedOrMissingFolder_isNotFound() throws Exception {
    long u = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(u, "팀");
    var folder = folderService.create(u, sp.id(), null, "지울폴더");
    folderService.delete(u, folder.id());

    assertThatThrownBy(() -> fileService.upload(u, sp.id(), folder.id(), txt()))
        .isInstanceOf(com.workplace.drive.exception.DriveFolderNotFoundException.class);
    assertThatThrownBy(() -> fileService.upload(u, sp.id(), Long.MAX_VALUE, txt()))
        .isInstanceOf(com.workplace.drive.exception.DriveFolderNotFoundException.class);
  }

  /** 같은 공간 폴더로는 그대로 올라간다. */
  @Test
  void upload_toFolderInSameSpace_succeeds() throws Exception {
    long u = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(u, "팀");
    var folder = folderService.create(u, sp.id(), null, "내폴더");

    DriveFileResponse f = fileService.upload(u, sp.id(), folder.id(), txt());
    assertThat(f.folderId()).isEqualTo(folder.id());
  }

  /** 텍스트로 만들기 — UTF-8 로 저장되고 확장자로 MIME 이 정해지며, 업로드처럼 영구 파일·v1 이 된다. */
  @Test
  void createTextFile_storesUtf8_andPicksMimeByExtension() throws Exception {
    long u = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(u, "팀");
    String content = "# 회의록\n- 결정: 출시 연기";

    DriveFileResponse f = fileService.createTextFile(u, sp.id(), null, "회의록.md", content, null);

    assertThat(f.name()).isEqualTo("회의록.md");
    assertThat(f.mimeType()).isEqualTo("text/markdown");
    assertThat(f.sizeBytes())
        .isEqualTo(content.getBytes(java.nio.charset.StandardCharsets.UTF_8).length);
    assertThat(f.versionCount()).isEqualTo(1);
    FileContentResult c = fileService.download(u, f.id());
    assertThat(c.resource().getContentAsByteArray())
        .isEqualTo(content.getBytes(java.nio.charset.StandardCharsets.UTF_8));
    assertThat(
            dsl.select(FILE.EXPIRES_AT)
                .from(FILE)
                .where(FILE.ID.eq(f.fileId()))
                .fetchOne(FILE.EXPIRES_AT))
        .isNull();
  }

  /** 텍스트로 만들기 MIME 규칙(R4) — md·txt·csv·json 만 그 MIME, 나머지는 text/plain(html 도). 명시값은 허용 목록만. */
  @Test
  void textMimeOf_allowsOnlyFourTypes() {
    assertThat(DriveFileService.textMimeOf("a.md", null)).isEqualTo("text/markdown");
    assertThat(DriveFileService.textMimeOf("a.TXT", null)).isEqualTo("text/plain");
    assertThat(DriveFileService.textMimeOf("a.csv", null)).isEqualTo("text/csv");
    assertThat(DriveFileService.textMimeOf("a.json", "")).isEqualTo("application/json");
    assertThat(DriveFileService.textMimeOf("a.html", null)).isEqualTo("text/plain");
    assertThat(DriveFileService.textMimeOf("noext", null)).isEqualTo("text/plain");
    assertThat(DriveFileService.textMimeOf("a.txt", "Text/Markdown; charset=utf-8"))
        .isEqualTo("text/markdown");
    assertThatThrownBy(() -> DriveFileService.textMimeOf("a.html", "text/html"))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> DriveFileService.textMimeOf("a.bin", "application/octet-stream"))
        .isInstanceOf(IllegalArgumentException.class);
  }

  /** html 이름이어도 text/plain 으로 저장된다 — 주입됐을 수 있는 HTML 이 /content 로 렌더링되지 않게. */
  @Test
  void createTextFile_htmlName_isStoredAsPlainText() throws Exception {
    long u = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(u, "팀");
    DriveFileResponse f =
        fileService.createTextFile(u, sp.id(), null, "page.html", "<script>x</script>", null);
    assertThat(f.mimeType()).isEqualTo("text/plain");
  }

  /** 같은 이름으로 다시 만들면 새 버전으로 흡수된다(업로드와 같은 의미). */
  @Test
  void createTextFile_sameName_becomesNewVersion() throws Exception {
    long u = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(u, "팀");
    DriveFileResponse v1 = fileService.createTextFile(u, sp.id(), null, "노트.txt", "하나", null);
    DriveFileResponse v2 = fileService.createTextFile(u, sp.id(), null, "노트.txt", "둘", null);

    assertThat(v2.id()).isEqualTo(v1.id());
    assertThat(v2.versionCount()).isEqualTo(2);
  }

  /** 다른 공간 폴더·VIEWER 는 거부. */
  @Test
  void createTextFile_rejectsOtherSpaceFolderAndViewer() throws Exception {
    long owner = seedUser();
    long viewer = seedUser();
    DriveSpaceResponse sp1 = spaceService.createTeamSpace(owner, "팀1");
    DriveSpaceResponse sp2 = spaceService.createTeamSpace(owner, "팀2");
    spaceService.addMember(owner, sp1.id(), viewer, "VIEWER");
    var otherFolder = folderService.create(owner, sp2.id(), null, "남의공간");

    assertThatThrownBy(
            () -> fileService.createTextFile(owner, sp1.id(), otherFolder.id(), "a.md", "x", null))
        .isInstanceOf(com.workplace.drive.exception.DriveInvalidTargetException.class);
    assertThatThrownBy(() -> fileService.createTextFile(viewer, sp1.id(), null, "a.md", "x", null))
        .isInstanceOf(com.workplace.drive.exception.DriveForbiddenException.class);
  }

  /** 크기 상한은 TEXT 상한(10MB) — csv(DATA 범주 256MB)도 10MB 를 넘으면 거부. */
  @Test
  void createTextFile_over10MB_isRejected_evenForCsv() throws Exception {
    long u = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(u, "팀");
    String big = "a".repeat((int) DriveFileService.TEXT_FILE_MAX_BYTES + 1);

    assertThatThrownBy(() -> fileService.createTextFile(u, sp.id(), null, "big.csv", big, null))
        .isInstanceOf(com.workplace.file.exception.FileSizeLimitExceededException.class);
  }

  /** 할당량을 넘으면 거부(업로드와 같은 advisory lock + 할당량 검사). */
  @Test
  void createTextFile_overQuota_isRejected() throws Exception {
    long u = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(u, "팀");
    dsl.update(com.workplace.jooq.Tables.TENANT)
        .set(com.workplace.jooq.Tables.TENANT.QUOTA_BYTES, 0L)
        .where(com.workplace.jooq.Tables.TENANT.ID.eq(1L))
        .execute();

    assertThatThrownBy(() -> fileService.createTextFile(u, sp.id(), null, "a.txt", "x", null))
        .isInstanceOf(com.workplace.drive.exception.DriveQuotaExceededException.class);
  }

  // ── WP-369 Task 3: 기존 파일을 ID 로 지정해 텍스트로 갱신 ─────────────────────────────

  /**
   * 텍스트 갱신 — 같은 파일에 새 버전(versionCount+1)이 생기고 이름·폴더는 그대로다. 감사 FILE_VERSION_CREATED 의 actor 는
   * 호출자(발행자가 아닌 EDITOR)다.
   */
  @Test
  void updateTextFile_addsVersion_keepsNameAndFolder_auditsCaller() throws Exception {
    long owner = seedUser();
    long editor = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(owner, "팀");
    spaceService.addMember(owner, sp.id(), editor, "EDITOR");
    var folder = folderService.create(owner, sp.id(), null, "노트함");
    DriveFileResponse v1 =
        fileService.createTextFile(owner, sp.id(), folder.id(), "회의록.md", "# 처음", null);
    String content = "# 고친 회의록\n- 결정: 출시";

    DriveFileResponse v2 = fileService.updateTextFile(editor, v1.id(), content, null);

    assertThat(v2.id()).isEqualTo(v1.id());
    assertThat(v2.versionCount()).isEqualTo(2);
    assertThat(v2.name()).isEqualTo("회의록.md");
    assertThat(v2.folderId()).isEqualTo(folder.id());
    assertThat(v2.mimeType()).isEqualTo("text/markdown");
    assertThat(v2.fileId()).isNotEqualTo(v1.fileId());
    byte[] bytes = content.getBytes(java.nio.charset.StandardCharsets.UTF_8);
    assertThat(v2.sizeBytes()).isEqualTo(bytes.length);
    assertThat(fileService.download(owner, v1.id()).resource().getContentAsByteArray())
        .isEqualTo(bytes);
    // 공간에 그 이름의 파일은 하나뿐이다(새 파일이 생기지 않았다)
    assertThat(
            dsl.fetchCount(
                com.workplace.jooq.Tables.DRIVE_FILE,
                com.workplace.jooq.Tables.DRIVE_FILE
                    .SPACE_ID
                    .eq(sp.id())
                    .and(com.workplace.jooq.Tables.DRIVE_FILE.NAME.eq("회의록.md"))))
        .isEqualTo(1);
    var audit =
        dsl.selectFrom(com.workplace.jooq.Tables.AUDIT_LOG)
            .where(com.workplace.jooq.Tables.AUDIT_LOG.ACTION_TYPE.eq("FILE_VERSION_CREATED"))
            .and(com.workplace.jooq.Tables.AUDIT_LOG.RESOURCE_ID.eq(String.valueOf(v1.id())))
            .fetchOne();
    assertThat(audit.getUserId()).isEqualTo(editor);
    // 새 버전도 업로드와 같이 영구 파일이고 추출 행이 생긴다
    assertThat(
            dsl.select(FILE.EXPIRES_AT)
                .from(FILE)
                .where(FILE.ID.eq(v2.fileId()))
                .fetchOne(FILE.EXPIRES_AT))
        .isNull();
    assertThat(dsl.fetchExists(FILE_EXTRACTION, FILE_EXTRACTION.FILE_ID.eq(v2.fileId()))).isTrue();
  }

  /** mimeType 이 없으면 지금 MIME 을 유지한다(json), 명시값은 허용 목록만. csv(DATA 범주)도 텍스트 계열이라 갱신할 수 있다. */
  @Test
  void updateTextFile_keepsJsonMime_andCsvAllowed() throws Exception {
    long u = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(u, "팀");
    DriveFileResponse json = fileService.createTextFile(u, sp.id(), null, "설정.json", "{}", null);
    DriveFileResponse csv = fileService.createTextFile(u, sp.id(), null, "표.csv", "a,b", null);

    assertThat(fileService.updateTextFile(u, json.id(), "{\"a\":1}", null).mimeType())
        .isEqualTo("application/json");
    assertThat(fileService.updateTextFile(u, csv.id(), "a,b\n1,2", "").mimeType())
        .isEqualTo("text/csv");
    assertThatThrownBy(() -> fileService.updateTextFile(u, json.id(), "x", "text/html"))
        .isInstanceOf(IllegalArgumentException.class);
  }

  /** 텍스트 계열이 아닌 파일(png·docx)은 409 — 문서를 텍스트로 덮어 서식을 잃지 않게. 버전은 늘지 않는다. */
  @Test
  void updateTextFile_nonTextFile_conflicts() throws Exception {
    long u = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(u, "팀");
    DriveFileResponse image = fileService.upload(u, sp.id(), null, png());
    DriveFileResponse doc =
        fileService.upload(
            u,
            sp.id(),
            null,
            new MockMultipartFile(
                "file",
                "보고서.docx",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                new byte[] {1, 2, 3}));

    assertThatThrownBy(() -> fileService.updateTextFile(u, image.id(), "x", null))
        .isInstanceOf(com.workplace.drive.exception.DriveNotTextFileException.class)
        .hasMessage("텍스트 파일만 내용으로 갱신할 수 있습니다");
    assertThatThrownBy(() -> fileService.updateTextFile(u, doc.id(), "x", "text/plain"))
        .isInstanceOf(com.workplace.drive.exception.DriveNotTextFileException.class);
    assertThat(versionsRepo.listForDriveFile(doc.id())).hasSize(1);
  }

  /** VIEWER 는 403, 비멤버는 404(존재 은닉) — 비텍스트 파일이어도 409 보다 권한 검사가 먼저라 형식이 새지 않는다. */
  @Test
  void updateTextFile_viewerForbidden_nonMemberHidden() throws Exception {
    long owner = seedUser();
    long viewer = seedUser();
    long outsider = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(owner, "팀");
    spaceService.addMember(owner, sp.id(), viewer, "VIEWER");
    DriveFileResponse text = fileService.createTextFile(owner, sp.id(), null, "a.md", "x", null);
    DriveFileResponse image = fileService.upload(owner, sp.id(), null, png());

    assertThatThrownBy(() -> fileService.updateTextFile(viewer, text.id(), "y", null))
        .isInstanceOf(com.workplace.drive.exception.DriveForbiddenException.class);
    assertThatThrownBy(() -> fileService.updateTextFile(viewer, image.id(), "y", null))
        .isInstanceOf(com.workplace.drive.exception.DriveForbiddenException.class);
    assertThatThrownBy(() -> fileService.updateTextFile(outsider, image.id(), "y", null))
        .isInstanceOf(com.workplace.drive.exception.DriveSpaceNotFoundException.class);
  }

  /** 휴지통 파일은 404. */
  @Test
  void updateTextFile_trashedFile_isNotFound() throws Exception {
    long u = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(u, "팀");
    DriveFileResponse f = fileService.createTextFile(u, sp.id(), null, "a.md", "x", null);
    fileService.delete(u, f.id());

    assertThatThrownBy(() -> fileService.updateTextFile(u, f.id(), "y", null))
        .isInstanceOf(DriveFileNotFoundException.class);
  }

  /**
   * 텍스트 계열 판정 — text/* 전부·텍스트 application 형식·*+json·*+xml 은 허용, octet-stream 은 알려진 텍스트 확장자일 때만.
   * pdf·docx· 이미지(svg 포함)·모름은 거부. 매개변수는 뗀다.
   */
  @Test
  void isTextLike_coversTextFamily_andOctetStreamByExtension() {
    for (String mime :
        new String[] {
          "text/markdown",
          "text/plain; charset=utf-8",
          "text/csv",
          "text/tab-separated-values",
          "text/javascript",
          "text/css",
          "text/x-python",
          "text/html",
          "application/json",
          "application/ld+json",
          "application/csv",
          "application/xml",
          "application/atom+xml",
          "application/x-yaml",
          "application/yaml",
          "application/javascript",
          "application/x-sh"
        }) {
      assertThat(DriveFileService.isTextLike(mime, "a.bin")).as(mime).isTrue();
    }
    for (String name : new String[] {"a.py", "a.js", "a.ts", "a.tsv", "A.SQL", "a.log"}) {
      assertThat(DriveFileService.isTextLike("application/octet-stream", name)).as(name).isTrue();
    }
    assertThat(DriveFileService.isTextLike("application/octet-stream", "a.bin")).isFalse();
    assertThat(DriveFileService.isTextLike("application/octet-stream", null)).isFalse();
    assertThat(DriveFileService.isTextLike("application/pdf", "a.txt")).isFalse();
    assertThat(
            DriveFileService.isTextLike(
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                "a.docx"))
        .isFalse();
    assertThat(DriveFileService.isTextLike("image/png", "a.png")).isFalse();
    assertThat(DriveFileService.isTextLike("image/svg+xml", "a.svg")).isFalse();
    assertThat(DriveFileService.isTextLike(null, "a.txt")).isFalse();
  }

  /** 공용 bareMime — 매개변수를 떼고 소문자, 비거나 본체가 없으면 null. 명시 mimeType 이 ";x" 여도 NPE 가 아니라 400(IAE). */
  @Test
  void bareMime_andTextMimeOf_handleEmptyBody() {
    assertThat(DriveFileService.bareMime("Text/Plain; charset=UTF-8")).isEqualTo("text/plain");
    assertThat(DriveFileService.bareMime("  ")).isNull();
    assertThat(DriveFileService.bareMime("; charset=utf-8")).isNull();
    assertThatThrownBy(() -> DriveFileService.textMimeOf("a.md", "; charset=utf-8"))
        .isInstanceOf(IllegalArgumentException.class);
  }

  /** 멀티파트로 올린 파일(실제 Content-Type 유지) — 텍스트 갱신 MIME 판정용. */
  private DriveFileResponse uploadAs(long u, long spaceId, String name, String mime, String body)
      throws Exception {
    return fileService.upload(
        u,
        spaceId,
        null,
        new MockMultipartFile(
            "file", name, mime, body.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
  }

  /**
   * mimeType 없이 갱신하면 지금 MIME 을 유지한다 — yaml 은 application/x-yaml, md 는 text/markdown(매개변수는 뗀다),
   * text/javascript 도 그대로. xml 계열은 문서로 렌더링되지 않게 text/plain 이 된다(워커가 xml 을 원문 그대로 읽어 고쳐 쓸 수 있다).
   */
  @Test
  void updateTextFile_keepsCurrentMime_butXmlBecomesPlainText() throws Exception {
    long u = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(u, "팀");
    DriveFileResponse yaml = uploadAs(u, sp.id(), "설정.yaml", "application/x-yaml", "a: 1");
    DriveFileResponse md = uploadAs(u, sp.id(), "노트.md", "text/markdown; charset=utf-8", "# a");
    DriveFileResponse js = uploadAs(u, sp.id(), "app.js", "text/javascript", "let a");
    DriveFileResponse xml = uploadAs(u, sp.id(), "data.xml", "application/xml", "<a/>");
    DriveFileResponse textXml = uploadAs(u, sp.id(), "feed.xml", "text/xml", "<a/>");

    assertThat(fileService.updateTextFile(u, yaml.id(), "a: 2", null).mimeType())
        .isEqualTo("application/x-yaml");
    assertThat(fileService.updateTextFile(u, md.id(), "# b", null).mimeType())
        .isEqualTo("text/markdown");
    assertThat(fileService.updateTextFile(u, js.id(), "let b", null).mimeType())
        .isEqualTo("text/javascript");
    for (DriveFileResponse f : new DriveFileResponse[] {xml, textXml}) {
      DriveFileResponse v2 = fileService.updateTextFile(u, f.id(), "<script>x</script>", null);
      assertThat(v2.mimeType()).as(f.name()).isEqualTo("text/plain");
      assertThat(v2.versionCount()).isEqualTo(2);
    }
  }

  /**
   * html 계열(text/html·application/xhtml+xml)은 내용으로 고쳐 쓰지 못한다(409, 최종 리뷰 I3) — 워커 추출이 마크업을 걷어내므로 AI
   * 가 읽은 "전문"으로 덮으면 태그가 모두 사라진다. 사유와 업로드 링크 안내를 알리고 버전은 늘지 않는다.
   */
  @Test
  void updateTextFile_htmlFamily_conflicts_withUploadLinkHint() throws Exception {
    long u = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(u, "팀");
    DriveFileResponse html =
        uploadAs(u, sp.id(), "page.html", "text/html; charset=utf-8", "<p>a</p>");
    DriveFileResponse xhtml = uploadAs(u, sp.id(), "doc.xhtml", "application/xhtml+xml", "<a/>");

    for (DriveFileResponse f : new DriveFileResponse[] {html, xhtml}) {
      assertThatThrownBy(() -> fileService.updateTextFile(u, f.id(), "a", null))
          .as(f.name())
          .isInstanceOf(com.workplace.drive.exception.DriveNotTextFileException.class)
          .hasMessageContaining("HTML")
          .hasMessageEndingWith("업로드 링크로 파일을 올리세요");
      assertThat(versionsRepo.listForDriveFile(f.id())).hasSize(1);
    }
  }

  /**
   * 명시 mimeType 은 R4 허용 목록 안이면 지금 MIME 과 달라도 받는다(md 파일에 text/csv), 목록 밖(application/x-yaml)은 400.
   */
  @Test
  void updateTextFile_explicitMime_usesAllowList() throws Exception {
    long u = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(u, "팀");
    DriveFileResponse md = fileService.createTextFile(u, sp.id(), null, "표.md", "x", null);
    DriveFileResponse yaml = uploadAs(u, sp.id(), "설정.yaml", "application/x-yaml", "a: 1");

    assertThat(fileService.updateTextFile(u, md.id(), "a,b", "text/csv").mimeType())
        .isEqualTo("text/csv");
    assertThatThrownBy(() -> fileService.updateTextFile(u, yaml.id(), "a: 2", "application/x-yaml"))
        .isInstanceOf(IllegalArgumentException.class);
  }

  /**
   * 브라우저가 octet-stream 으로 올린 .js·.py 도 텍스트 파일로 보고 갱신한다 — 새 버전은 이름 확장자로(text/plain). 모르는 확장자의
   * octet-stream·pdf 는 계속 409.
   */
  @Test
  void updateTextFile_octetStreamCodeFiles_allowed_binaryStillConflicts() throws Exception {
    long u = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(u, "팀");
    DriveFileResponse js = uploadAs(u, sp.id(), "app.js", "application/octet-stream", "let a");
    DriveFileResponse py = uploadAs(u, sp.id(), "run.py", "application/octet-stream", "print(1)");
    DriveFileResponse bin = uploadAs(u, sp.id(), "blob.bin", "application/octet-stream", "x");
    DriveFileResponse pdf = uploadAs(u, sp.id(), "문서.pdf", "application/pdf", "%PDF-1.4");
    assertThat(js.mimeType()).isEqualTo("application/octet-stream");

    DriveFileResponse jsV2 = fileService.updateTextFile(u, js.id(), "let b", null);
    assertThat(jsV2.versionCount()).isEqualTo(2);
    assertThat(jsV2.mimeType()).isEqualTo("text/plain");
    assertThat(fileService.updateTextFile(u, py.id(), "print(2)", null).mimeType())
        .isEqualTo("text/plain");
    assertThatThrownBy(() -> fileService.updateTextFile(u, bin.id(), "x", null))
        .isInstanceOf(com.workplace.drive.exception.DriveNotTextFileException.class);
    assertThatThrownBy(() -> fileService.updateTextFile(u, pdf.id(), "x", null))
        .isInstanceOf(com.workplace.drive.exception.DriveNotTextFileException.class);
    assertThat(versionsRepo.listForDriveFile(pdf.id())).hasSize(1);
  }

  /** 갱신 경로의 크기 상한은 UTF-8 바이트 기준 10MB — 글자 수는 상한 아래여도 3바이트 한글이면 거부한다. 버전은 늘지 않는다. */
  @Test
  void updateTextFile_over10MBInUtf8_isRejected() throws Exception {
    long u = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(u, "팀");
    DriveFileResponse f = fileService.createTextFile(u, sp.id(), null, "긴글.md", "x", null);
    String big = "가".repeat((int) (DriveFileService.TEXT_FILE_MAX_BYTES / 3) + 1);
    assertThat((long) big.length()).isLessThan(DriveFileService.TEXT_FILE_MAX_BYTES);

    assertThatThrownBy(() -> fileService.updateTextFile(u, f.id(), big, null))
        .isInstanceOf(com.workplace.file.exception.FileSizeLimitExceededException.class);
    assertThat(versionsRepo.listForDriveFile(f.id())).hasSize(1);
  }

  /** 갱신 경로도 할당량을 넘으면 409(DriveQuotaExceededException) — 버전은 늘지 않는다. */
  @Test
  void updateTextFile_overQuota_isRejected() throws Exception {
    long u = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(u, "팀");
    DriveFileResponse f = fileService.createTextFile(u, sp.id(), null, "a.md", "x", null);
    dsl.update(com.workplace.jooq.Tables.TENANT)
        .set(com.workplace.jooq.Tables.TENANT.QUOTA_BYTES, 0L)
        .where(com.workplace.jooq.Tables.TENANT.ID.eq(1L))
        .execute();

    assertThatThrownBy(() -> fileService.updateTextFile(u, f.id(), "y", null))
        .isInstanceOf(com.workplace.drive.exception.DriveQuotaExceededException.class);
    assertThat(versionsRepo.listForDriveFile(f.id())).hasSize(1);
  }

  /** ID 지정 새 버전 — 이름으로 찾지 않아 소스 이름이 달라도 그 파일에 들어가고, 저장 이름은 파일의 지금 이름이다. */
  @Test
  void addVersion_bindsById_usesCurrentName() throws Exception {
    long u = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(u, "팀");
    DriveFileResponse f = fileService.createTextFile(u, sp.id(), null, "원래.md", "x", null);
    fileService.rename(u, f.id(), "바뀐.md");

    DriveFileResponse v2 =
        fileService.addVersion(
            u,
            f.id(),
            com.workplace.file.service.UploadSource.ofBytes(
                "원래.md", null, "y".getBytes(java.nio.charset.StandardCharsets.UTF_8)));

    assertThat(v2.id()).isEqualTo(f.id());
    assertThat(v2.name()).isEqualTo("바뀐.md");
    assertThat(v2.versionCount()).isEqualTo(2);
    assertThat(
            dsl.select(FILE.ORIGINAL_NAME)
                .from(FILE)
                .where(FILE.ID.eq(v2.fileId()))
                .fetchOne(FILE.ORIGINAL_NAME))
        .isEqualTo("바뀐.md");
    // 옛 이름으로 새 파일이 생기지 않았다
    assertThat(
            dsl.fetchExists(
                com.workplace.jooq.Tables.DRIVE_FILE,
                com.workplace.jooq.Tables.DRIVE_FILE
                    .SPACE_ID
                    .eq(sp.id())
                    .and(com.workplace.jooq.Tables.DRIVE_FILE.NAME.eq("원래.md"))))
        .isFalse();
  }

  // ── 최종 리뷰 I3·I4·M2: 추출 텍스트가 원문과 다른 파일은 내용으로 고쳐 쓰지 않는다 ──────────────

  /** 원시 바이트 그대로 올린 파일(멀티파트) — UTF-8 이 아닌 원문 시험용. */
  private DriveFileResponse uploadBytes(long u, long spaceId, String name, String mime, byte[] body)
      throws Exception {
    return fileService.upload(u, spaceId, null, new MockMultipartFile("file", name, mime, body));
  }

  /**
   * UTF-8 이 아닌 원문(CP949 "가나")은 409 — 워커가 대체 문자로 읽어 한글이 깨진 채 굳는다. 끝이 잘린 UTF-8 바이트열("가"의 앞 두 바이트)도
   * 같다. 버전은 늘지 않는다.
   */
  @Test
  void updateTextFile_nonUtf8Original_conflicts() throws Exception {
    long u = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(u, "팀");
    byte[] cp949 = {(byte) 0xB0, (byte) 0xA1, (byte) 0xB3, (byte) 0xAA, '\n'};
    byte[] cutUtf8 = {'a', ',', 'b', '\n', (byte) 0xEA, (byte) 0xB0};
    DriveFileResponse csv = uploadBytes(u, sp.id(), "표.csv", "text/csv", cp949);
    DriveFileResponse txt = uploadBytes(u, sp.id(), "끝.txt", "text/plain", cutUtf8);

    for (DriveFileResponse f : new DriveFileResponse[] {csv, txt}) {
      assertThatThrownBy(() -> fileService.updateTextFile(u, f.id(), "a,b", null))
          .as(f.name())
          .isInstanceOf(com.workplace.drive.exception.DriveNotTextFileException.class)
          .hasMessageContaining("UTF-8")
          .hasMessageEndingWith("업로드 링크로 파일을 올리세요");
      assertThat(versionsRepo.listForDriveFile(f.id())).hasSize(1);
    }
    // 올바른 UTF-8(한글·이모지·BOM 없음)은 그대로 고쳐 쓸 수 있다.
    DriveFileResponse ok =
        uploadBytes(
            u,
            sp.id(),
            "좋음.csv",
            "text/csv",
            "가,😀\n".getBytes(java.nio.charset.StandardCharsets.UTF_8));
    assertThat(fileService.updateTextFile(u, ok.id(), "나,😀", null).versionCount()).isEqualTo(2);
  }

  /**
   * 추출이 잘린 파일(워커 MAX_CHARS 초과, file_extraction.truncated)은 409 — AI 가 앞부분만 읽고 덮으면 뒷부분이 사라진다. 추출이 아직
   * PENDING 이면 잘림을 알 수 없어 UTF-8 검사만으로 판단한다(갱신된다).
   */
  @Test
  void updateTextFile_truncatedExtraction_conflicts_pendingAllowed() throws Exception {
    long u = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(u, "팀");
    DriveFileResponse big = fileService.createTextFile(u, sp.id(), null, "큰.md", "앞부분", null);
    DriveFileResponse pending = fileService.createTextFile(u, sp.id(), null, "대기.md", "x", null);
    dsl.update(FILE_EXTRACTION)
        .set(FILE_EXTRACTION.STATUS, "DONE")
        .set(FILE_EXTRACTION.EXTRACTED_TEXT, "앞부분")
        .set(FILE_EXTRACTION.TRUNCATED, true)
        .where(FILE_EXTRACTION.FILE_ID.eq(big.fileId()))
        .execute();

    assertThatThrownBy(() -> fileService.updateTextFile(u, big.id(), "앞부분만 고침", null))
        .isInstanceOf(com.workplace.drive.exception.DriveNotTextFileException.class)
        .hasMessageContaining("앞부분만")
        .hasMessageEndingWith("업로드 링크로 파일을 올리세요");
    assertThat(versionsRepo.listForDriveFile(big.id())).hasSize(1);
    assertThat(
            dsl.select(FILE_EXTRACTION.STATUS)
                .from(FILE_EXTRACTION)
                .where(FILE_EXTRACTION.FILE_ID.eq(pending.fileId()))
                .fetchOne(FILE_EXTRACTION.STATUS))
        .isEqualTo("PENDING");
    assertThat(fileService.updateTextFile(u, pending.id(), "y", null).versionCount()).isEqualTo(2);
  }

  /**
   * 이름으로 만든 텍스트가 같은 이름의 기존 파일에 흡수될 때도 갱신과 같은 규칙(최종 리뷰 M2) — docx 는 409 이고 버전·FILE 행이 늘지 않는다(blob 저장
   * 전에 거절), html 은 409, yaml 은 지금 MIME(application/x-yaml)을 유지한다.
   */
  @Test
  void createTextFile_sameNameExisting_followsUpdateRules() throws Exception {
    long u = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(u, "팀");
    DriveFileResponse doc =
        uploadBytes(
            u,
            sp.id(),
            "보고서.docx",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            new byte[] {1, 2, 3});
    DriveFileResponse html = uploadAs(u, sp.id(), "page.html", "text/html", "<p>a</p>");
    DriveFileResponse yaml = uploadAs(u, sp.id(), "설정.yaml", "application/x-yaml", "a: 1");
    int filesBefore = dsl.fetchCount(FILE, FILE.UPLOADED_BY.eq(u));

    assertThatThrownBy(() -> fileService.createTextFile(u, sp.id(), null, "보고서.docx", "본문", null))
        .isInstanceOf(com.workplace.drive.exception.DriveNotTextFileException.class)
        .hasMessage("텍스트 파일만 내용으로 갱신할 수 있습니다");
    assertThatThrownBy(() -> fileService.createTextFile(u, sp.id(), null, "page.html", "a", null))
        .isInstanceOf(com.workplace.drive.exception.DriveNotTextFileException.class)
        .hasMessageContaining("HTML");
    assertThat(versionsRepo.listForDriveFile(doc.id())).hasSize(1);
    assertThat(versionsRepo.listForDriveFile(html.id())).hasSize(1);
    assertThat(dsl.fetchCount(FILE, FILE.UPLOADED_BY.eq(u))).isEqualTo(filesBefore);

    DriveFileResponse yamlV2 =
        fileService.createTextFile(u, sp.id(), null, "설정.yaml", "a: 2", null);
    assertThat(yamlV2.id()).isEqualTo(yaml.id());
    assertThat(yamlV2.versionCount()).isEqualTo(2);
    assertThat(yamlV2.mimeType()).isEqualTo("application/x-yaml");
  }
}
