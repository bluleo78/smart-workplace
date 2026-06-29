package com.workplace.messaging;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.global.tenant.TenantContext;
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
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.transaction.annotation.Transactional;

/** MessageAttachmentService 통합 테스트 — 업로드 게이트 + 바인딩 검증 + 상대경로 단언. */
@Transactional
class MessageAttachmentServiceTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired ChannelRepository channelRepo;
  @Autowired ChannelService channelService;
  @Autowired MessageService messageService;
  @Autowired MessageAttachmentStorage storage;
  @Autowired MessageAttachmentRepository attachmentRepo;
  @Autowired MessageAttachmentService attachmentService;

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

  /**
   * upload_storagePath_isRelative: STORAGE_PATH 가 절대경로가 아닌 상대경로(tenant-1/messaging/...)로 저장됨을 확인.
   */
  @Test
  void upload_storagePath_isRelative() throws Exception {
    long userId = seedUser();
    long channelId = channelRepo.insertPublic("test-rel-path", userId);
    channelService.join(userId, channelId);

    // 파일 선업로드 후 DB STORAGE_PATH 직접 조회
    var mf = new MockMultipartFile("files", "rel.txt", "text/plain", "data".getBytes());
    var uploaded = attachmentService.upload(userId, channelId, List.of(mf));
    Long fileId = uploaded.get(0).fileId();

    String storagePath =
        dsl.select(com.workplace.jooq.tables.File.FILE.STORAGE_PATH)
            .from(com.workplace.jooq.tables.File.FILE)
            .where(com.workplace.jooq.tables.File.FILE.ID.eq(fileId))
            .fetchOne(0, String.class);

    // tenant-1/messaging/... 형태의 상대경로여야 한다
    assertThat(storagePath).startsWith("tenant-1/messaging/");
    // 절대경로(플랫폼 중립 단언)가 아님을 확인
    assertThat(Path.of(storagePath).isAbsolute()).isFalse();
  }

  /**
   * upload_thenBind_downloadRoundTrip: 업로드→바인딩→다운로드 시 반환 경로가 절대경로이고 파일 바이트가 일치한다.
   *
   * <p>비-@Transactional 이 아닌 @Transactional 컨텍스트 안에서 storeTemporary 를 직접 호출해 round-trip 을 검증한다.
   * download() 는 서비스 내부에서 fileStore.resolve() 로 절대경로를 복원하므로 FileSystemResource 에서 읽을 수 있어야 한다.
   */
  @Test
  void upload_thenBind_downloadRoundTrip() throws Exception {
    long userId = seedUser();
    long channelId = channelRepo.insertPublic("test-roundtrip", userId);
    channelService.join(userId, channelId);

    byte[] content = "round-trip-messaging".getBytes();
    var mf = new MockMultipartFile("files", "rt.txt", "text/plain", content);

    // 직접 storeTemporary 후 bind — 트랜잭션 내에서 일관된 테넌트 컨텍스트 사용
    Long fileId = storage.storeTemporary(mf, userId);
    var msg = messageService.create(userId, channelId, new CreateMessageRequest("body"));
    attachmentService.bindToMessage(userId, msg.id(), List.of(fileId));

    // download() 가 절대경로를 반환하고 실제 파일 바이트가 일치해야 한다
    var row = attachmentService.download(userId, channelId, msg.id(), fileId);

    // 절대경로 단언(플랫폼 중립)
    assertThat(Path.of(row.path()).isAbsolute()).isTrue();
    // 바이트 라운드트립 확인
    byte[] actual = Files.readAllBytes(Path.of(row.path()));
    assertThat(actual).isEqualTo(content);
  }
}
