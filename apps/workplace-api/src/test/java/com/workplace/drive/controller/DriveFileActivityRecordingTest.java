package com.workplace.drive.controller;

import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.DRIVE_FILE_ACTIVITY;
import static com.workplace.jooq.Tables.DRIVE_SPACE;
import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.doThrow;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.drive.domain.DriveFileAction;
import com.workplace.drive.repository.DriveFileActivityRepository;
import com.workplace.drive.service.DriveFileService;
import com.workplace.drive.service.DriveSpaceService;
import com.workplace.file.service.UploadSource;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.ObjectMapper;

/**
 * 드라이브 「최근」 기록 쓰기 지점(WP-1699) 통합 테스트 — 열기·올리기·새 판이 HTTP 요청 뒤 {@code drive_file_activity} 에 남는지, 남기면
 * 안 되는 경로(썸네일·summary·링크로 받기 업로드)는 안 남는지, 기록 실패가 본 요청을 깨뜨리지 않는지 본다.
 *
 * <p>일부러 {@code @Transactional} 을 달지 않는다 — 기록은 REQUIRES_NEW 로 따로 커밋하므로 테스트 트랜잭션 안의 시드는 보이지 않는다. 시드는
 * 커밋하고 {@link #cleanup} 에서 지운다(공간 삭제가 drive_file → drive_file_activity 로 CASCADE).
 */
class DriveFileActivityRecordingTest extends IntegrationTestBase {
  @Autowired MockMvc mockMvc;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwtTokenProvider;
  @Autowired DriveFileService fileService;
  @Autowired DriveSpaceService spaceService;
  @Autowired ObjectMapper objectMapper;

  /** 기본 테스트 기반의 spy 빈 — 실패 주입용. 테스트마다 초기화된다. */
  @Autowired DriveFileActivityRepository activityRepository;

  private final List<Long> userIds = new ArrayList<>();
  private long owner;
  private long aiUser;
  private long spaceId;
  private long textId;
  private long docId;
  private long videoId;

  @BeforeEach
  void seed() throws Exception {
    TenantContext.set(1L);
    try {
      new TransactionTemplate(txManager)
          .executeWithoutResult(
              st -> {
                owner = withMembership(TestFixtures.createHuman(dsl));
                aiUser = withMembership(TestFixtures.createAgentNoToken(dsl));
                userIds.addAll(List.of(owner, aiUser));
                spaceId =
                    spaceService
                        .createTeamSpace(
                            owner, "최근기록_" + UUID.randomUUID().toString().substring(0, 8))
                        .id();
                dsl.insertInto(com.workplace.jooq.Tables.DRIVE_SPACE_MEMBER)
                    .set(com.workplace.jooq.Tables.DRIVE_SPACE_MEMBER.SPACE_ID, spaceId)
                    .set(com.workplace.jooq.Tables.DRIVE_SPACE_MEMBER.USER_ID, aiUser)
                    .set(com.workplace.jooq.Tables.DRIVE_SPACE_MEMBER.ROLE, "EDITOR")
                    .execute();
              });
      textId = seedFile("메모.md", "text/markdown", "# 본문");
      docId = seedFile("문서.docx", "application/octet-stream", "docx");
      videoId = seedFile("회의.webm", "video/webm", "video");
    } finally {
      TenantContext.clear();
    }
  }

  @AfterEach
  void cleanup() {
    cleanupInTenant(
        1L,
        () -> {
          dsl.deleteFrom(DRIVE_SPACE).where(DRIVE_SPACE.ID.eq(spaceId)).execute();
          dsl.deleteFrom(AUDIT_LOG).where(AUDIT_LOG.USER_ID.in(userIds)).execute();
          dsl.deleteFrom(FILE).where(FILE.UPLOADED_BY.in(userIds)).execute();
          dsl.deleteFrom(USER).where(USER.ID.in(userIds)).execute();
        });
    userIds.clear();
  }

  /** 서비스로 직접 올려 시드한다 — 컨트롤러를 거치지 않으니 기록은 남지 않는다. */
  private long seedFile(String name, String mime, String body) throws Exception {
    return fileService
        .upload(
            owner,
            spaceId,
            null,
            new MockMultipartFile("file", name, mime, body.getBytes(StandardCharsets.UTF_8)))
        .id();
  }

  private String bearer(long userId) {
    return "Bearer " + jwtTokenProvider.generateAccessToken(userId, "user-" + userId, 1L);
  }

  /** 그 사용자의 기록 한 줄 — 없으면 null. last_action 문자열. */
  private String actionOf(long userId, long driveFileId) {
    return callInTenant(
        1L,
        () ->
            dsl.select(DRIVE_FILE_ACTIVITY.LAST_ACTION)
                .from(DRIVE_FILE_ACTIVITY)
                .where(DRIVE_FILE_ACTIVITY.USER_ID.eq(userId))
                .and(DRIVE_FILE_ACTIVITY.DRIVE_FILE_ID.eq(driveFileId))
                .fetchOne(DRIVE_FILE_ACTIVITY.LAST_ACTION));
  }

  private int rowCount(long userId) {
    return callInTenant(
        1L, () -> dsl.fetchCount(DRIVE_FILE_ACTIVITY, DRIVE_FILE_ACTIVITY.USER_ID.eq(userId)));
  }

  private long idOf(String json) throws Exception {
    return objectMapper.readTree(json).get("id").asLong();
  }

  // ── 열기 ────────────────────────────────────────────────────────────────

  @Test
  void content_recordsOpen() throws Exception {
    mockMvc
        .perform(
            get("/api/v1/drive/files/" + textId + "/content")
                .header("Authorization", bearer(owner)))
        .andExpect(status().isOk());
    assertThat(actionOf(owner, textId)).isEqualTo("OPEN");
  }

  @Test
  void download_recordsOpen() throws Exception {
    mockMvc
        .perform(
            get("/api/v1/drive/files/" + textId + "/download")
                .header("Authorization", bearer(owner)))
        .andExpect(status().isOk());
    assertThat(actionOf(owner, textId)).isEqualTo("OPEN");
  }

  @Test
  void text_offsetZero_recordsOpen() throws Exception {
    mockMvc
        .perform(
            get("/api/v1/drive/files/" + textId + "/text").header("Authorization", bearer(owner)))
        .andExpect(status().isOk());
    assertThat(actionOf(owner, textId)).isEqualTo("OPEN");
  }

  @Test
  void text_offsetPositive_doesNotRecord() throws Exception {
    // 긴 파일을 조각으로 읽는 뒤쪽 조각은 쓰기를 만들지 않는다.
    mockMvc
        .perform(
            get("/api/v1/drive/files/" + textId + "/text")
                .param("offset", "2")
                .header("Authorization", bearer(owner)))
        .andExpect(status().isOk());
    assertThat(actionOf(owner, textId)).isNull();
  }

  @Test
  void view_firstPage_recordsOpen() throws Exception {
    // 변환 결과(성공·미지원)와 무관하게 권한을 통과했으면 첫 쪽은 기록한다.
    mockMvc.perform(
        get("/api/v1/drive/files/" + textId + "/view")
            .param("page", "1")
            .header("Authorization", bearer(owner)));
    assertThat(actionOf(owner, textId)).isEqualTo("OPEN");
  }

  @Test
  void view_laterPage_doesNotRecord() throws Exception {
    // 문서를 쪽 단위로 넘겨 볼 때 뒤쪽 쪽은 쓰기를 만들지 않는다.
    mockMvc.perform(
        get("/api/v1/drive/files/" + textId + "/view")
            .param("page", "2")
            .header("Authorization", bearer(owner)));
    assertThat(actionOf(owner, textId)).isNull();
  }

  @Test
  void versionDownload_recordsOpen() throws Exception {
    mockMvc
        .perform(
            get("/api/v1/drive/files/" + textId + "/versions/1/download")
                .header("Authorization", bearer(owner)))
        .andExpect(status().isOk());
    assertThat(actionOf(owner, textId)).isEqualTo("OPEN");
  }

  @Test
  void preview_startTrue_recordsOpen() throws Exception {
    // 응답 코드(202·422 등)는 변환 엔진 상태에 달렸다 — 권한을 통과했으면 기록한다.
    mockMvc
        .perform(
            get("/api/v1/drive/files/" + docId + "/preview")
                .param("start", "true")
                .header("Authorization", bearer(owner)))
        .andReturn();
    assertThat(actionOf(owner, docId)).isEqualTo("OPEN");
  }

  @Test
  void preview_poll_doesNotRecord() throws Exception {
    mockMvc
        .perform(
            get("/api/v1/drive/files/" + docId + "/preview").header("Authorization", bearer(owner)))
        .andReturn();
    assertThat(actionOf(owner, docId)).isNull();
  }

  @Test
  void playbackUrl_recordsOpen() throws Exception {
    mockMvc
        .perform(
            post("/api/v1/drive/files/" + videoId + "/playback-url")
                .header("Authorization", bearer(owner)))
        .andExpect(status().isOk());
    assertThat(actionOf(owner, videoId)).isEqualTo("OPEN");
  }

  @Test
  void content_twiceQuickly_singleRow() throws Exception {
    for (int i = 0; i < 2; i++) {
      mockMvc
          .perform(
              get("/api/v1/drive/files/" + textId + "/content")
                  .header("Authorization", bearer(owner)))
          .andExpect(status().isOk());
    }
    assertThat(rowCount(owner)).isEqualTo(1);
  }

  @Test
  void thumbnail_summary_doNotRecord() throws Exception {
    mockMvc
        .perform(
            get("/api/v1/drive/files/" + textId + "/thumbnail")
                .header("Authorization", bearer(owner)))
        .andReturn();
    mockMvc
        .perform(
            get("/api/v1/drive/files/" + textId + "/summary")
                .header("Authorization", bearer(owner)))
        .andReturn();
    assertThat(rowCount(owner)).isZero();
  }

  @Test
  void content_noPermission_doesNotRecord() throws Exception {
    long outsider = withMembership(TestFixtures.createHuman(dsl));
    userIds.add(outsider);
    mockMvc
        .perform(
            get("/api/v1/drive/files/" + textId + "/content")
                .header("Authorization", bearer(outsider)))
        .andExpect(status().isNotFound());
    assertThat(rowCount(outsider)).isZero();
  }

  @Test
  void aiCaller_recordsForAi() throws Exception {
    // AI 사용자도 같은 principal(user id)로 들어온다 — 기록은 그 AI 의 id 로 남고 사람 행은 없다.
    mockMvc
        .perform(
            get("/api/v1/drive/files/" + textId + "/text").header("Authorization", bearer(aiUser)))
        .andExpect(status().isOk());
    assertThat(actionOf(aiUser, textId)).isEqualTo("OPEN");
    assertThat(rowCount(owner)).isZero();
  }

  // ── 올리기·새 판 ─────────────────────────────────────────────────────────

  private String uploadRaw(String name, String body) throws Exception {
    return mockMvc
        .perform(
            multipart("/api/v1/drive/spaces/" + spaceId + "/files")
                .file(
                    new MockMultipartFile(
                        "file", name, "text/plain", body.getBytes(StandardCharsets.UTF_8)))
                .header("Authorization", bearer(owner)))
        .andExpect(status().isCreated())
        .andReturn()
        .getResponse()
        .getContentAsString();
  }

  @Test
  void upload_recordsUpload() throws Exception {
    long id = idOf(uploadRaw("새파일.txt", "hello"));
    assertThat(actionOf(owner, id)).isEqualTo("UPLOAD");
  }

  @Test
  void upload_sameName_recordsNewVersion() throws Exception {
    long id = idOf(uploadRaw("메모.md", "다시"));
    assertThat(id).isEqualTo(textId);
    assertThat(actionOf(owner, id)).isEqualTo("NEW_VERSION");
  }

  @Test
  void createText_recordsUpload() throws Exception {
    String json =
        mockMvc
            .perform(
                post("/api/v1/drive/spaces/" + spaceId + "/files/text")
                    .header("Authorization", bearer(owner))
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("{\"name\":\"글.md\",\"content\":\"내용\"}"))
            .andExpect(status().isCreated())
            .andReturn()
            .getResponse()
            .getContentAsString();
    assertThat(actionOf(owner, idOf(json))).isEqualTo("UPLOAD");
  }

  @Test
  void updateText_recordsNewVersion() throws Exception {
    mockMvc
        .perform(
            post("/api/v1/drive/files/" + textId + "/text")
                .header("Authorization", bearer(owner))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"content\":\"고침\"}"))
        .andExpect(status().isOk());
    assertThat(actionOf(owner, textId)).isEqualTo("NEW_VERSION");
  }

  @Test
  void rollback_recordsNewVersion() throws Exception {
    callInTenant(
        1L,
        () -> {
          try {
            return seedFile("메모.md", "text/markdown", "2판");
          } catch (Exception e) {
            throw new IllegalStateException(e);
          }
        });
    mockMvc
        .perform(
            post("/api/v1/drive/files/" + textId + "/versions/1/rollback")
                .header("Authorization", bearer(owner)))
        .andExpect(status().isOk());
    assertThat(actionOf(owner, textId)).isEqualTo("NEW_VERSION");
  }

  @Test
  void copy_recordsUploadForNewFile() throws Exception {
    // 같은 폴더(루트)로 복사하면 이름이 겹쳐 409 — 새 폴더로 복사한다.
    String folder =
        mockMvc
            .perform(
                post("/api/v1/drive/spaces/" + spaceId + "/folders")
                    .header("Authorization", bearer(owner))
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("{\"name\":\"복사처\"}"))
            .andExpect(status().isCreated())
            .andReturn()
            .getResponse()
            .getContentAsString();
    String json =
        mockMvc
            .perform(
                post("/api/v1/drive/files/" + textId + "/copy")
                    .header("Authorization", bearer(owner))
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("{\"targetFolderId\":" + idOf(folder) + "}"))
            .andExpect(status().isCreated())
            .andReturn()
            .getResponse()
            .getContentAsString();
    long copyId = idOf(json);
    assertThat(copyId).isNotEqualTo(textId);
    assertThat(actionOf(owner, copyId)).isEqualTo("UPLOAD");
    assertThat(actionOf(owner, textId)).isNull();
  }

  @Test
  void uploadSessionComplete_recordsUpload() throws Exception {
    byte[] body = "나눠 올림".getBytes(StandardCharsets.UTF_8);
    String started =
        mockMvc
            .perform(
                post("/api/v1/drive/spaces/" + spaceId + "/upload-sessions")
                    .header("Authorization", bearer(owner))
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(
                        "{\"fileName\":\"조각.txt\",\"contentType\":\"text/plain\",\"size\":"
                            + body.length
                            + "}"))
            .andExpect(status().isCreated())
            .andReturn()
            .getResponse()
            .getContentAsString();
    String sid = objectMapper.readTree(started).get("id").asString();
    mockMvc
        .perform(
            put("/api/v1/drive/upload-sessions/" + sid + "/chunks")
                .param("offset", "0")
                .header("Authorization", bearer(owner))
                .contentType(MediaType.APPLICATION_OCTET_STREAM)
                .content(body))
        .andExpect(status().isOk());
    String done =
        mockMvc
            .perform(
                post("/api/v1/drive/upload-sessions/" + sid + "/complete")
                    .header("Authorization", bearer(owner)))
            .andExpect(status().isCreated())
            .andReturn()
            .getResponse()
            .getContentAsString();
    assertThat(actionOf(owner, idOf(done))).isEqualTo("UPLOAD");
  }

  @Test
  void uploadNew_recordsUpload() throws Exception {
    // 메일 첨부 저장이 부르는 서비스 메서드 — 컨트롤러가 아니라 서비스가 기록한다(mail→drive 의존을 늘리지 않으려고).
    long id =
        callInTenant(
            1L,
            () -> {
              try {
                return fileService
                    .uploadNew(
                        owner,
                        spaceId,
                        null,
                        UploadSource.ofBytes(
                            "첨부.txt", "text/plain", "메일".getBytes(StandardCharsets.UTF_8)))
                    .id();
              } catch (Exception e) {
                throw new IllegalStateException(e);
              }
            });
    assertThat(actionOf(owner, id)).isEqualTo("UPLOAD");
  }

  @Test
  void transferLinkUpload_doesNotRecord() throws Exception {
    String issued =
        mockMvc
            .perform(
                post("/api/v1/drive/spaces/" + spaceId + "/upload-link")
                    .header("Authorization", bearer(owner))
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("{\"name\":\"외부.md\"}"))
            .andExpect(status().isCreated())
            .andReturn()
            .getResponse()
            .getContentAsString();
    String url = objectMapper.readTree(issued).get("url").asString();
    String path = url.substring(url.indexOf("/api/v1/public"));
    mockMvc
        .perform(put(path).content("외부에서".getBytes(StandardCharsets.UTF_8)))
        .andExpect(status().isCreated());
    assertThat(rowCount(owner)).isZero();
  }

  // ── 실패 격리 ────────────────────────────────────────────────────────────

  @Test
  void recordingFailure_doesNotBreakDownload() throws Exception {
    doThrow(new RuntimeException("기록 실패 주입"))
        .when(activityRepository)
        .upsert(anyLong(), anyLong(), any(DriveFileAction.class));
    String body =
        mockMvc
            .perform(
                get("/api/v1/drive/files/" + textId + "/content")
                    .header("Authorization", bearer(owner)))
            .andExpect(status().isOk())
            .andReturn()
            .getResponse()
            .getContentAsString(StandardCharsets.UTF_8);
    assertThat(body).isEqualTo("# 본문");
    assertThat(rowCount(owner)).isZero();
  }

  @Test
  void recordingFailure_doesNotBreakUpload() throws Exception {
    doThrow(new RuntimeException("기록 실패 주입"))
        .when(activityRepository)
        .upsert(anyLong(), anyLong(), any(DriveFileAction.class));
    long id = idOf(uploadRaw("실패해도.txt", "ok"));
    assertThat(actionOf(owner, id)).isNull();
  }
}
