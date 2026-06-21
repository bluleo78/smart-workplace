package com.workplace.drive.service;

import static com.workplace.jooq.Tables.DRIVE_FOLDER;
import static com.workplace.jooq.Tables.DRIVE_SPACE;
import static com.workplace.jooq.Tables.DRIVE_SPACE_MEMBER;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.drive.dto.DriveFolderResponse;
import com.workplace.drive.dto.DriveSpaceResponse;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * 벌크 이동 롤백 가드 — 단일 트랜잭션 롤백 검증.
 *
 * <p>이 테스트는 클래스 레벨 {@code @Transactional} 없이 실행한다. {@code DriveBulkService.bulkMove} 는
 * {@code @Transactional(REQUIRED)} 이므로, 호출 스레드에 주변 트랜잭션이 없을 때 자신의 트랜잭션을 열고 예외 시 커밋 없이 롤백한다. 롤백 후 DB
 * 에서 직접 읽어 실제 롤백 여부를 확인한다.
 *
 * <p>공유 DB 무오염: 생성한 행은 {@code @AfterEach} 에서 id 기반으로 삭제한다.
 */
class DriveBulkServiceRollbackTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired DriveBulkService bulkService;
  @Autowired DriveFolderService folderService;
  @Autowired DriveSpaceService spaceService;

  // @AfterEach 정리용 id
  private Long ownerId;
  private Long spaceId;

  @AfterEach
  void cleanup() {
    if (spaceId != null) {
      dsl.deleteFrom(DRIVE_FOLDER).where(DRIVE_FOLDER.SPACE_ID.eq(spaceId)).execute();
      dsl.deleteFrom(DRIVE_SPACE_MEMBER).where(DRIVE_SPACE_MEMBER.SPACE_ID.eq(spaceId)).execute();
      dsl.deleteFrom(DRIVE_SPACE).where(DRIVE_SPACE.ID.eq(spaceId)).execute();
    }
    if (ownerId != null) {
      dsl.deleteFrom(USER).where(USER.ID.eq(ownerId)).execute();
    }
    TenantContext.clear();
  }

  @Test
  void 벌크이동_일부_실패하면_전체_롤백() {
    TenantContext.set(1L);

    // 소유자 + 팀 공간 생성(서비스의 자체 @Transactional 이 커밋)
    String suffix = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    ownerId =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "bk_rb_" + suffix)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, "Bk" + suffix)
            .set(USER.EMAIL, "bk_rb_" + suffix + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();

    DriveSpaceResponse space = spaceService.createTeamSpace(ownerId, "팀_rb_" + suffix);
    spaceId = space.id();

    DriveFolderResponse a = folderService.create(ownerId, spaceId, null, "A_rb");
    DriveFolderResponse b = folderService.create(ownerId, spaceId, null, "B_rb");

    // A 를 자기 자신으로 이동(self) → DriveInvalidTargetException.
    // B 는 유효하지만 같은 트랜잭션이라 함께 롤백되어야 한다.
    org.assertj.core.api.Assertions.assertThatThrownBy(
            () ->
                bulkService.bulkMove(ownerId, spaceId, List.of(), List.of(b.id(), a.id()), a.id()))
        .isInstanceOf(RuntimeException.class);

    // B 의 parent 가 그대로 null(루트)인지 확인 → 롤백 증명(커밋된 DB 에서 읽음)
    Long bParent =
        dsl.select(DRIVE_FOLDER.PARENT_ID)
            .from(DRIVE_FOLDER)
            .where(DRIVE_FOLDER.ID.eq(b.id()))
            .fetchOne(DRIVE_FOLDER.PARENT_ID);
    assertThat(bParent).isNull();
  }
}
