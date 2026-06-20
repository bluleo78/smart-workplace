package com.workplace.messaging.controller;

import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.global.tenant.TenantContext;
import com.workplace.messaging.dto.ChannelDriveSpaceResponse;
import com.workplace.messaging.dto.ChannelResponse;
import com.workplace.messaging.exception.ChannelNotFoundException;
import com.workplace.messaging.service.ChannelDriveService;
import com.workplace.messaging.service.ChannelService;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** 채널 drive-space ensure — 멤버 생성·멱등, 비멤버 차단. */
@Transactional
class ChannelDriveControllerTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired ChannelService channelService;
  @Autowired ChannelDriveService channelDrive;

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
    long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "cdc_" + s)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, "Cdc" + s)
            .set(USER.EMAIL, "cdc_" + s + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    dsl.insertInto(MEMBERSHIP)
        .set(MEMBERSHIP.USER_ID, id)
        .set(MEMBERSHIP.TENANT_ID, 1L)
        .set(MEMBERSHIP.STATUS, "ACTIVE")
        .execute();
    return id;
  }

  @Test
  void ensure_byMember_createsSpace_idempotent() {
    long owner = seedUser();
    ChannelResponse ch = channelService.create(owner, "드라이브채널", "PRIVATE");

    ChannelDriveSpaceResponse a = channelDrive.ensure(owner, ch.id());
    assertThat(a.spaceId()).isPositive();
    assertThat(a.archived()).isFalse();

    ChannelDriveSpaceResponse b = channelDrive.ensure(owner, ch.id());
    assertThat(b.spaceId()).isEqualTo(a.spaceId()); // 멱등
  }

  @Test
  void ensure_byNonMember_blocked() {
    long owner = seedUser();
    long outsider = seedUser();
    ChannelResponse ch = channelService.create(owner, "비공개", "PRIVATE");

    assertThatThrownBy(() -> channelDrive.ensure(outsider, ch.id()))
        .isInstanceOf(ChannelNotFoundException.class); // 비공개 비멤버 은닉
  }
}
