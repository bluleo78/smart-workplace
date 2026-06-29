package com.workplace.messaging.integration;

import static com.workplace.jooq.Tables.CHANNEL;
import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;

import com.workplace.global.realtime.SseRegistry;
import com.workplace.global.tenant.TenantContext;
import com.workplace.messaging.dto.CreateMessageRequest;
import com.workplace.messaging.dto.MessageResponse;
import com.workplace.messaging.repository.ChannelRepository;
import com.workplace.messaging.service.ChannelService;
import com.workplace.messaging.service.MessageAttachmentStorage;
import com.workplace.messaging.service.MessageService;
import com.workplace.support.IntegrationTestBase;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/**
 * 첨부 포함 메시지 SSE fan-out 회귀 테스트.
 *
 * <p>첨부가 있는 메시지를 생성하면 "messaging.message.created" SSE payload(MessageResponse)의 attachments 가 채워져
 * fan-out 되는지 검증한다(Task 9 하이드레이션 흐름의 회귀 가드).
 */
class MessageAttachmentSseFanOutTest extends IntegrationTestBase {

  /** SseRegistry 를 mock 으로 대체해 fan-out payload 를 캡처한다. */
  @MockitoBean SseRegistry registry;

  @Autowired DSLContext dsl;
  @Autowired ChannelService channelService;
  @Autowired MessageService messageService;
  @Autowired ChannelRepository channelRepo;
  @Autowired MessageAttachmentStorage storage;

  // 비-Tx(커밋) 테스트: 만든 user id 추적 → @AfterEach 에서 회수.
  private final List<Long> createdUserIds = new ArrayList<>();

  /** FilePathBuilder 가 TenantContext 를 읽어 경로를 생성하므로 테스트 실행 전 테넌트(1) 세팅. */
  @BeforeEach
  void setTenant() {
    TenantContext.set(1L);
  }

  @AfterEach
  void cleanup() {
    /** 테스트 종료 후 TenantContext 해제 — 다른 테스트에 누출 방지. */
    TenantContext.clear();
    if (createdUserIds.isEmpty()) return;
    // channel 삭제 → message/attachment CASCADE. file(uploaded_by, non-cascade) 은 별도 삭제 후 user.
    dsl.deleteFrom(CHANNEL).where(CHANNEL.CREATED_BY.in(createdUserIds)).execute();
    dsl.deleteFrom(FILE).where(FILE.UPLOADED_BY.in(createdUserIds)).execute();
    dsl.deleteFrom(USER).where(USER.ID.in(createdUserIds)).execute();
    createdUserIds.clear();
  }

  /** 테스트 격리용 유니크 유저 INSERT 후 ID 반환. */
  private long seedUser() {
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").substring(0, 8);
    long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "msg_att_sse_" + suffix)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, "MsgAttSse" + suffix)
            .set(USER.EMAIL, "msgattsse_" + suffix + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    createdUserIds.add(id);
    return id;
  }

  /** 첨부 포함 메시지 생성 → fan-out payload 의 attachments 에 해당 파일이 담겨 있다. */
  @Test
  void messageWithAttachment_fansOutWithAttachments() throws Exception {
    long uid = seedUser();
    long channelId = channelRepo.insertPublic("att-fan-out-" + UUID.randomUUID(), uid);
    channelService.join(uid, channelId);
    var mf = new MockMultipartFile("files", "fan.txt", "text/plain", "z".getBytes());
    Long fileId = storage.storeTemporary(mf, uid);

    messageService.create(uid, channelId, new CreateMessageRequest("첨부", null, List.of(fileId)));

    ArgumentCaptor<Object> payload = ArgumentCaptor.forClass(Object.class);
    verify(registry, timeout(2000))
        .fanOut(any(), eq("messaging.message.created"), payload.capture());

    MessageResponse resp = (MessageResponse) payload.getValue();
    assertThat(resp.attachments()).hasSize(1);
    assertThat(resp.attachments().get(0).originalName()).isEqualTo("fan.txt");
  }
}
