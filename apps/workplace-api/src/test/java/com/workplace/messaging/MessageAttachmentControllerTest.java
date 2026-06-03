package com.workplace.messaging;

import static com.workplace.jooq.Tables.USER;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.global.security.JwtTokenProvider;
import com.workplace.messaging.dto.CreateMessageRequest;
import com.workplace.messaging.dto.MessageResponse;
import com.workplace.messaging.repository.ChannelRepository;
import com.workplace.messaging.service.ChannelService;
import com.workplace.messaging.service.MessageAttachmentStorage;
import com.workplace.messaging.service.MessageService;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/**
 * MessageAttachmentController 통합 테스트 — 실 JWT + 실 DB + 실 스토리지로 업로드/다운로드 + 멤버십 게이트를 검증한다. messaging
 * 엔드포인트는 @RequirePermission 없이 서비스에서 멤버십을 검증하므로 토큰만 유효하면 보안 체인을 통과한다.
 */
@AutoConfigureMockMvc
@Transactional
class MessageAttachmentControllerTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwtTokenProvider;
  @Autowired ChannelRepository channelRepo;
  @Autowired ChannelService channelService;
  @Autowired MessageService messageService;
  @Autowired MessageAttachmentStorage storage;

  /** 테스트 격리용 유니크 유저 INSERT 후 ID 반환. */
  private long seedUser() {
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "msg_att_ctl_" + suffix)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "MsgAttCtl" + suffix)
        .set(USER.EMAIL, "msgattctl_" + suffix + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  /** 퍼블릭 채널 생성 + 작성자 가입. */
  private long seedChannel(long userId, String name) {
    long channelId = channelRepo.insertPublic(name, userId);
    channelService.join(userId, channelId);
    return channelId;
  }

  /** userId 용 access token 발급 (Bearer 헤더 본문). */
  private String tokenFor(long userId) {
    return jwtTokenProvider.generateAccessToken(userId, "user-" + userId);
  }

  /** 멤버가 multipart 업로드 → 200 + fileId 메타 반환. */
  @Test
  void upload_returnsFileIds() throws Exception {
    long userId = seedUser();
    long channelId = seedChannel(userId, "att-upload-" + UUID.randomUUID());
    var file = new MockMultipartFile("files", "a.png", "image/png", "img-bytes".getBytes());

    mvc.perform(
            multipart("/api/v1/messaging/channels/" + channelId + "/attachments")
                .file(file)
                .header("Authorization", "Bearer " + tokenFor(userId)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[0].fileId").exists());
  }

  /** 멤버가 자신 채널 메시지의 첨부를 다운로드 → 200 + 본문 존재. */
  @Test
  void download_member_succeeds() throws Exception {
    long userId = seedUser();
    long channelId = seedChannel(userId, "att-dl-" + UUID.randomUUID());
    var mf = new MockMultipartFile("files", "down.txt", "text/plain", "hello-content".getBytes());
    Long fileId = storage.storeTemporary(mf, userId);
    MessageResponse msg =
        messageService.create(
            userId, channelId, new CreateMessageRequest(null, null, List.of(fileId)));

    mvc.perform(
            get("/api/v1/messaging/channels/"
                    + channelId
                    + "/messages/"
                    + msg.id()
                    + "/attachments/"
                    + fileId
                    + "/content")
                .header("Authorization", "Bearer " + tokenFor(userId)))
        .andExpect(status().isOk())
        .andExpect(content().bytes("hello-content".getBytes()));
  }

  /** 비멤버가 다운로드 시도 → 4xx (멤버십 검증 실패). */
  @Test
  void download_nonMember_forbidden() throws Exception {
    long owner = seedUser();
    long other = seedUser();
    long channelId = seedChannel(owner, "att-dl-forbid-" + UUID.randomUUID());
    var mf = new MockMultipartFile("files", "secret.txt", "text/plain", "secret".getBytes());
    Long fileId = storage.storeTemporary(mf, owner);
    MessageResponse msg =
        messageService.create(
            owner, channelId, new CreateMessageRequest(null, null, List.of(fileId)));

    mvc.perform(
            get("/api/v1/messaging/channels/"
                    + channelId
                    + "/messages/"
                    + msg.id()
                    + "/attachments/"
                    + fileId
                    + "/content")
                .header("Authorization", "Bearer " + tokenFor(other)))
        .andExpect(status().is4xxClientError());
  }
}
