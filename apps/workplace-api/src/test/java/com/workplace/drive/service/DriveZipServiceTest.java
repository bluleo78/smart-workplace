package com.workplace.drive.service;

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
}
