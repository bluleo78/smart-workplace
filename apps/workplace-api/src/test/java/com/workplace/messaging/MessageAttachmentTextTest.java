package com.workplace.messaging;

import static com.workplace.jooq.Tables.FILE_EXTRACTION;
import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.messaging.dto.CreateMessageRequest;
import com.workplace.messaging.exception.ChannelNotMemberException;
import com.workplace.messaging.exception.InvalidMessageAttachmentException;
import com.workplace.messaging.repository.ChannelRepository;
import com.workplace.messaging.service.ChannelService;
import com.workplace.messaging.service.MessageAttachmentService;
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
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/**
 * 팀 채팅 메시지 첨부 추출 텍스트(WP-358) — 전송(바인딩) 시 TEXT_ONLY 추출 행 생성, /text 구간 읽기와 권한·소속 가드. 클래스 트랜잭션 롤백으로 공유
 * DB 를 오염시키지 않는다(AFTER_COMMIT 워커 디스패치도 롤백이라 발화하지 않음).
 */
@Transactional
class MessageAttachmentTextTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwtTokenProvider;
  @Autowired ChannelRepository channelRepo;
  @Autowired ChannelService channelService;
  @Autowired MessageService messageService;
  @Autowired MessageAttachmentService attachmentService;
  @Autowired MessageAttachmentStorage storage;

  private long userId;
  private long outsiderId;
  private long channelId;

  @BeforeEach
  void setUp() {
    TenantContext.set(1L); // FilePathBuilder 가 테넌트 컨텍스트로 경로를 만든다
    userId = seedUser();
    outsiderId = seedUser();
    channelId = channelRepo.insertPublic("text-" + UUID.randomUUID(), userId);
    channelService.join(userId, channelId);
  }

  @AfterEach
  void tearDown() {
    TenantContext.clear();
  }

  private long seedUser() {
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").substring(0, 8);
    long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "msg_text_" + suffix)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, "MsgText" + suffix)
            .set(USER.EMAIL, "msgtext_" + suffix + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    // 테넌트 클레임이 든 토큰으로 MockMvc 를 통과하도록 테넌트#1 ACTIVE 멤버십을 둔다.
    dsl.insertInto(MEMBERSHIP)
        .set(MEMBERSHIP.USER_ID, id)
        .set(MEMBERSHIP.TENANT_ID, 1L)
        .set(MEMBERSHIP.STATUS, "ACTIVE")
        .execute();
    return id;
  }

  /** 첨부 1건 메시지 전송 → [messageId, fileId]. */
  private long[] send(MockMultipartFile mf) throws Exception {
    Long fileId = storage.storeTemporary(mf, userId);
    var res =
        messageService.create(
            userId, channelId, new CreateMessageRequest("첨부", null, List.of(fileId)));
    return new long[] {res.id(), fileId};
  }

  private long[] sendPdf() throws Exception {
    return send(new MockMultipartFile("files", "a.pdf", "application/pdf", "%PDF".getBytes()));
  }

  private String statusOf(long fileId) {
    return dsl.select(FILE_EXTRACTION.STATUS)
        .from(FILE_EXTRACTION)
        .where(FILE_EXTRACTION.FILE_ID.eq(fileId))
        .fetchOne(FILE_EXTRACTION.STATUS);
  }

  private void markDone(long fileId, String text) {
    dsl.update(FILE_EXTRACTION)
        .set(FILE_EXTRACTION.STATUS, "DONE")
        .set(FILE_EXTRACTION.EXTRACTED_TEXT, text)
        .set(FILE_EXTRACTION.CHAR_COUNT, text.codePointCount(0, text.length()))
        .where(FILE_EXTRACTION.FILE_ID.eq(fileId))
        .execute();
  }

  @Test
  void 선업로드만_하면_추출하지_않고_전송하면_PENDING() throws Exception {
    Long tempId =
        storage.storeTemporary(
            new MockMultipartFile("files", "b.pdf", "application/pdf", "x".getBytes()), userId);
    assertThat(statusOf(tempId)).isNull();

    long[] ids = sendPdf();
    assertThat(statusOf(ids[1])).isEqualTo("PENDING");
    assertThat(attachmentService.readText(userId, channelId, ids[0], ids[1], 0, 10).status())
        .isEqualTo("PENDING");
  }

  @Test
  void octet_stream_으로_올린_hwp_도_확장자로_보정해_추출_대상() throws Exception {
    var mf = new MockMultipartFile("files", "보고서.HWP", "application/octet-stream", new byte[] {1});
    var uploaded = attachmentService.upload(userId, channelId, List.of(mf)).get(0);
    assertThat(uploaded.mimeType()).isEqualTo("application/x-hwp");
    messageService.create(
        userId, channelId, new CreateMessageRequest(null, null, List.of(uploaded.fileId())));
    assertThat(statusOf(uploaded.fileId())).isEqualTo("PENDING");
  }

  @Test
  void 추출이_끝나면_구간_읽기() throws Exception {
    long[] ids = sendPdf();
    markDone(ids[1], "가나다라마");
    var s = attachmentService.readText(userId, channelId, ids[0], ids[1], 1, 2);
    assertThat(s.status()).isEqualTo("READY");
    assertThat(s.text()).isEqualTo("나다");
    assertThat(s.nextOffset()).isEqualTo(3);
  }

  @Test
  void 추출_행이_없는_기존_첨부는_NONE() throws Exception {
    long[] ids = sendPdf();
    // 배포 전 전송된 첨부와 같은 상태 — 추출 행이 없다.
    dsl.deleteFrom(FILE_EXTRACTION).where(FILE_EXTRACTION.FILE_ID.eq(ids[1])).execute();
    assertThat(attachmentService.readText(userId, channelId, ids[0], ids[1], 0, 10).status())
        .isEqualTo("NONE");
  }

  @Test
  void 채널_비멤버는_403_다른_메시지의_파일은_400() throws Exception {
    long[] ids = sendPdf();
    assertThatThrownBy(
            () -> attachmentService.readText(outsiderId, channelId, ids[0], ids[1], 0, 10))
        .isInstanceOf(ChannelNotMemberException.class);
    long[] other = sendPdf();
    assertThatThrownBy(() -> attachmentService.readText(userId, channelId, ids[0], other[1], 0, 10))
        .isInstanceOf(InvalidMessageAttachmentException.class);
  }

  @Test
  void 엔드포인트는_ExtractedTextSlice_를_돌려주고_비멤버는_403() throws Exception {
    long[] ids = sendPdf();
    markDone(ids[1], "hello world");
    String url =
        "/api/v1/messaging/channels/"
            + channelId
            + "/messages/"
            + ids[0]
            + "/attachments/"
            + ids[1]
            + "/text";
    mvc.perform(get(url).param("limit", "5").header("Authorization", "Bearer " + tokenFor(userId)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.status").value("READY"))
        .andExpect(jsonPath("$.text").value("hello"))
        .andExpect(jsonPath("$.totalChars").value(11))
        .andExpect(jsonPath("$.nextOffset").value(5));
    mvc.perform(get(url).header("Authorization", "Bearer " + tokenFor(outsiderId)))
        .andExpect(status().isForbidden());
  }

  private String tokenFor(long uid) {
    return jwtTokenProvider.generateAccessToken(uid, "user-" + uid, 1L);
  }
}
