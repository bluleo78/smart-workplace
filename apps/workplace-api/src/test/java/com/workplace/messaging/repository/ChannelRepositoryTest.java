package com.workplace.messaging.repository;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.messaging.dto.ChannelResponse;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/** channel 리포지토리 조회/CRUD 통합 테스트. */
class ChannelRepositoryTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired ChannelRepository channelRepo;
  @Autowired ChannelMemberRepository memberRepo;

  private long seedUser() {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "cr_" + s)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "Cr" + s)
        .set(USER.EMAIL, "cr_" + s + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  @Test
  void findMyChannels_onlyMemberAndNotArchived() {
    long u = seedUser();
    long mine = channelRepo.insert("내채널", "PRIVATE", u);
    memberRepo.add(mine, u, "OWNER");
    long other = channelRepo.insert("남채널", "PUBLIC", seedUser()); // u 비멤버
    long archived = channelRepo.insert("보관됨", "PUBLIC", u);
    memberRepo.add(archived, u, "OWNER");
    channelRepo.setArchived(archived, true);

    List<ChannelResponse> result = channelRepo.findMyChannels(u);
    assertThat(result).extracting(ChannelResponse::id).containsExactly(mine);
    ChannelResponse only = result.get(0);
    assertThat(only.member()).isTrue();
    assertThat(only.role()).isEqualTo("OWNER");
    assertThat(only.memberCount()).isEqualTo(1);
    assertThat(only.archived()).isFalse();
    assertThat(result).extracting(ChannelResponse::id).doesNotContain(other, archived);
  }

  @Test
  void searchDiscoverable_publicNotArchived_matchesName_excludesPrivate() {
    long owner = seedUser();
    long pub = channelRepo.insert("공개-개발팀", "PUBLIC", owner);
    long priv = channelRepo.insert("비공개-개발팀", "PRIVATE", owner);
    long arch = channelRepo.insert("공개-보관-개발팀", "PUBLIC", owner);
    channelRepo.setArchived(arch, true);

    List<ChannelResponse> result = channelRepo.searchDiscoverable(seedUser(), "개발팀");
    assertThat(result).extracting(ChannelResponse::id).containsExactly(pub);
    assertThat(result).extracting(ChannelResponse::id).doesNotContain(priv, arch);
    assertThat(result.get(0).member()).isFalse();
    assertThat(result.get(0).role()).isNull();
  }

  @Test
  void searchDiscoverable_blankQuery_returnsAllPublic() {
    long owner = seedUser();
    long pub = channelRepo.insert("아무거나", "PUBLIC", owner);
    List<ChannelResponse> result = channelRepo.searchDiscoverable(seedUser(), "");
    assertThat(result).extracting(ChannelResponse::id).contains(pub);
  }

  @Test
  void findDetail_returnsRoleAndCount() {
    long owner = seedUser();
    long ch = channelRepo.insert("상세", "PRIVATE", owner);
    memberRepo.add(ch, owner, "OWNER");

    ChannelResponse detail = channelRepo.findDetail(ch, owner).orElseThrow();
    assertThat(detail.role()).isEqualTo("OWNER");
    assertThat(detail.member()).isTrue();
    assertThat(detail.memberCount()).isEqualTo(1);
    assertThat(detail.visibility()).isEqualTo("PRIVATE");

    ChannelResponse asOutsider = channelRepo.findDetail(ch, seedUser()).orElseThrow();
    assertThat(asOutsider.member()).isFalse();
    assertThat(asOutsider.role()).isNull();
  }

  @Test
  void rename_archive_unarchive_hardDelete() {
    long owner = seedUser();
    long ch = channelRepo.insert("원래이름", "PUBLIC", owner);
    memberRepo.add(ch, owner, "OWNER");

    channelRepo.rename(ch, "새이름");
    assertThat(channelRepo.findDetail(ch, owner).orElseThrow().name()).isEqualTo("새이름");

    channelRepo.setArchived(ch, true);
    assertThat(channelRepo.isArchived(ch)).isTrue();
    channelRepo.setArchived(ch, false);
    assertThat(channelRepo.isArchived(ch)).isFalse();

    channelRepo.hardDelete(ch);
    assertThat(channelRepo.exists(ch)).isFalse();
  }
}
