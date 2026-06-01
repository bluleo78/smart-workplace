package com.workplace.messaging.repository;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.messaging.dto.ChannelMemberResponse;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/** channel_member 역할/멤버 관리 통합 테스트. */
class ChannelMemberRepositoryTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired ChannelRepository channelRepo;
  @Autowired ChannelMemberRepository memberRepo;

  private long seedUser() {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "cm_" + s)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "Cm" + s)
        .set(USER.EMAIL, "cm_" + s + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  @Test
  void add_withRole_thenFindRole() {
    long owner = seedUser();
    long ch = channelRepo.insert("일반", "PUBLIC", owner);
    memberRepo.add(ch, owner, "OWNER");

    assertThat(memberRepo.findRole(ch, owner)).contains("OWNER");
    assertThat(memberRepo.findRole(ch, seedUser())).isEmpty();
    assertThat(memberRepo.countMembers(ch)).isEqualTo(1);
  }

  @Test
  void add_isIdempotent_doesNotDowngradeRole() {
    long owner = seedUser();
    long ch = channelRepo.insert("일반", "PUBLIC", owner);
    memberRepo.add(ch, owner, "OWNER");
    memberRepo.add(ch, owner, "MEMBER"); // 재합류 — 기존 OWNER 유지되어야 함

    assertThat(memberRepo.findRole(ch, owner)).contains("OWNER");
  }

  @Test
  void updateRole_and_remove() {
    long owner = seedUser();
    long m = seedUser();
    long ch = channelRepo.insert("일반", "PUBLIC", owner);
    memberRepo.add(ch, owner, "OWNER");
    memberRepo.add(ch, m, "MEMBER");

    memberRepo.updateRole(ch, m, "ADMIN");
    assertThat(memberRepo.findRole(ch, m)).contains("ADMIN");

    memberRepo.remove(ch, m);
    assertThat(memberRepo.isMember(ch, m)).isFalse();
    assertThat(memberRepo.countMembers(ch)).isEqualTo(1);
  }

  @Test
  void listMembers_includesNameKindRole() {
    long owner = seedUser();
    long ch = channelRepo.insert("일반", "PUBLIC", owner);
    memberRepo.add(ch, owner, "OWNER");

    List<ChannelMemberResponse> members = memberRepo.listMembers(ch);
    assertThat(members).hasSize(1);
    ChannelMemberResponse only = members.get(0);
    assertThat(only.userId()).isEqualTo(owner);
    assertThat(only.role()).isEqualTo("OWNER");
    assertThat(only.kind()).isEqualTo("HUMAN");
    assertThat(only.name()).isNotBlank();
  }
}
