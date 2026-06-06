package com.workplace.drive.service;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.drive.dto.DriveFolderPathSegment;
import com.workplace.drive.dto.DriveFolderResponse;
import com.workplace.drive.dto.DriveSpaceResponse;
import com.workplace.drive.exception.DriveFolderNotFoundException;
import com.workplace.drive.exception.DriveSpaceNotFoundException;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** 폴더 조상 경로(breadcrumb) — 루트→대상 순서·권한·미존재 폴더. */
@Transactional
class DriveFolderPathTest extends IntegrationTestBase {
  @Autowired DSLContext dsl;
  @Autowired DriveSpaceService spaceService;
  @Autowired DriveFolderService folderService;

  private long seedUser() {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "fp_" + s)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "Fp" + s)
        .set(USER.EMAIL, "fp_" + s + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  /** 중첩 폴더 경로를 루트→대상 순으로 반환. */
  @Test
  void path_returnsRootToTarget() {
    long u = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(u, "팀");
    DriveFolderResponse a = folderService.create(u, sp.id(), null, "문서");
    DriveFolderResponse b = folderService.create(u, sp.id(), a.id(), "2026");

    List<DriveFolderPathSegment> path = folderService.path(u, b.id());

    assertThat(path).extracting(DriveFolderPathSegment::name).containsExactly("문서", "2026");
    assertThat(path).extracting(DriveFolderPathSegment::id).containsExactly(a.id(), b.id());
  }

  /** 루트 직속 폴더는 자기 자신만. */
  @Test
  void path_rootLevelFolder_returnsSelfOnly() {
    long u = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(u, "팀");
    DriveFolderResponse a = folderService.create(u, sp.id(), null, "문서");

    List<DriveFolderPathSegment> path = folderService.path(u, a.id());

    assertThat(path).extracting(DriveFolderPathSegment::name).containsExactly("문서");
  }

  /** 존재하지 않는 폴더 → NotFound. */
  @Test
  void path_unknownFolder_throws() {
    long u = seedUser();
    assertThatThrownBy(() -> folderService.path(u, 999_999L))
        .isInstanceOf(DriveFolderNotFoundException.class);
  }

  /** 비멤버는 조회 불가(존재 은닉 → SpaceNotFound). */
  @Test
  void path_byNonMember_isRejected() {
    long owner = seedUser();
    long outsider = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(owner, "팀");
    DriveFolderResponse a = folderService.create(owner, sp.id(), null, "문서");

    assertThatThrownBy(() -> folderService.path(outsider, a.id()))
        .isInstanceOf(DriveSpaceNotFoundException.class);
  }
}
