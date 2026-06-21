package com.workplace.drive.service;

import static com.workplace.jooq.Tables.FILE;
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
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "fi_" + s)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "Fi" + s)
        .set(USER.EMAIL, "fi_" + s + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
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
}
