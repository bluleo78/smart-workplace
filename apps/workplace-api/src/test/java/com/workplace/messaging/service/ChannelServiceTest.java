package com.workplace.messaging.service;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.messaging.dto.ChannelResponse;
import com.workplace.messaging.exception.ChannelForbiddenException;
import com.workplace.messaging.exception.ChannelNameDuplicatedException;
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
  void join_privateChannel_byNonMember_throws404() {
    long owner = seedUser();
    ChannelResponse priv = channelService.create(owner, "비공개", "PRIVATE");
    // 비공개 채널 비멤버에겐 존재를 숨긴다(WP-511) — 403 이 아니라 없는 채널과 같은 404.
    assertThatThrownBy(() -> channelService.join(seedUser(), priv.id()))
        .isInstanceOf(ChannelNotFoundException.class);
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

  /** #688 — 동일 테넌트 내 동일 이름(대소문자 무시) 활성 채널 생성은 하드 차단된다(컨테이너류 이름은 식별자 — #696/#803 과 동일 정책). */
  @Test
  void create_duplicateName_throws() {
    long u = seedUser();
    channelService.create(u, "중복채널", "PUBLIC");

    assertThatThrownBy(() -> channelService.create(u, "중복채널", "PUBLIC"))
        .isInstanceOf(ChannelNameDuplicatedException.class);
    // 대소문자만 다른 이름도 동일 취급.
    assertThatThrownBy(() -> channelService.create(u, "중복채널".toUpperCase(), "PRIVATE"))
        .isInstanceOf(ChannelNameDuplicatedException.class);
  }

  /** WP-592 — 이름 앞뒤 공백은 다듬어 저장하고, 다듬은 이름으로 중복을 판정한다(공백만 다른 같은 이름 채널 방지). */
  @Test
  void create_trimsName_andTreatsPaddedNameAsDuplicate() {
    long u = seedUser();
    ChannelResponse ch = channelService.create(u, "  공백채널\t", "PUBLIC");
    assertThat(ch.name()).isEqualTo("공백채널");

    assertThatThrownBy(() -> channelService.create(u, "공백채널 ", "PUBLIC"))
        .isInstanceOf(ChannelNameDuplicatedException.class);
    assertThatThrownBy(() -> channelService.create(u, " 공백채널", "PRIVATE"))
        .isInstanceOf(ChannelNameDuplicatedException.class);
    assertThatThrownBy(() -> channelService.create(u, "   ", "PUBLIC"))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessage("채널 이름을 입력해 주세요");
  }

  /** WP-592 — 이름 변경도 앞뒤 공백을 다듬고, 공백만 덧붙인 다른 채널 이름으로는 바꿀 수 없다. */
  @Test
  void rename_trimsName_andRejectsPaddedDuplicate() {
    long u = seedUser();
    channelService.create(u, "다듬기A", "PUBLIC");
    ChannelResponse b = channelService.create(u, "다듬기B", "PUBLIC");

    assertThatThrownBy(() -> channelService.rename(u, b.id(), " 다듬기A "))
        .isInstanceOf(ChannelNameDuplicatedException.class);
    assertThat(channelService.rename(u, b.id(), "  다듬기C  ").name()).isEqualTo("다듬기C");
  }

  /** #688 — 이름변경도 동일 정책. 자기 자신 이름으로의 "변경"(no-op)은 차단하지 않는다. */
  @Test
  void rename_duplicateName_throws_selfRenameOk() {
    long u = seedUser();
    ChannelResponse a = channelService.create(u, "채널A", "PUBLIC");
    ChannelResponse b = channelService.create(u, "채널B", "PUBLIC");

    assertThatThrownBy(() -> channelService.rename(u, b.id(), "채널A"))
        .isInstanceOf(ChannelNameDuplicatedException.class);
    // 자기 자신 이름 그대로 재저장은 허용(대소문자 변경 포함).
    ChannelResponse renamed = channelService.rename(u, a.id(), "채널A");
    assertThat(renamed.name()).isEqualTo("채널A");
  }

  /** #688 — 아카이브된 채널의 이름은 재사용 가능(활성 채널만 중복 검사 대상). */
  @Test
  void create_archivedChannelName_reusable() {
    long u = seedUser();
    ChannelResponse ch = channelService.create(u, "보관후재사용", "PUBLIC");
    channelService.archive(u, ch.id());

    ChannelResponse reused = channelService.create(u, "보관후재사용", "PUBLIC");
    assertThat(reused.name()).isEqualTo("보관후재사용");
  }

  /**
   * WP-590 — 비공개 채널 이름은 그 채널을 볼 수 없는 사람의 채널 만들기·이름 변경을 막지 않는다(막으면 409 냐 201 이냐로 비공개 채널이 있다는 게
   * 드러난다). 공개 채널 이름은 워크스페이스 전체에서, 비공개 채널 이름은 내가 볼 수 있는 채널 안에서 유일하다.
   */
  @Test
  void privateChannelName_isHiddenFromNonMembers_butUniqueAmongVisibleChannels() {
    long owner = seedUser();
    long other = seedUser();
    long third = seedUser();
    long fourth = seedUser();
    channelService.create(owner, "인사비밀", "PRIVATE");

    // 볼 수 없는 사람은 같은 이름으로 비공개·공개 채널을 만들 수 있다.
    assertThat(channelService.create(other, "인사비밀", "PRIVATE").name()).isEqualTo("인사비밀");
    assertThat(channelService.create(third, "인사비밀", "PUBLIC").name()).isEqualTo("인사비밀");
    // 이름 변경도 마찬가지.
    channelService.create(owner, "재무비밀", "PRIVATE");
    ChannelResponse misc = channelService.create(other, "기타", "PUBLIC");
    assertThat(channelService.rename(other, misc.id(), "재무비밀").name()).isEqualTo("재무비밀");

    // 내가 볼 수 있는 채널과는 겹칠 수 없다 — 내 비공개 채널, 그리고 이제 누구나 보는 공개 「인사비밀」.
    assertThatThrownBy(() -> channelService.create(owner, "인사비밀", "PRIVATE"))
        .isInstanceOf(ChannelNameDuplicatedException.class);
    assertThatThrownBy(() -> channelService.create(fourth, "인사비밀", "PUBLIC"))
        .isInstanceOf(ChannelNameDuplicatedException.class);
    assertThatThrownBy(() -> channelService.create(fourth, "인사비밀", "PRIVATE"))
        .isInstanceOf(ChannelNameDuplicatedException.class);
  }
}
