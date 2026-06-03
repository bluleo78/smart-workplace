package com.workplace.messaging;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.messaging.dto.CreateMessageRequest;
import com.workplace.messaging.exception.InvalidMessageAttachmentException;
import com.workplace.messaging.exception.MessageAttachmentTooLargeException;
import com.workplace.messaging.repository.ChannelRepository;
import com.workplace.messaging.repository.MessageAttachmentRepository;
import com.workplace.messaging.service.ChannelService;
import com.workplace.messaging.service.MessageAttachmentService;
import com.workplace.messaging.service.MessageAttachmentStorage;
import com.workplace.messaging.service.MessageService;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockMultipartFile;

/** MessageAttachmentService 통합 테스트 — 업로드 게이트 + 바인딩 검증. */
class MessageAttachmentServiceTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired ChannelRepository channelRepo;
  @Autowired ChannelService channelService;
  @Autowired MessageService messageService;
  @Autowired MessageAttachmentStorage storage;
  @Autowired MessageAttachmentRepository attachmentRepo;
  @Autowired MessageAttachmentService attachmentService;

  /** 테스트 격리용 유니크 유저 INSERT. */
  private long seedUser() {
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "attch_svc_" + suffix)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "AttchSvc" + suffix)
        .set(USER.EMAIL, "attchsvc_" + suffix + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  /**
   * bindToMessage_rejectsForeignFile: 유저A가 업로드한 파일을 유저B가 바인딩하려 하면 InvalidMessageAttachmentException
   * 발생.
   */
  @Test
  void bindToMessage_rejectsForeignFile() throws Exception {
    // 유저A: 파일 업로드만 함 (채널 멤버십 불필요 — storeTemporary 직접 호출)
    long userA = seedUser();
    var mf = new MockMultipartFile("files", "a.txt", "text/plain", "hello".getBytes());
    Long fileId = storage.storeTemporary(mf, userA);

    // 유저B: 채널 생성 + 가입 + 메시지 작성
    long userB = seedUser();
    long channelId = channelRepo.insertPublic("test-foreign", userB);
    channelService.join(userB, channelId);
    var msg = messageService.create(userB, channelId, new CreateMessageRequest("hi"));

    // 유저B가 유저A 소유 파일을 바인딩 시도 → 거부
    assertThatThrownBy(() -> attachmentService.bindToMessage(userB, msg.id(), List.of(fileId)))
        .isInstanceOf(InvalidMessageAttachmentException.class);
  }

  /** upload_rejectsOversizeFile: 26_214_401 바이트 파일 업로드 시 MessageAttachmentTooLargeException 발생. */
  @Test
  void upload_rejectsOversizeFile() {
    long userId = seedUser();
    long channelId = channelRepo.insertPublic("test-oversize", userId);
    channelService.join(userId, channelId);

    // 기본 한도(26_214_400)를 1바이트 초과
    byte[] bigBytes = new byte[26_214_401];
    var bigFile = new MockMultipartFile("files", "big.bin", "application/octet-stream", bigBytes);

    assertThatThrownBy(() -> attachmentService.upload(userId, channelId, List.of(bigFile)))
        .isInstanceOf(MessageAttachmentTooLargeException.class);
  }

  /**
   * upload_thenBind_succeeds: 정상 업로드 후 본인 메시지에 바인딩하면 예외 없이 완료되고 파일이 영구 승격(expires_at = null, bound
   * = true)된다.
   */
  @Test
  void upload_thenBind_succeeds() throws Exception {
    long userId = seedUser();
    long channelId = channelRepo.insertPublic("test-bind-ok", userId);
    channelService.join(userId, channelId);

    // 파일 선업로드
    var mf = new MockMultipartFile("files", "ok.txt", "text/plain", "content".getBytes());
    var uploaded = attachmentService.upload(userId, channelId, List.of(mf));
    assertThat(uploaded).hasSize(1);
    Long fileId = uploaded.get(0).fileId();

    // 메시지 작성 후 바인딩
    var msg = messageService.create(userId, channelId, new CreateMessageRequest("with attachment"));
    attachmentService.bindToMessage(userId, msg.id(), List.of(fileId));

    // 바인딩 후 영구 승격 확인: bound=true, expiresAt=null
    var bindable = attachmentRepo.findBindable(fileId);
    assertThat(bindable).isPresent();
    assertThat(bindable.get().bound()).isTrue();
    assertThat(bindable.get().expiresAt()).isNull();
  }
}
