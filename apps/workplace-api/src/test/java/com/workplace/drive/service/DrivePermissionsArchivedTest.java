package com.workplace.drive.service;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.drive.api.DriveChannelSpacePort.ChannelMemberSnapshot;
import com.workplace.drive.dto.DriveSpaceResponse;
import com.workplace.drive.exception.DriveForbiddenException;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** archived 공간 읽기전용 — 쓰기 역할 요구 403, 읽기 통과. */
@Transactional
class DrivePermissionsArchivedTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired DriveChannelSpaceService channelSpaces;
  @Autowired DrivePermissions perms;

  @BeforeEach
  void setTenant() {
    TenantContext.set(1L);
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  private long seedUser() {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "dpa_" + s)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "Dpa" + s)
        .set(USER.EMAIL, "dpa_" + s + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  /** 채널 FK 충족을 위해 실제 channel 레코드를 삽입. */
  private long seedChannel(long createdBy) {
    return dsl.insertInto(com.workplace.jooq.Tables.CHANNEL)
        .set(com.workplace.jooq.Tables.CHANNEL.CREATED_BY, createdBy)
        .returning(com.workplace.jooq.Tables.CHANNEL.ID)
        .fetchOne()
        .getId();
  }

  @Test
  void archivedSpace_blocksWrite_allowsRead() {
    long owner = seedUser();
    long channelId = seedChannel(owner);
    DriveSpaceResponse sp =
        channelSpaces.ensureChannelSpace(
            owner, channelId, "채널", List.of(new ChannelMemberSnapshot(owner, "OWNER")));

    // 보관 전: 쓰기 OK.
    perms.requireRole(sp.id(), owner, "EDITOR");

    channelSpaces.setChannelSpaceArchived(channelId, true);

    // 보관 후: 읽기 OK, 쓰기 403.
    assertThat(perms.requireRole(sp.id(), owner, "VIEWER")).isEqualTo("OWNER");
    assertThatThrownBy(() -> perms.requireRole(sp.id(), owner, "EDITOR"))
        .isInstanceOf(DriveForbiddenException.class);
  }
}
