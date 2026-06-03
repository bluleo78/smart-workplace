package com.workplace.messaging.service;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.messaging.dto.ChannelResponse;
import com.workplace.messaging.exception.ChannelForbiddenException;
import com.workplace.messaging.exception.ChannelNotFoundException;
import com.workplace.messaging.repository.ChannelMemberRepository;
import com.workplace.messaging.repository.ChannelRepository;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** ChannelService 통합 테스트 — 생성/탐색/내채널/관리 권한. */
@Transactional
class ChannelServiceTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired ChannelService channelService;
  @Autowired ChannelRepository channelRepo;
  @Autowired ChannelMemberRepository memberRepo;

  private long seedUser() {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "cs_" + s)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "Cs" + s)
        .set(USER.EMAIL, "cs_" + s + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  @Test
  void create_makesCallerOwner() {
    long u = seedUser();
    ChannelResponse ch = channelService.create(u, "새채널", "PRIVATE");
    assertThat(ch.visibility()).isEqualTo("PRIVATE");
    assertThat(ch.role()).isEqualTo("OWNER");
    assertThat(ch.member()).isTrue();
    assertThat(memberRepo.findRole(ch.id(), u)).contains("OWNER");
  }

  @Test
  void create_nullVisibility_defaultsPublic() {
    long u = seedUser();
    ChannelResponse ch = channelService.create(u, "기본공개", null);
    assertThat(ch.visibility()).isEqualTo("PUBLIC");
  }

  @Test
  void list_returnsOnlyMyChannels() {
    long u = seedUser();
    ChannelResponse mine = channelService.create(u, "내것", "PUBLIC");
    channelService.create(seedUser(), "남의것", "PUBLIC");
    List<ChannelResponse> result = channelService.list(u);
    assertThat(result).extracting(ChannelResponse::id).containsExactly(mine.id());
  }

  @Test
  void join_privateChannel_throws403() {
    long owner = seedUser();
    ChannelResponse priv = channelService.create(owner, "비공개", "PRIVATE");
    assertThatThrownBy(() -> channelService.join(seedUser(), priv.id()))
        .isInstanceOf(ChannelForbiddenException.class);
  }

  @Test
  void join_publicChannel_addsMember() {
    long owner = seedUser();
    long joiner = seedUser();
    ChannelResponse pub = channelService.create(owner, "공개", "PUBLIC");
    channelService.join(joiner, pub.id());
    assertThat(memberRepo.isMember(pub.id(), joiner)).isTrue();
  }

  @Test
  void getDetail_privateNonMember_throws404_publicPreviewOk() {
    long owner = seedUser();
    ChannelResponse priv = channelService.create(owner, "비공개", "PRIVATE");
    ChannelResponse pub = channelService.create(owner, "공개", "PUBLIC");

    assertThatThrownBy(() -> channelService.getDetail(seedUser(), priv.id()))
        .isInstanceOf(ChannelNotFoundException.class);
    // 공개 채널은 비멤버도 미리보기 가능
    ChannelResponse preview = channelService.getDetail(seedUser(), pub.id());
    assertThat(preview.member()).isFalse();
  }

  @Test
  void rename_byMember_throws403_byOwnerOk() {
    long owner = seedUser();
    long member = seedUser();
    ChannelResponse ch = channelService.create(owner, "원래", "PUBLIC");
    channelService.join(member, ch.id());

    assertThatThrownBy(() -> channelService.rename(member, ch.id(), "바꿈"))
        .isInstanceOf(ChannelForbiddenException.class);
    ChannelResponse renamed = channelService.rename(owner, ch.id(), "바꿈");
    assertThat(renamed.name()).isEqualTo("바꿈");
  }

  @Test
  void archive_unarchive_byOwner() {
    long owner = seedUser();
    ChannelResponse ch = channelService.create(owner, "보관대상", "PUBLIC");
    channelService.archive(owner, ch.id());
    assertThat(channelRepo.isArchived(ch.id())).isTrue();
    assertThat(channelService.list(owner)).extracting(ChannelResponse::id).doesNotContain(ch.id());
    channelService.unarchive(owner, ch.id());
    assertThat(channelRepo.isArchived(ch.id())).isFalse();
  }

  @Test
  void hardDelete_byNonAdmin_throws403() {
    long owner = seedUser();
    ChannelResponse ch = channelService.create(owner, "삭제대상", "PUBLIC");
    assertThatThrownBy(() -> channelService.hardDelete(owner, ch.id()))
        .isInstanceOf(ChannelForbiddenException.class);
  }
}
