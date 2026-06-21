package com.workplace.drive.service;

import static com.workplace.jooq.Tables.DRIVE_FOLDER;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.drive.dto.DriveFolderResponse;
import com.workplace.drive.dto.DriveSpaceResponse;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/** 폴더 resolveOrCreate — 같은 이름이 있으면 기존 id 반환(merge), 없으면 생성. */
@org.springframework.transaction.annotation.Transactional
class DriveFolderResolveTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
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
            .set(USER.USERNAME, "rc_" + s)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, "Rc" + s)
            .set(USER.EMAIL, "rc_" + s + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    return spaceService.createTeamSpace(owner, "팀_" + s.substring(0, 4));
  }

  @Test
  void 같은_이름이면_기존_폴더_id_반환_신규생성_없음() {
    DriveSpaceResponse space = createSpace();
    DriveFolderResponse first = folderService.create(owner, space.id(), null, "docs");
    int before = dsl.fetchCount(DRIVE_FOLDER, DRIVE_FOLDER.SPACE_ID.eq(space.id()));

    DriveFolderResponse resolved = folderService.resolveOrCreate(owner, space.id(), null, "docs");

    assertThat(resolved.id()).isEqualTo(first.id());
    assertThat(dsl.fetchCount(DRIVE_FOLDER, DRIVE_FOLDER.SPACE_ID.eq(space.id())))
        .isEqualTo(before);
  }

  @Test
  void 다른_이름이면_새로_생성() {
    DriveSpaceResponse space = createSpace();
    DriveFolderResponse created = folderService.resolveOrCreate(owner, space.id(), null, "new");
    assertThat(created.name()).isEqualTo("new");
  }
}
