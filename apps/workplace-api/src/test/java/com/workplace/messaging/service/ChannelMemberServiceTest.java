package com.workplace.messaging.service;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.messaging.dto.ChannelMemberResponse;
import com.workplace.messaging.dto.ChannelResponse;
import com.workplace.messaging.exception.ChannelForbiddenException;
import com.workplace.messaging.exception.OwnershipTransferRequiredException;
import com.workplace.messaging.repository.ChannelMemberRepository;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/** ChannelMemberService 통합 테스트 — 초대/제거/나가기/소유권 이전. */
class ChannelMemberServiceTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired ChannelService channelService;
  @Autowired ChannelMemberService memberService;
  @Autowired ChannelMemberRepository memberRepo;

  private long seedUser() {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "cms_" + s)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "Cms" + s)
        .set(USER.EMAIL, "cms_" + s + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  @Test
  void add_byOwner_succeeds_byMemberForbidden() {
    long owner = seedUser();
    long target = seedUser();
    long bystander = seedUser();
    ChannelResponse ch = channelService.create(owner, "비공개", "PRIVATE");

    memberService.add(owner, ch.id(), target);
    assertThat(memberRepo.isMember(ch.id(), target)).isTrue();
    assertThat(memberRepo.findRole(ch.id(), target)).contains("MEMBER");

    assertThatThrownBy(() -> memberService.add(target, ch.id(), bystander))
        .isInstanceOf(ChannelForbiddenException.class);
  }

  @Test
  void remove_ownerCannotBeRemoved() {
    long owner = seedUser();
    long admin = seedUser();
    ChannelResponse ch = channelService.create(owner, "일반", "PUBLIC");
    memberService.add(owner, ch.id(), admin);
    memberService.updateRole(owner, ch.id(), admin, "ADMIN");

    assertThatThrownBy(() -> memberService.remove(admin, ch.id(), owner))
        .isInstanceOf(ChannelForbiddenException.class);
  }

  @Test
  void listMembers_memberOnly() {
    long owner = seedUser();
    ChannelResponse ch = channelService.create(owner, "비공개", "PRIVATE");
    List<ChannelMemberResponse> members = memberService.listMembers(owner, ch.id());
    assertThat(members).hasSize(1);
    assertThatThrownBy(() -> memberService.listMembers(seedUser(), ch.id()))
        .isInstanceOf(RuntimeException.class);
  }

  @Test
  void leave_ownerWithMembers_throws409_thenTransferThenLeave() {
    long owner = seedUser();
    long other = seedUser();
    ChannelResponse ch = channelService.create(owner, "일반", "PUBLIC");
    memberService.add(owner, ch.id(), other);

    assertThatThrownBy(() -> memberService.leave(owner, ch.id()))
        .isInstanceOf(OwnershipTransferRequiredException.class);

    memberService.updateRole(owner, ch.id(), other, "OWNER");
    assertThat(memberRepo.findRole(ch.id(), other)).contains("OWNER");
    assertThat(memberRepo.findRole(ch.id(), owner)).contains("ADMIN");

    memberService.leave(owner, ch.id());
    assertThat(memberRepo.isMember(ch.id(), owner)).isFalse();
  }

  @Test
  void leave_soleOwner_throws409() {
    long owner = seedUser();
    ChannelResponse ch = channelService.create(owner, "혼자", "PRIVATE");
    assertThatThrownBy(() -> memberService.leave(owner, ch.id()))
        .isInstanceOf(OwnershipTransferRequiredException.class);
  }

  @Test
  void leave_member_succeeds() {
    long owner = seedUser();
    long member = seedUser();
    ChannelResponse ch = channelService.create(owner, "공개", "PUBLIC");
    channelService.join(member, ch.id());
    memberService.leave(member, ch.id());
    assertThat(memberRepo.isMember(ch.id(), member)).isFalse();
  }

  @Test
  void updateRole_transferOwner_demotesPreviousOwner() {
    long owner = seedUser();
    long target = seedUser();
    ChannelResponse ch = channelService.create(owner, "일반", "PUBLIC");
    memberService.add(owner, ch.id(), target);
    memberService.updateRole(owner, ch.id(), target, "OWNER");
    assertThat(memberRepo.findRole(ch.id(), owner)).contains("ADMIN");
    assertThat(memberRepo.findRole(ch.id(), target)).contains("OWNER");
  }

  @Test
  void updateRole_byNonOwner_throws403() {
    long owner = seedUser();
    long admin = seedUser();
    long member = seedUser();
    ChannelResponse ch = channelService.create(owner, "일반", "PUBLIC");
    memberService.add(owner, ch.id(), admin);
    memberService.updateRole(owner, ch.id(), admin, "ADMIN");
    memberService.add(owner, ch.id(), member);

    assertThatThrownBy(() -> memberService.updateRole(admin, ch.id(), member, "ADMIN"))
        .isInstanceOf(ChannelForbiddenException.class);
  }
}
