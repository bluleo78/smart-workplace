package com.workplace.drive.repository;

import static com.workplace.jooq.Tables.CHANNEL;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** 채널 연동 공간 리포지토리 — 링크 조회/생성/보관 토글. */
@Transactional
class DriveChannelSpaceRepositoryTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired DriveSpaceRepository spaces;

  @BeforeEach
  void setTenant() {
    TenantContext.set(1L);
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  /** 테스트용 유저 시드. */
  private long seedUser() {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "dcr_" + s)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "Dcr" + s)
        .set(USER.EMAIL, "dcr_" + s + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  /** 테스트용 채널 시드(FK 충족용). */
  private long seedChannel(long createdBy) {
    return dsl.insertInto(CHANNEL)
        .set(CHANNEL.CREATED_BY, createdBy)
        .returning(CHANNEL.ID)
        .fetchOne()
        .getId();
  }

  /** 채널 링크로 공간 생성 후 findIdByLinkedChannel 로 조회. 미존재 채널은 empty. */
  @Test
  void insertAndFindByLinkedChannel() {
    long owner = seedUser();
    long channelId = seedChannel(owner);
    assertThat(spaces.findIdByLinkedChannel(channelId)).isEmpty();

    long spaceId = spaces.insertChannelSpace("채널공간", owner, channelId).orElseThrow();
    assertThat(spaces.findIdByLinkedChannel(channelId)).contains(spaceId);
    assertThat(spaces.isArchived(spaceId)).isFalse();
  }

  /** 동일 채널에 insertChannelSpace 재시도 → ON CONFLICT DO NOTHING 으로 빈 Optional(예외 없음). */
  @Test
  void insertChannelSpace_onConflictReturnsEmpty() {
    long owner = seedUser();
    long channelId = seedChannel(owner);
    long first = spaces.insertChannelSpace("채널공간", owner, channelId).orElseThrow();
    // 같은 채널로 재삽입 — 부분 UNIQUE 충돌 → 빈 Optional, 트랜잭션 오염 없이 후속 조회 가능.
    assertThat(spaces.insertChannelSpace("중복", owner, channelId)).isEmpty();
    assertThat(spaces.findIdByLinkedChannel(channelId)).contains(first);
  }

  /** 보관 토글 — setArchived(true) 후 isArchived true, false 후 false. */
  @Test
  void setArchived_togglesFlag() {
    long owner = seedUser();
    long spaceId = spaces.insertChannelSpace("ch", owner, seedChannel(owner)).orElseThrow();
    spaces.setArchived(spaceId, true);
    assertThat(spaces.isArchived(spaceId)).isTrue();
    spaces.setArchived(spaceId, false);
    assertThat(spaces.isArchived(spaceId)).isFalse();
  }
}
