package com.workplace.chat;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.chat.dto.CreateChatMessageRequest;
import com.workplace.chat.service.ChatFixtures;
import com.workplace.chat.service.ChatMessageService;
import com.workplace.chat.service.ChatThreadService;
import com.workplace.drive.dto.BacklinkResponse;
import com.workplace.drive.service.DriveFileService;
import com.workplace.drive.service.DriveLinkService;
import com.workplace.drive.service.DriveSpaceService;
import com.workplace.global.outbound.AiAgentEventClient;
import com.workplace.global.realtime.SseRegistry;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/**
 * #358 Task7: 채팅 메시지에 드라이브 파일 링크 후, 파일 백링크에 CHAT_MESSAGE 소스가 노출되는지 검증.
 *
 * <p>비-Tx 통합 테스트 — 서비스가 자체 트랜잭션을 커밋해야 backlinks 조회 가능. fixture 데이터는 @AfterEach 에서 정리.
 */
class ChatDriveBacklinkIntegrationTest extends IntegrationTestBase {

  @Autowired ChatMessageService chatMessageService;
  @Autowired ChatThreadService threadService;
  @Autowired ChatFixtures fx;
  @Autowired DriveSpaceService spaceService;
  @Autowired DriveFileService driveFileService;
  @Autowired DriveLinkService driveLinkService;
  @Autowired DSLContext dsl;

  // SSE / ai-agent 외부 호출 차단
  @MockitoBean SseRegistry sseRegistry;
  @MockitoBean AiAgentEventClient aiAgentEventClient;

  /** 드라이브 RLS 는 TenantContext 가 필요하다. */
  @BeforeEach
  void setTenant() {
    TenantContext.set(1L);
  }

  /** ThreadLocal 누수 방지. */
  @AfterEach
  void cleanup() {
    // drive_file_ref — CHAT_MESSAGE 백링크 정리
    dsl.execute("DELETE FROM drive_file_ref WHERE source_type = 'CHAT_MESSAGE'");
    // 채팅 첨부 정리
    dsl.execute(
        "DELETE FROM chat_message_attachment cma USING file f"
            + " WHERE cma.file_id = f.id AND f.category = 'ATTACHMENT'");
    dsl.execute("DELETE FROM file WHERE category = 'ATTACHMENT'");
    // 드라이브 파일/공간 정리.
    // FK 순서: drive_file_version → drive_file → file → drive_space.
    dsl.execute(
        "DELETE FROM drive_file_version WHERE drive_file_id IN ("
            + " SELECT df.id FROM drive_file df"
            + " JOIN drive_space ds ON ds.id = df.space_id"
            + " WHERE ds.name LIKE 'test-backlink-%')");
    // drive_file 삭제 후 file 삭제 (file_uploaded_by FK 해제)
    dsl.execute(
        "WITH file_ids AS ("
            + "  SELECT df.file_id FROM drive_file df"
            + "  JOIN drive_space ds ON ds.id = df.space_id"
            + "  WHERE ds.name LIKE 'test-backlink-%'"
            + "), del_df AS ("
            + "  DELETE FROM drive_file WHERE space_id IN ("
            + "    SELECT id FROM drive_space WHERE name LIKE 'test-backlink-%'"
            + "  )"
            + ")"
            + " DELETE FROM file WHERE id IN (SELECT file_id FROM file_ids)");
    dsl.execute("DELETE FROM drive_space WHERE name LIKE 'test-backlink-%'");
    // audit_log 는 user 를 참조하는 FK 가 있으므로 user 삭제 전에 먼저 정리.
    dsl.execute("DELETE FROM audit_log WHERE resource = 'drive'");
    // 나머지 (project/issue/user) 는 ChatFixtures 가 처리
    fx.cleanupAll();
    TenantContext.clear();
  }

  @Test
  void 채팅에_링크한_드라이브_파일의_백링크에_이슈채팅이_노출된다() throws Exception {
    // given: 채팅 픽스처 — 프로젝트/이슈/사용자 생성.
    ChatFixtures.Setup s = fx.setup();
    long callerId = s.reporterId();

    // 드라이브 스페이스 생성 (reporter 가 OWNER → ≥VIEWER 자동 충족).
    var space = spaceService.createTeamSpace(callerId, "test-backlink-" + s.projectKey());

    // 드라이브 파일 업로드.
    MockMultipartFile mf =
        new MockMultipartFile("file", "doc.txt", "text/plain", "hello".getBytes());
    var driveFile = driveFileService.upload(callerId, space.id(), null, mf);
    long driveFileId = driveFile.id();

    // 채팅 스레드 생성 (이슈 컨텍스트).
    var thread = threadService.getOrCreate(callerId, s.projectKey(), s.issueNumber());
    long threadId = thread.threadId();

    // when: driveFileIds 동봉 메시지 전송 → drive_file_ref(CHAT_MESSAGE) 생성.
    chatMessageService.create(
        callerId,
        threadId,
        new CreateChatMessageRequest("파일 공유합니다", List.of(), List.of(driveFileId)));

    // then: 파일 백링크 조회 → CHAT_MESSAGE 소스가 포함되어야 한다.
    List<BacklinkResponse> backlinks = driveLinkService.backlinks(callerId, driveFileId);

    assertThat(backlinks).isNotEmpty();

    BacklinkResponse chatBacklink =
        backlinks.stream()
            .filter(b -> "CHAT_MESSAGE".equals(b.sourceType()))
            .findFirst()
            .orElseThrow(() -> new AssertionError("CHAT_MESSAGE 백링크가 없습니다"));

    // accessible=true 이므로 backlinks() 가 이미 필터링 — 존재 자체가 accessible=true 증명.
    // deepLink 는 "/projects/{KEY}/issues/{NUMBER}" 형식이어야 한다.
    assertThat(chatBacklink.deepLink())
        .isEqualTo("/projects/" + s.projectKey() + "/issues/" + s.issueNumber());
  }
}
