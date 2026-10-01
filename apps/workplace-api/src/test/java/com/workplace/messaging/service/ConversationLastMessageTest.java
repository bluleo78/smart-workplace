package com.workplace.messaging.service;

import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.messaging.dto.ChannelResponse;
import com.workplace.messaging.dto.DmResponse;
import com.workplace.messaging.repository.ChannelMemberRepository;
import com.workplace.messaging.repository.ChannelRepository;
import com.workplace.messaging.repository.MessageAttachmentRepository;
import com.workplace.messaging.repository.MessageRepository;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.transaction.annotation.Transactional;

/** 채널·DM 목록 응답의 lastMessage(모바일 목록 미리보기, WP-135) 통합 테스트. */
@Transactional
class ConversationLastMessageTest extends IntegrationTestBase {

  @Autowired ChannelService channelService;
  @Autowired DmService dmService;
  @Autowired ChannelRepository channelRepo;
  @Autowired ChannelMemberRepository memberRepo;
  @Autowired MessageRepository messageRepo;
  @Autowired MessageAttachmentStorage attachmentStorage;
  @Autowired MessageAttachmentRepository attachmentRepo;
  @Autowired DSLContext dsl;

  @BeforeEach
  void setTenant() {
    TenantContext.set(1L);
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  /** 고유 user + tenant#1 ACTIVE 멤버십 seed. 이름을 지정해 authorName 단언에 쓴다. */
  private long seedUser(String name) {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "lm_" + s)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, name)
            .set(USER.EMAIL, "lm_" + s + "@example.com")
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

  /** caller 가 OWNER 인 채널 생성(고유 이름). */
  private long seedChannel(long owner) {
    long ch =
        channelRepo.insert("lm-" + UUID.randomUUID().toString().substring(0, 8), "PUBLIC", owner);
    memberRepo.add(ch, owner, "OWNER");
    return ch;
  }

  private ChannelResponse myChannel(long caller, long channelId) {
    return channelService.list(caller).stream()
        .filter(c -> c.id() == channelId)
        .findFirst()
        .orElseThrow();
  }

  @Test
  void picksLatestTopLevelMessage() {
    long me = seedUser("나사용자");
    long kim = seedUser("김철수");
    long ch = seedChannel(me);
    memberRepo.add(ch, kim, "MEMBER");
    messageRepo.insert(ch, me, "첫 메시지", List.of(), null);
    long last = messageRepo.insert(ch, kim, "점심   같이\n드실 분", List.of(), null);

    var lm = myChannel(me, ch).lastMessage();

    assertThat(lm).isNotNull();
    assertThat(lm.id()).isEqualTo(last);
    assertThat(lm.authorId()).isEqualTo(kim);
    assertThat(lm.authorName()).isEqualTo("김철수");
    assertThat(lm.preview()).isEqualTo("점심 같이 드실 분"); // 공백 접기
    assertThat(lm.createdAt()).isNotNull();
  }

  @Test
  void threadReplyIsExcluded() {
    long me = seedUser("나사용자");
    long ch = seedChannel(me);
    long root = messageRepo.insert(ch, me, "루트", List.of(), null);
    messageRepo.insert(ch, me, "스레드 답글", List.of(), root);

    assertThat(myChannel(me, ch).lastMessage().id()).isEqualTo(root);
  }

  @Test
  void deletedLastFallsBackToPrevious() {
    long me = seedUser("나사용자");
    long ch = seedChannel(me);
    long prev = messageRepo.insert(ch, me, "이전", List.of(), null);
    long del = messageRepo.insert(ch, me, "삭제될 것", List.of(), null);
    messageRepo.softDelete(del);

    assertThat(myChannel(me, ch).lastMessage().id()).isEqualTo(prev);

    messageRepo.softDelete(prev);
    assertThat(myChannel(me, ch).lastMessage()).isNull();
  }

  @Test
  void noMessageIsNull() {
    long me = seedUser("나사용자");
    long ch = seedChannel(me);

    assertThat(myChannel(me, ch).lastMessage()).isNull();
  }

  @Test
  void mentionTokenIsReplacedWithName() {
    long me = seedUser("나사용자");
    long lee = seedUser("이영희");
    long ch = seedChannel(me);
    messageRepo.insert(ch, me, "<@" + lee + "> 배포 확인 부탁", List.of(lee), null);

    assertThat(myChannel(me, ch).lastMessage().preview()).isEqualTo("@이영희 배포 확인 부탁");
  }

  @Test
  void attachmentOnlyMessageSaysFileSent() throws Exception {
    long me = seedUser("나사용자");
    long ch = seedChannel(me);
    long msg = messageRepo.insert(ch, me, null, List.of(), null);
    seedAttachment(msg, me);

    assertThat(myChannel(me, ch).lastMessage().preview()).isEqualTo("파일을 보냈습니다");
  }

  @Test
  void dmListCarriesLastMessage() {
    long me = seedUser("나사용자");
    long park = seedUser("박민수");
    DmResponse dm = dmService.createOrGet(me, List.of(park)).dm();
    long last = messageRepo.insert(dm.id(), park, "PR 리뷰 부탁드려요", List.of(), null);

    var found =
        dmService.listMyDms(me).stream()
            .filter(d -> d.id().equals(dm.id()))
            .findFirst()
            .orElseThrow();

    assertThat(found.lastMessage().id()).isEqualTo(last);
    assertThat(found.lastMessage().authorName()).isEqualTo("박민수");
    assertThat(found.lastMessage().preview()).isEqualTo("PR 리뷰 부탁드려요");
  }

  @Test
  void discoverNeverCarriesLastMessage() {
    long me = seedUser("나사용자");
    long other = seedUser("타인");
    long ch = seedChannel(other);
    messageRepo.insert(ch, other, "비멤버에게 보이면 안 됨", List.of(), null);

    var found =
        channelService.discover(me, null).stream()
            .filter(c -> c.id() == ch)
            .findFirst()
            .orElseThrow();

    assertThat(found.lastMessage()).isNull();
  }

  /** 임시 파일 저장 후 메시지에 바인딩 — MessageAttachmentRepositoryTest 와 같은 경로(TenantContext 필요). */
  private void seedAttachment(long messageId, long userId) throws Exception {
    var mf = new MockMultipartFile("file", "a.png", "image/png", new byte[] {1, 2, 3});
    Long fileId = attachmentStorage.storeTemporary(mf, userId);
    attachmentRepo.bind(fileId, messageId, userId);
  }
}
