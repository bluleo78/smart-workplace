package com.workplace.drive.service;

import static com.workplace.jooq.Tables.DRIVE_FILE;
import static com.workplace.jooq.Tables.DRIVE_FOLDER;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.drive.dto.DriveFileResponse;
import com.workplace.drive.dto.DriveFolderResponse;
import com.workplace.drive.dto.DriveSpaceResponse;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockMultipartFile;

/** ZIP 엔트리 수집 — 폴더 재귀 + 빈 폴더 디렉터리 엔트리. */
@org.springframework.transaction.annotation.Transactional
class DriveZipServiceTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired DriveZipService zipService;
  @Autowired DriveFileService fileService;
  @Autowired DriveFolderService folderService;
  @Autowired DriveSpaceService spaceService;

  private long owner;

  @BeforeEach
  void setTenant() {
    TenantContext.set(1L);
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  private DriveSpaceResponse createSpace() {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    owner =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "zp_" + s)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, "Zp" + s)
            .set(USER.EMAIL, "zp_" + s + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    return spaceService.createTeamSpace(owner, "팀_" + s.substring(0, 4));
  }

  private DriveFileResponse upload(long spaceId, Long folderId, String name) throws Exception {
    return fileService.upload(
        owner,
        spaceId,
        folderId,
        new MockMultipartFile("file", name, "text/plain", "x".getBytes()));
  }

  @Test
  void 폴더_재귀와_빈폴더가_상대경로_엔트리로_수집된다() throws Exception {
    DriveSpaceResponse space = createSpace();
    DriveFileResponse top = upload(space.id(), null, "top.txt");
    DriveFolderResponse docs = folderService.create(owner, space.id(), null, "docs");
    upload(space.id(), docs.id(), "a.txt");
    DriveFolderResponse sub = folderService.create(owner, space.id(), docs.id(), "sub");
    upload(space.id(), sub.id(), "b.txt");
    folderService.create(owner, space.id(), docs.id(), "empty"); // 빈 폴더

    List<DriveZipService.ZipEntrySource> entries =
        zipService.collectEntries(owner, space.id(), List.of(top.id()), List.of(docs.id()));

    List<String> paths = entries.stream().map(DriveZipService.ZipEntrySource::path).toList();
    assertThat(paths).contains("top.txt", "docs/a.txt", "docs/sub/b.txt", "docs/empty/");
    // 빈 폴더 엔트리는 directory=true
    assertThat(
            entries.stream()
                .filter(e -> e.path().equals("docs/empty/"))
                .findFirst()
                .orElseThrow()
                .directory())
        .isTrue();
  }

  private List<String> paths(long spaceId, List<Long> fileIds, List<Long> folderIds) {
    return zipService.collectEntries(owner, spaceId, fileIds, folderIds).stream()
        .map(DriveZipService.ZipEntrySource::path)
        .toList();
  }

  /**
   * 검사가 생기기 전에 저장된 경로 문자 이름도 ZIP 안에서 한 조각으로 정리된다 — 폴더가 더 생기거나 압축 폴더 밖으로 나가지 않는다(WP-339). 이름 검사를 우회해
   * DB 에 직접 넣는다.
   */
  @Test
  void 경로문자가_든_옛이름은_ZIP_경로에서_정리된다() throws Exception {
    DriveSpaceResponse space = createSpace();
    DriveFolderResponse box = folderService.create(owner, space.id(), null, "box");
    DriveFolderResponse evil = folderService.create(owner, space.id(), box.id(), "tmp");
    DriveFileResponse f = upload(space.id(), evil.id(), "x.txt");
    DriveFileResponse g = upload(space.id(), box.id(), "y.txt");
    DriveFolderResponse empty = folderService.create(owner, space.id(), box.id(), "e");
    dsl.update(DRIVE_FOLDER)
        .set(DRIVE_FOLDER.NAME, "..")
        .where(DRIVE_FOLDER.ID.eq(evil.id()))
        .execute();
    dsl.update(DRIVE_FOLDER)
        .set(DRIVE_FOLDER.NAME, "a/b")
        .where(DRIVE_FOLDER.ID.eq(empty.id()))
        .execute();
    dsl.update(DRIVE_FILE)
        .set(DRIVE_FILE.NAME, "..\\..\\x.txt")
        .where(DRIVE_FILE.ID.eq(f.id()))
        .execute();
    dsl.update(DRIVE_FILE)
        .set(DRIVE_FILE.NAME, "c\nd.txt")
        .where(DRIVE_FILE.ID.eq(g.id()))
        .execute();

    assertThat(paths(space.id(), List.of(), List.of(box.id())))
        .containsExactlyInAnyOrder("box/c_d.txt", "box/_/.._.._x.txt", "box/a_b/");
  }

  /** 같은 ZIP 폴더에서 겹치는 이름(파일·폴더 같은 이름, 대소문자만 다른 이름, 여러 폴더에서 고른 같은 이름 파일)은 번호를 붙여 모두 담는다(WP-339). */
  @Test
  void 겹치는_이름은_번호를_붙여_모두_담는다() throws Exception {
    DriveSpaceResponse space = createSpace();
    DriveFolderResponse a = folderService.create(owner, space.id(), null, "a");
    DriveFolderResponse b = folderService.create(owner, space.id(), null, "b");
    DriveFileResponse a1 = upload(space.id(), a.id(), "Report.txt");
    DriveFileResponse b1 = upload(space.id(), b.id(), "report.txt");
    DriveFileResponse docsFile = upload(space.id(), a.id(), "docs");
    DriveFolderResponse docs = folderService.create(owner, space.id(), a.id(), "docs");
    upload(space.id(), docs.id(), "in.txt");
    DriveFileResponse rootA = upload(space.id(), null, "a");

    // 여러 폴더에서 고른 같은 이름 파일(대소문자만 다름) + 고른 파일과 같은 이름의 고른 폴더
    assertThat(paths(space.id(), List.of(a1.id(), b1.id(), rootA.id()), List.of(a.id())))
        .containsExactlyInAnyOrder(
            "Report.txt",
            "report (1).txt",
            "a",
            "a (1)/Report.txt",
            "a (1)/docs",
            "a (1)/docs (1)/in.txt");
    assertThat(docsFile.name()).isEqualTo("docs");
  }
}
