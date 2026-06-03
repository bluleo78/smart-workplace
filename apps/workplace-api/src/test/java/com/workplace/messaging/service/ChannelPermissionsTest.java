package com.workplace.messaging.service;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.messaging.exception.ChannelForbiddenException;
import com.workplace.messaging.exception.ChannelNotFoundException;
import com.workplace.messaging.repository.ChannelMemberRepository;
import com.workplace.messaging.repository.ChannelRepository;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** ChannelPermissions 권한 판정 통합 테스트. */
@Transactional
class ChannelPermissionsTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired ChannelRepository channelRepo;
  @Autowired ChannelMemberRepository memberRepo;
  @Autowired ChannelPermissions perms;

  private long seedUser() {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "cp_" + s)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "Cp" + s)
        .set(USER.EMAIL, "cp_" + s + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  @Test
  void requireMember_nonMemberOfPrivate_throws404() {
    long owner = seedUser();
    long ch = channelRepo.insert("비공개", "PRIVATE", owner);
    memberRepo.add(ch, owner, "OWNER");
    assertThatThrownBy(() -> perms.requireMember(ch, seedUser()))
        .isInstanceOf(ChannelNotFoundException.class);
  }

  @Test
  void requireManage_memberRole_throws403_ownerOk() {
    long owner = seedUser();
    long member = seedUser();
    long ch = channelRepo.insert("일반", "PUBLIC", owner);
    memberRepo.add(ch, owner, "OWNER");
    memberRepo.add(ch, member, "MEMBER");

    assertThatThrownBy(() -> perms.requireManage(ch, member, "rename"))
        .isInstanceOf(ChannelForbiddenException.class);
    assertThatCode(() -> perms.requireManage(ch, owner, "rename")).doesNotThrowAnyException();
  }

  @Test
  void requireOwner_adminThrows403() {
    long owner = seedUser();
    long admin = seedUser();
    long ch = channelRepo.insert("일반", "PUBLIC", owner);
    memberRepo.add(ch, owner, "OWNER");
    memberRepo.add(ch, admin, "ADMIN");
    assertThatThrownBy(() -> perms.requireOwner(ch, admin, "archive"))
        .isInstanceOf(ChannelForbiddenException.class);
  }
}
