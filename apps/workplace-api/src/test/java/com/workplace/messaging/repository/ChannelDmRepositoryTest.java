package com.workplace.messaging.repository;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.messaging.dto.DmResponse;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/** DM 리포지토리 메서드 + 채널 목록 DM 누수 회귀 테스트(실제 DB). */
class ChannelDmRepositoryTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired ChannelRepository channelRepo;
  @Autowired ChannelMemberRepository memberRepo;

  /** 고유 username/email 로 user 1행 insert 후 id 반환 — 공유 test DB(롤백 없음) 충돌 회피. */
  private long seedUser() {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "dm_" + s)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "Dm" + s)
        .set(USER.EMAIL, "dm_" + s + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  @Test
  void findMyChannels_excludesDm() {
    long u1 = seedUser();
    long u2 = seedUser();
    // 일반 채널 1개 (u1 OWNER)
    long ch = channelRepo.insert("일반", "PUBLIC", u1);
    memberRepo.add(ch, u1, "OWNER");
    // DM 1개 (u1, u2)
    long dm = channelRepo.insertDm("%d,%d".formatted(Math.min(u1, u2), Math.max(u1, u2)), u1);
    memberRepo.add(dm, u1, "MEMBER");
    memberRepo.add(dm, u2, "MEMBER");

    var mine = channelRepo.findMyChannels(u1);

    assertThat(mine).extracting("id").containsExactly(ch); // DM 미포함
  }

  @Test
  void findDmIdByMemberKey_findsExistingDm() {
    long u1 = seedUser();
    long u2 = seedUser();
    String key = "%d,%d".formatted(Math.min(u1, u2), Math.max(u1, u2));
    long dm = channelRepo.insertDm(key, u1);

    assertThat(channelRepo.findDmIdByMemberKey(key)).contains(dm);
    assertThat(channelRepo.findDmIdByMemberKey("999000001,999000002")).isEmpty();
  }

  @Test
  void findMyDms_returnsParticipants() {
    long u1 = seedUser();
    long u2 = seedUser();
    long dm = channelRepo.insertDm("%d,%d".formatted(Math.min(u1, u2), Math.max(u1, u2)), u1);
    memberRepo.add(dm, u1, "MEMBER");
    memberRepo.add(dm, u2, "MEMBER");

    List<DmResponse> dms = channelRepo.findMyDms(u1);

    assertThat(dms).hasSize(1);
    assertThat(dms.get(0).participants()).extracting("userId").containsExactlyInAnyOrder(u1, u2);
    assertThat(dms.get(0).lastMessageAt()).isNull(); // 메시지 0건
  }

  @Test
  void insertDm_duplicateMemberKey_dedupedByUniqueIndex() {
    long u1 = seedUser();
    long u2 = seedUser();
    String key = "%d,%d".formatted(Math.min(u1, u2), Math.max(u1, u2));
    assertThat(channelRepo.insertDmIfAbsent(key, u1)).isPresent();
    assertThat(channelRepo.insertDmIfAbsent(key, u1)).isEmpty(); // 부분 유니크 인덱스가 중복 차단
  }
}
