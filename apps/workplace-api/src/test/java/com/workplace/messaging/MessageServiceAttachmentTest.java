package com.workplace.messaging;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.global.tenant.TenantContext;
import com.workplace.messaging.dto.CreateMessageRequest;
import com.workplace.messaging.dto.MessageResponse;
import com.workplace.messaging.exception.EmptyMessageException;
import com.workplace.messaging.repository.ChannelRepository;
import com.workplace.messaging.service.ChannelService;
import com.workplace.messaging.service.MessageAttachmentStorage;
import com.workplace.messaging.service.MessageService;
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

/** MessageService 첨부 통합 — 바인딩/빈 메시지 거부/하이드레이션(단건·리스트). */
@Transactional
class MessageServiceAttachmentTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired ChannelRepository channelRepo;
  @Autowired ChannelService channelService;
  @Autowired MessageService messageService;
  @Autowired MessageAttachmentStorage storage;

  /** FilePathBuilder 가 TenantContext 를 읽어 경로를 생성하므로 테스트 실행 전 테넌트(1) 세팅. */
  @BeforeEach
  void setTenant() {
    TenantContext.set(1L);
  }

  /** 테스트 종료 후 TenantContext 해제 — 다른 테스트에 누출 방지. */
  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  /** 테스트 격리용 유니크 유저 INSERT. */
  private long seedUser() {
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "msg_attch_" + suffix)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "MsgAttch" + suffix)
        .set(USER.EMAIL, "msgattch_" + suffix + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  /** 채널 생성 + 작성자 가입. */
  private long seedChannel(long userId, String name) {
    long channelId = channelRepo.insertPublic(name, userId);
    channelService.join(userId, channelId);
    return channelId;
  }

  /**
   * create_attachmentOnly_succeeds: 본문 없이 첨부만 있는 메시지도 생성된다. 응답에 첨부 1건이 originalName 과 함께 하이드레이션된다.
   */
  @Test
  void create_attachmentOnly_succeeds() throws Exception {
    long userId = seedUser();
    long channelId = seedChannel(userId, "attch-only-" + UUID.randomUUID());
    var mf = new MockMultipartFile("files", "only.txt", "text/plain", "x".getBytes());
    Long fileId = storage.storeTemporary(mf, userId);

    MessageResponse res =
        messageService.create(
            userId, channelId, new CreateMessageRequest(null, null, List.of(fileId)));

    assertThat(res.body()).isNull();
    assertThat(res.attachments()).hasSize(1);
    assertThat(res.attachments().get(0).originalName()).isEqualTo("only.txt");
  }

  /** create_emptyBodyNoAttachments_rejected: 본문도 첨부도 없으면 EmptyMessageException. */
  @Test
  void create_emptyBodyNoAttachments_rejected() {
    long userId = seedUser();
    long channelId = seedChannel(userId, "empty-" + UUID.randomUUID());

    assertThatThrownBy(
            () ->
                messageService.create(
                    userId, channelId, new CreateMessageRequest(null, null, List.of())))
        .isInstanceOf(EmptyMessageException.class);
  }

  /**
   * create_withBodyAndAttachment_hydratesInList: 본문+첨부 메시지를 만든 뒤 채널 리스트 조회 시 해당 메시지의 attachments 가
   * 채워져 있다(리스트 경로의 batch enrich 검증).
   */
  @Test
  void create_withBodyAndAttachment_hydratesInList() throws Exception {
    long userId = seedUser();
    long channelId = seedChannel(userId, "list-hydrate-" + UUID.randomUUID());
    var mf = new MockMultipartFile("files", "doc.pdf", "application/pdf", "y".getBytes());
    Long fileId = storage.storeTemporary(mf, userId);

    MessageResponse created =
        messageService.create(
            userId, channelId, new CreateMessageRequest("see attached", null, List.of(fileId)));

    var page = messageService.list(userId, channelId, null, 50);
    MessageResponse fromList =
        page.items().stream().filter(m -> m.id().equals(created.id())).findFirst().orElseThrow();

    assertThat(fromList.attachments()).hasSize(1);
    assertThat(fromList.attachments().get(0).originalName()).isEqualTo("doc.pdf");
  }
}
