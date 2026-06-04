package com.workplace.drive.service;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.drive.dto.DriveFileResponse;
import com.workplace.drive.dto.DriveSpaceResponse;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.transaction.annotation.Transactional;

@Transactional
class DriveTrashServiceTest extends IntegrationTestBase {
  @Autowired DSLContext dsl;
  @Autowired DriveSpaceService spaceService;
  @Autowired DriveFileService fileService;
  @Autowired DriveFolderService folderService;
  @Autowired DriveTrashService trashService;

  private long seedUser() {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "tr_" + s)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "Tr" + s)
        .set(USER.EMAIL, "tr_" + s + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  private MockMultipartFile txt() {
    return new MockMultipartFile("file", "memo.txt", "text/plain", "hello".getBytes());
  }

  /** 삭제한 파일·폴더가 휴지통 목록에 trash_root 단위로 나타난다. */
  @Test
  void listTrash_showsDeletedRoots() throws Exception {
    long u = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(u, "팀");
    var folder = folderService.create(u, sp.id(), null, "보고서");
    fileService.upload(u, sp.id(), folder.id(), txt()); // 폴더 안 파일(하위)
    DriveFileResponse loose = fileService.upload(u, sp.id(), null, txt());

    folderService.delete(u, folder.id()); // 폴더 통째
    fileService.delete(u, loose.id()); // 루트 파일

    var list = trashService.listTrash(u, sp.id());
    assertThat(list.items()).hasSize(2); // 폴더1 + 루트파일1 (폴더 안 파일은 하위라 제외)
    assertThat(list.items()).anyMatch(i -> i.type().equals("FOLDER") && i.name().equals("보고서"));
    assertThat(list.items()).anyMatch(i -> i.type().equals("FILE"));
    assertThat(list.items()).allMatch(i -> i.autoPurgeAt().isAfter(i.trashedAt()));
  }
}
