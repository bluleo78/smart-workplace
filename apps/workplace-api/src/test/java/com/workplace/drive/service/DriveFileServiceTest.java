package com.workplace.drive.service;

import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.drive.dto.DriveFileResponse;
import com.workplace.drive.dto.DriveSpaceResponse;
import com.workplace.drive.exception.DriveFileNotFoundException;
import com.workplace.file.service.FileUploadService;
import com.workplace.file.service.FileUploadService.FileContentResult;
import com.workplace.support.IntegrationTestBase;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.util.Optional;
import java.util.UUID;
import javax.imageio.ImageIO;
import org.jooq.DSLContext;
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

  @Test
  void copy_physicallyDuplicatesBlob_independentStoragePath() throws Exception {
    long u = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(u, "팀");
    DriveFileResponse f = fileService.upload(u, sp.id(), null, txt());

    DriveFileResponse copy = fileService.copy(u, f.id(), null);

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
}
