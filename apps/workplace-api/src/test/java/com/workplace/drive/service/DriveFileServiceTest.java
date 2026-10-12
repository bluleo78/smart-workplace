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
  @Autowired com.workplace.fileai.repository.WorkerJobRepository jobRepo;

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
}
