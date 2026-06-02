package com.workplace.messaging.service;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
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
import org.springframework.transaction.annotation.Transactional;

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

  /** 시스템 ADMIN 역할을 가진 사용자 — 채널 비멤버여도 권한 오버라이드를 검증하기 위함. */
  private long seedAdminUser() {
    long id = seedUser();
    Long adminRoleId =
        dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("ADMIN")).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE)
        .set(USER_ROLE.USER_ID, id)
        .set(USER_ROLE.ROLE_ID, adminRoleId)
        .execute();
    return id;
  }

  @Test
  @Transactional // 영구 ADMIN 사용자가 다른 테스트(예: UserService 의 "마지막 admin")를 오염시키지 않도록 롤백.
  void updateRole_systemAdminTransfer_demotesActualOwner_keepsSingleOwner() {
    // 시스템 ADMIN(채널 비멤버)이 소유권을 이전하면 호출자가 아니라 "현재 OWNER" 가 강등되어야 한다.
    long owner = seedUser();
    long target = seedUser();
    long sysAdmin = seedAdminUser();
    ChannelResponse ch = channelService.create(owner, "일반", "PUBLIC");
    memberService.add(owner, ch.id(), target);

    memberService.updateRole(sysAdmin, ch.id(), target, "OWNER");

    assertThat(memberRepo.findRole(ch.id(), target)).contains("OWNER");
    assertThat(memberRepo.findRole(ch.id(), owner)).contains("ADMIN");
    long ownerCount =
        memberRepo.listMembers(ch.id()).stream().filter(m -> "OWNER".equals(m.role())).count();
    assertThat(ownerCount).isEqualTo(1);
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

    // 멤버(권한없음)가 추가 시도 → 403
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
    // 비멤버 조회 → 404 은닉
    assertThatThrownBy(() -> memberService.listMembers(seedUser(), ch.id()))
        .isInstanceOf(RuntimeException.class);
  }

  @Test
  void leave_ownerWithMembers_throws409_thenTransferThenLeave() {
    long owner = seedUser();
    long other = seedUser();
    ChannelResponse ch = channelService.create(owner, "일반", "PUBLIC");
    memberService.add(owner, ch.id(), other);

    // OWNER 가 멤버 남긴 채 나가기 → 409
    assertThatThrownBy(() -> memberService.leave(owner, ch.id()))
        .isInstanceOf(OwnershipTransferRequiredException.class);

    // 소유권 이전: other 를 OWNER 로 → 본인은 ADMIN 강등
    memberService.updateRole(owner, ch.id(), other, "OWNER");
    assertThat(memberRepo.findRole(ch.id(), other)).contains("OWNER");
    assertThat(memberRepo.findRole(ch.id(), owner)).contains("ADMIN");

    // 이제 나가기 가능
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
