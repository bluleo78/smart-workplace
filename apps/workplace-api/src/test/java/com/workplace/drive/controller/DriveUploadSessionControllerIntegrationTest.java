package com.workplace.drive.controller;

import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.DRIVE_SPACE;
import static com.workplace.jooq.Tables.DRIVE_SPACE_MEMBER;
import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.TENANT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.drive.repository.DriveUploadSessionRepository;
import com.workplace.drive.service.DriveFileService;
import com.workplace.drive.service.DriveQuotaService;
import com.workplace.drive.service.DriveSpaceService;
import com.workplace.drive.service.DriveUploadSessionService;
import com.workplace.file.service.FileUploadService;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.io.InputStream;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 드라이브 나눠 올리기(WP-1520) 전 구간(HTTP) 통합 테스트 — 시작 → 조각 PUT → 상태 조회 → 완료 / 취소, 사전 검사(범주 한도·용량), 위치 불일치
 * 409, 남의 세션 404, 만료 정리.
 *
 * <p>일부러 {@code @Transactional} 을 달지 않는다 — 조각 PUT 은 본문을 받는 동안 트랜잭션을 쥐지 않고 짧은 트랜잭션 여러 개로 나뉘는데, 테스트
 * 트랜잭션이 감싸면 그 경계(행 잠금·커밋 뒤 임시 파일 삭제)를 볼 수 없다. 시드는 커밋하고 {@link #cleanup} 에서 지운다. 조각은 서버 조각 크기(8MB)보다
 * 훨씬 작게 보낸다 — 서버는 offset 만 맞으면 어떤 길이의 조각이든 받는다.
 */
class DriveUploadSessionControllerIntegrationTest extends IntegrationTestBase {
  @Autowired MockMvc mockMvc;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwtTokenProvider;
  @Autowired DriveSpaceService spaceService;
  @Autowired DriveFileService fileService;
  @Autowired DriveQuotaService quotaService;
  @Autowired DriveUploadSessionService uploadSessions;
  @Autowired ObjectMapper objectMapper;
  @Autowired DriveUploadSessionRepository sessionRepository;

  private static final byte[] CONTENT = "나눠 올리기 본문 — 세 조각으로 보낸다".getBytes(StandardCharsets.UTF_8);

  private final List<Long> userIds = new ArrayList<>();
  private long owner;
  private long viewer;
  private long outsider;
  private long spaceId;
  private Long originalQuota;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    try {
      new TransactionTemplate(txManager)
          .executeWithoutResult(
              st -> {
                owner = withMembership(TestFixtures.createHuman(dsl));
                viewer = withMembership(TestFixtures.createHuman(dsl));
                outsider = withMembership(TestFixtures.createHuman(dsl));
                userIds.addAll(List.of(owner, viewer, outsider));
                spaceId =
                    spaceService
                        .createTeamSpace(
                            owner, "나눠올리기_" + UUID.randomUUID().toString().substring(0, 8))
                        .id();
                dsl.insertInto(DRIVE_SPACE_MEMBER)
                    .set(DRIVE_SPACE_MEMBER.SPACE_ID, spaceId)
                    .set(DRIVE_SPACE_MEMBER.USER_ID, viewer)
                    .set(DRIVE_SPACE_MEMBER.ROLE, "VIEWER")
                    .execute();
              });
    } finally {
      TenantContext.clear();
    }
  }

  @AfterEach
  void cleanup() {
    cleanupInTenant(
        1L,
        () -> {
          if (originalQuota != null) {
            dsl.update(TENANT)
                .set(TENANT.QUOTA_BYTES, originalQuota)
                .where(TENANT.ID.eq(1L))
                .execute();
            originalQuota = null;
          }
          // 세션 행은 사용자 삭제의 FK CASCADE 로, 파일은 공간 삭제의 CASCADE 로 함께 지워진다.
          dsl.deleteFrom(DRIVE_SPACE).where(DRIVE_SPACE.ID.eq(spaceId)).execute();
          dsl.deleteFrom(AUDIT_LOG).where(AUDIT_LOG.USER_ID.in(userIds)).execute();
          dsl.deleteFrom(FILE).where(FILE.UPLOADED_BY.in(userIds)).execute();
          dsl.deleteFrom(USER).where(USER.ID.in(userIds)).execute();
        });
    userIds.clear();
  }

  private String bearer(long userId) {
    return "Bearer " + jwtTokenProvider.generateAccessToken(userId, "user-" + userId, 1L);
  }

  private ResultActions startRaw(long caller, String fileName, String contentType, long size)
      throws Exception {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("fileName", fileName);
    body.put("contentType", contentType);
    body.put("size", size);
    return mockMvc.perform(
        post("/api/v1/drive/spaces/" + spaceId + "/upload-sessions")
            .header("Authorization", bearer(caller))
            .contentType(MediaType.APPLICATION_JSON)
            .content(objectMapper.writeValueAsString(body)));
  }

  /** 세션을 시작하고 id 를 돌려준다. */
  private UUID start(long caller, long size) throws Exception {
    String json =
        startRaw(caller, "큰 파일.txt", "text/plain", size)
            .andExpect(status().isCreated())
            .andReturn()
            .getResponse()
            .getContentAsString();
    return UUID.fromString(objectMapper.readTree(json).get("id").asText());
  }

  private ResultActions putChunk(long caller, UUID id, long offset, byte[] bytes) throws Exception {
    return mockMvc.perform(
        put("/api/v1/drive/upload-sessions/" + id + "/chunks")
            .param("offset", String.valueOf(offset))
            .header("Authorization", bearer(caller))
            .contentType(MediaType.APPLICATION_OCTET_STREAM)
            .content(bytes));
  }

  private static byte[] slice(int from, int to) {
    return Arrays.copyOfRange(CONTENT, from, to);
  }

  /** 세션 행 수(RLS 컨텍스트에서). */
  private int sessionRows(UUID id) {
    return callInTenant(
        1L,
        () ->
            dsl.fetchCount(DSL.table("drive_upload_session"), DSL.field("id", UUID.class).eq(id)));
  }

  @Test
  void start_returnsContract() throws Exception {
    startRaw(owner, "큰 파일.txt", "text/plain", CONTENT.length)
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.id").isString())
        .andExpect(jsonPath("$.chunkSize").value(8 * 1024 * 1024))
        .andExpect(jsonPath("$.receivedBytes").value(0))
        .andExpect(jsonPath("$.size").value(CONTENT.length))
        .andExpect(jsonPath("$.expiresAt").isNotEmpty());
  }

  /** 세 조각으로 보내고 완료하면 드라이브 파일이 생기고 내용이 같다. 세션 행·임시 파일은 사라진다. */
  @Test
  void chunks_thenComplete_createsFileWithSameContent() throws Exception {
    UUID id = start(owner, CONTENT.length);
    int a = 7;
    int b = 20;
    putChunk(owner, id, 0, slice(0, a))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.receivedBytes").value(a));
    putChunk(owner, id, a, slice(a, b))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.receivedBytes").value(b));
    putChunk(owner, id, b, slice(b, CONTENT.length))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.receivedBytes").value(CONTENT.length));
    assertThat(Files.exists(uploadSessions.partPath(1L, id))).isTrue();

    String json =
        mockMvc
            .perform(
                post("/api/v1/drive/upload-sessions/" + id + "/complete")
                    .header("Authorization", bearer(owner)))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.name").value("큰 파일.txt"))
            .andExpect(jsonPath("$.sizeBytes").value(CONTENT.length))
            .andReturn()
            .getResponse()
            .getContentAsString();
    long driveFileId = objectMapper.readTree(json).get("id").asLong();

    byte[] stored =
        callInTenant(
            1L,
            () -> {
              try (InputStream in =
                  fileService.download(owner, driveFileId).resource().getInputStream()) {
                return in.readAllBytes();
              } catch (Exception e) {
                throw new IllegalStateException(e);
              }
            });
    assertThat(stored).isEqualTo(CONTENT);
    assertThat(sessionRows(id)).isZero();
    assertThat(Files.exists(uploadSessions.partPath(1L, id))).isFalse();
  }

  /** 중간에 끊긴 뒤 GET 으로 받은 바이트를 확인하고 그 위치부터 이어 올린다. */
  @Test
  void resume_viaStatus_thenContinue() throws Exception {
    UUID id = start(owner, CONTENT.length);
    putChunk(owner, id, 0, slice(0, 10)).andExpect(status().isOk());

    String json =
        mockMvc
            .perform(
                get("/api/v1/drive/upload-sessions/" + id).header("Authorization", bearer(owner)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.id").value(id.toString()))
            .andExpect(jsonPath("$.size").value(CONTENT.length))
            .andReturn()
            .getResponse()
            .getContentAsString();
    JsonNode state = objectMapper.readTree(json);
    int received = state.get("receivedBytes").asInt();
    assertThat(received).isEqualTo(10);

    putChunk(owner, id, received, slice(received, CONTENT.length))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.receivedBytes").value(CONTENT.length));
    mockMvc
        .perform(
            post("/api/v1/drive/upload-sessions/" + id + "/complete")
                .header("Authorization", bearer(owner)))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.sizeBytes").value(CONTENT.length));
  }

  /** offset 이 받은 바이트와 다르면 409 + errors.code·errors.receivedBytes(문자열 숫자) — 건너뛴 조각도, 다시 보낸 조각도. */
  @Test
  void outOfOrderChunk_isConflict_withReceivedBytes() throws Exception {
    UUID id = start(owner, CONTENT.length);
    putChunk(owner, id, 5, slice(5, 10))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.errors.receivedBytes").value("0"))
        .andExpect(jsonPath("$.errors.code").value("UPLOAD_OFFSET_MISMATCH"))
        .andExpect(jsonPath("$.status").value(409));

    putChunk(owner, id, 0, slice(0, 5)).andExpect(status().isOk());
    // 응답을 놓쳐 같은 조각을 다시 보냄 — 이어 쓰지 않고 지금 위치를 알려 준다.
    putChunk(owner, id, 0, slice(0, 5))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.errors.receivedBytes").value("5"));
  }

  /** 조각이 전체 크기를 넘으면 400, 빈 조각도 400 — 받은 바이트는 그대로다. */
  @Test
  void chunkBeyondSize_orEmpty_isBadRequest() throws Exception {
    UUID id = start(owner, 10);
    putChunk(owner, id, 0, slice(0, 11))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.code").value("UPLOAD_INVALID_CHUNK"));
    putChunk(owner, id, 0, new byte[0]).andExpect(status().isBadRequest());
    mockMvc
        .perform(get("/api/v1/drive/upload-sessions/" + id).header("Authorization", bearer(owner)))
        .andExpect(jsonPath("$.receivedBytes").value(0));
  }

  /** 조각이 조각 크기의 두 배(16MB)를 넘으면 413. */
  @Test
  void oversizedChunk_isPayloadTooLarge() throws Exception {
    long size = 20L * 1024 * 1024;
    String json =
        startRaw(owner, "data.csv", "text/csv", size)
            .andExpect(status().isCreated())
            .andReturn()
            .getResponse()
            .getContentAsString();
    UUID id = UUID.fromString(objectMapper.readTree(json).get("id").asText());
    putChunk(owner, id, 0, new byte[16 * 1024 * 1024 + 1])
        .andExpect(status().is(413))
        .andExpect(jsonPath("$.errors.code").value("UPLOAD_CHUNK_TOO_LARGE"));
  }

  /** 다 받기 전에 완료하면 409 UPLOAD_INCOMPLETE(errors.receivedBytes 에 받은 바이트) — 세션은 남아 이어 올릴 수 있다. */
  @Test
  void completeBeforeAllBytes_isConflict() throws Exception {
    UUID id = start(owner, CONTENT.length);
    putChunk(owner, id, 0, slice(0, 5)).andExpect(status().isOk());
    mockMvc
        .perform(
            post("/api/v1/drive/upload-sessions/" + id + "/complete")
                .header("Authorization", bearer(owner)))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.errors.code").value("UPLOAD_INCOMPLETE"))
        .andExpect(jsonPath("$.errors.receivedBytes").value("5"));
    assertThat(sessionRows(id)).isEqualTo(1);
  }

  /** 취소하면 204, 세션 행·임시 파일이 사라지고 그 뒤 GET 은 404. */
  @Test
  void cancel_removesSessionAndTempFile() throws Exception {
    UUID id = start(owner, CONTENT.length);
    putChunk(owner, id, 0, slice(0, 5)).andExpect(status().isOk());
    assertThat(Files.exists(uploadSessions.partPath(1L, id))).isTrue();

    mockMvc
        .perform(
            delete("/api/v1/drive/upload-sessions/" + id).header("Authorization", bearer(owner)))
        .andExpect(status().isNoContent());

    assertThat(Files.exists(uploadSessions.partPath(1L, id))).isFalse();
    assertThat(sessionRows(id)).isZero();
    mockMvc
        .perform(get("/api/v1/drive/upload-sessions/" + id).header("Authorization", bearer(owner)))
        .andExpect(status().isNotFound());
  }

  /** 남의 세션은 GET·PUT·complete·DELETE 모두 404 — 세션은 그대로 남는다. */
  @Test
  void otherUsersSession_isNotFound() throws Exception {
    UUID id = start(owner, CONTENT.length);
    putChunk(owner, id, 0, slice(0, CONTENT.length)).andExpect(status().isOk());

    mockMvc
        .perform(
            get("/api/v1/drive/upload-sessions/" + id).header("Authorization", bearer(outsider)))
        .andExpect(status().isNotFound());
    putChunk(outsider, id, CONTENT.length, new byte[] {1}).andExpect(status().isNotFound());
    mockMvc
        .perform(
            post("/api/v1/drive/upload-sessions/" + id + "/complete")
                .header("Authorization", bearer(outsider)))
        .andExpect(status().isNotFound());
    mockMvc
        .perform(
            delete("/api/v1/drive/upload-sessions/" + id).header("Authorization", bearer(outsider)))
        .andExpect(status().isNotFound());

    assertThat(sessionRows(id)).isEqualTo(1);
    assertThat(Files.exists(uploadSessions.partPath(1L, id))).isTrue();
    // 형식이 틀린 id 도 같은 404.
    mockMvc
        .perform(
            get("/api/v1/drive/upload-sessions/not-a-uuid").header("Authorization", bearer(owner)))
        .andExpect(status().isNotFound());
  }

  /** 범주 한도(이미지 10MB)를 넘는 크기는 바이트를 받기 전, 시작에서 400. */
  @Test
  void start_overCategoryLimit_isRejected() throws Exception {
    long imageLimit = FileUploadService.sizeLimitOf("IMAGE");
    startRaw(owner, "사진.png", "image/png", imageLimit + 1).andExpect(status().isBadRequest());
  }

  /** 회사 저장 용량을 넘는 크기는 시작에서 409. */
  @Test
  void start_overQuota_isRejected() throws Exception {
    callInTenant(
        1L,
        () -> {
          originalQuota =
              dsl.select(TENANT.QUOTA_BYTES)
                  .from(TENANT)
                  .where(TENANT.ID.eq(1L))
                  .fetchOne(TENANT.QUOTA_BYTES);
          long used = quotaService.usedBytes();
          dsl.update(TENANT).set(TENANT.QUOTA_BYTES, used + 100).where(TENANT.ID.eq(1L)).execute();
          return null;
        });
    startRaw(owner, "큰 파일.txt", "text/plain", 1000).andExpect(status().isConflict());
  }

  /** 열린 세션들의 선언 크기 + 새 크기가 용량을 넘으면 시작에서 409 — 하나씩은 통과해도 합쳐 넘기지 못하게. */
  @Test
  void start_overQuota_withOpenSessions_isRejected() throws Exception {
    callInTenant(
        1L,
        () -> {
          originalQuota =
              dsl.select(TENANT.QUOTA_BYTES)
                  .from(TENANT)
                  .where(TENANT.ID.eq(1L))
                  .fetchOne(TENANT.QUOTA_BYTES);
          // 다른 테스트가 남긴 열린 세션이 있어도 이 테스트의 여유분(1500)만 남도록 그 합도 더한다.
          long base = quotaService.usedBytes() + sessionRepository.sumOpenTotalSize();
          dsl.update(TENANT).set(TENANT.QUOTA_BYTES, base + 1500).where(TENANT.ID.eq(1L)).execute();
          return null;
        });
    // 첫 세션(1000)은 여유 안 — 통과. 둘째(1000)는 열린 1000 과 합쳐 2000 > 1500 이라 거절.
    start(owner, 1000);
    startRaw(owner, "둘째.txt", "text/plain", 1000).andExpect(status().isConflict());
  }

  /** 임시 파일이 사라졌으면 다음 조각 PUT 은 404 — 세션을 지워 화면이 처음부터 다시 올리게 한다(500 으로 갇히지 않음). */
  @Test
  void missingPart_onChunk_isNotFound_andSessionRemoved() throws Exception {
    UUID id = start(owner, CONTENT.length);
    putChunk(owner, id, 0, slice(0, 5)).andExpect(status().isOk());
    Files.delete(uploadSessions.partPath(1L, id));

    putChunk(owner, id, 5, slice(5, 10)).andExpect(status().isNotFound());

    assertThat(sessionRows(id)).isZero();
    assertThat(Files.exists(uploadSessions.partPath(1L, id))).isFalse();
    mockMvc
        .perform(get("/api/v1/drive/upload-sessions/" + id).header("Authorization", bearer(owner)))
        .andExpect(status().isNotFound());
  }

  /** 다 받았는데 임시 파일이 전체 크기보다 짧으면 완료는 404 — 세션·임시 파일이 지워지고 파일은 저장되지 않는다. */
  @Test
  void shortPart_onComplete_isNotFound_andSessionRemoved() throws Exception {
    UUID id = start(owner, CONTENT.length);
    putChunk(owner, id, 0, slice(0, CONTENT.length)).andExpect(status().isOk());
    Path part = uploadSessions.partPath(1L, id);
    try (FileChannel ch = FileChannel.open(part, StandardOpenOption.WRITE)) {
      ch.truncate(3);
    }

    mockMvc
        .perform(
            post("/api/v1/drive/upload-sessions/" + id + "/complete")
                .header("Authorization", bearer(owner)))
        .andExpect(status().isNotFound());

    assertThat(sessionRows(id)).isZero();
    assertThat(Files.exists(part)).isFalse();
    int files = callInTenant(1L, () -> dsl.fetchCount(FILE, FILE.UPLOADED_BY.eq(owner)));
    assertThat(files).isZero();
  }

  /** 크기 0 이하·VIEWER 는 시작할 수 없다(400·403). */
  @Test
  void start_invalidSize_orViewer_isRejected() throws Exception {
    startRaw(owner, "큰 파일.txt", "text/plain", 0).andExpect(status().isBadRequest());
    startRaw(viewer, "큰 파일.txt", "text/plain", 10).andExpect(status().isForbidden());
  }

  /** 만료 정리 — 만료된 세션의 행과 임시 파일을 함께 지운다. 만료 전 세션은 남긴다. */
  @Test
  void purgeExpired_removesRowAndTempFile() throws Exception {
    UUID expired = start(owner, CONTENT.length);
    putChunk(owner, expired, 0, slice(0, 5)).andExpect(status().isOk());
    UUID alive = start(owner, CONTENT.length);
    putChunk(owner, alive, 0, slice(0, 5)).andExpect(status().isOk());
    callInTenant(
        1L,
        () ->
            dsl.execute(
                "UPDATE drive_upload_session SET expires_at = now() - interval '1 minute'"
                    + " WHERE id = CAST(? AS uuid)",
                expired));

    // 만료된 세션은 정리 전에도 보이지 않는다(404).
    mockMvc
        .perform(
            get("/api/v1/drive/upload-sessions/" + expired).header("Authorization", bearer(owner)))
        .andExpect(status().isNotFound());

    assertThat(uploadSessions.purgeExpired()).isGreaterThanOrEqualTo(1);

    assertThat(sessionRows(expired)).isZero();
    assertThat(Files.exists(uploadSessions.partPath(1L, expired))).isFalse();
    assertThat(sessionRows(alive)).isEqualTo(1);
    assertThat(Files.exists(uploadSessions.partPath(1L, alive))).isTrue();
  }
}
