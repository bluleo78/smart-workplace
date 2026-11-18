package com.workplace.drive.controller;

import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.DRIVE_FILE;
import static com.workplace.jooq.Tables.DRIVE_FILE_ACTIVITY;
import static com.workplace.jooq.Tables.DRIVE_SPACE;
import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
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
import java.time.OffsetDateTime;
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
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * 드라이브 「최근」 API(WP-1699) 통합 테스트 — GET /api/v1/drive/recent 의 정렬·쪽 나누기·거르기.
 *
 * <p>기록은 REQUIRES_NEW 로 따로 커밋되므로 {@code @Transactional} 을 달지 않고, 시드를 커밋한 뒤 {@link #cleanup} 에서 지운다.
 */
class DriveRecentIntegrationTest extends IntegrationTestBase {
  @Autowired MockMvc mockMvc;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwtTokenProvider;
  @Autowired DriveFileService fileService;
  @Autowired DriveSpaceService spaceService;
  @Autowired ObjectMapper objectMapper;
  @Autowired DriveFileActivityRepository activityRepository;

  private final List<Long> userIds = new ArrayList<>();
  private final List<Long> spaceIds = new ArrayList<>();
  private long owner;
  private long spaceId;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    try {
      new TransactionTemplate(txManager)
          .executeWithoutResult(
              st -> {
                owner = withMembership(TestFixtures.createHuman(dsl));
                userIds.add(owner);
                spaceId = newTeamSpace(owner);
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
          dsl.deleteFrom(DRIVE_SPACE).where(DRIVE_SPACE.ID.in(spaceIds)).execute();
          dsl.deleteFrom(AUDIT_LOG).where(AUDIT_LOG.USER_ID.in(userIds)).execute();
          dsl.deleteFrom(FILE).where(FILE.UPLOADED_BY.in(userIds)).execute();
          dsl.deleteFrom(USER).where(USER.ID.in(userIds)).execute();
        });
    userIds.clear();
    spaceIds.clear();
  }

  /** 팀 공간을 만들고 정리 목록에 올린다(트랜잭션 안에서 부른다). */
  private long newTeamSpace(long creator) {
    long id =
        spaceService
            .createTeamSpace(creator, "최근_" + UUID.randomUUID().toString().substring(0, 8))
            .id();
    spaceIds.add(id);
    return id;
  }

  /** 서비스로 직접 올려 시드한다 — 컨트롤러를 거치지 않으니 기록은 남지 않는다. */
  private long seedFile(long space, Long folderId, String name) {
    return callInTenant(
        1L,
        () -> {
          try {
            return fileService
                .upload(
                    owner,
                    space,
                    folderId,
                    new MockMultipartFile(
                        "file", name, "text/plain", "본문".getBytes(StandardCharsets.UTF_8)))
                .id();
          } catch (Exception e) {
            throw new IllegalStateException(e);
          }
        });
  }

  private void record(long userId, long fileId, DriveFileAction action) {
    callInTenant(
        1L,
        () -> {
          activityRepository.upsert(userId, fileId, action);
          return null;
        });
  }

  private String bearer(long userId) {
    return "Bearer " + jwtTokenProvider.generateAccessToken(userId, "user-" + userId, 1L);
  }

  private JsonNode recent(long userId, String query) throws Exception {
    String json =
        mockMvc
            .perform(get("/api/v1/drive/recent" + query).header("Authorization", bearer(userId)))
            .andExpect(status().isOk())
            .andReturn()
            .getResponse()
            .getContentAsString();
    return objectMapper.readTree(json);
  }

  @Test
  void recent_returnsOwnActivityNewestFirst() throws Exception {
    // 폴더 한 단계 아래 파일 A 를 API 로 열고, 루트에 B 를 API 로 올린다.
    String folderJson =
        mockMvc
            .perform(
                post("/api/v1/drive/spaces/" + spaceId + "/folders")
                    .header("Authorization", bearer(owner))
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("{\"name\":\"기획\"}"))
            .andExpect(status().isCreated())
            .andReturn()
            .getResponse()
            .getContentAsString();
    long folderId = objectMapper.readTree(folderJson).get("id").asLong();
    long a = seedFile(spaceId, folderId, "A.txt");
    mockMvc
        .perform(
            get("/api/v1/drive/files/" + a + "/content").header("Authorization", bearer(owner)))
        .andExpect(status().isOk());
    mockMvc
        .perform(
            multipart("/api/v1/drive/spaces/" + spaceId + "/files")
                .file(new MockMultipartFile("file", "B.txt", "text/plain", "b".getBytes()))
                .header("Authorization", bearer(owner)))
        .andExpect(status().isCreated());

    JsonNode body = recent(owner, "");
    assertThat(body.get("items")).hasSize(2);
    JsonNode first = body.get("items").get(0);
    JsonNode second = body.get("items").get(1);
    assertThat(first.get("name").asString()).isEqualTo("B.txt");
    assertThat(first.get("lastAction").asString()).isEqualTo("UPLOAD");
    assertThat(first.get("folderPath")).isEmpty();
    assertThat(first.get("folderId").isNull()).isTrue();
    assertThat(second.get("name").asString()).isEqualTo("A.txt");
    assertThat(second.get("lastAction").asString()).isEqualTo("OPEN");
    assertThat(second.get("driveFileId").asLong()).isEqualTo(a);
    assertThat(second.get("spaceId").asLong()).isEqualTo(spaceId);
    assertThat(second.get("spaceName").asString()).startsWith("최근_");
    assertThat(second.get("folderId").asLong()).isEqualTo(folderId);
    assertThat(second.get("folderPath")).hasSize(1);
    assertThat(second.get("folderPath").get(0).get("name").asString()).isEqualTo("기획");
    assertThat(second.get("lastAt").asString()).isNotBlank();
    assertThat(body.get("nextCursor").isNull()).isTrue();
  }

  @Test
  void recent_folderPath_rootToParent() throws Exception {
    long outer = folder(null, "위");
    long inner = folder(outer, "아래");
    long f = seedFile(spaceId, inner, "깊은.txt");
    record(owner, f, DriveFileAction.OPEN);

    JsonNode path = recent(owner, "").get("items").get(0).get("folderPath");
    assertThat(path).hasSize(2);
    assertThat(path.get(0).get("name").asString()).isEqualTo("위");
    assertThat(path.get(1).get("name").asString()).isEqualTo("아래");
    assertThat(path.get(1).get("id").asLong()).isEqualTo(inner);
  }

  /**
   * fileId 는 지금 버전의 core 파일 id — 새 버전을 올리면 바뀐다(WP-1699 리뷰). 웹 뷰어가 재생 주소 캐시 키로 쓰므로, 늘 같으면 새 버전이 올라와도
   * 옛 재생 주소를 다시 쓴다.
   */
  @Test
  void recent_carriesCurrentVersionFileId() throws Exception {
    long f = seedFile(spaceId, null, "판.txt");
    record(owner, f, DriveFileAction.OPEN);
    long v1 = recent(owner, "").get("items").get(0).get("fileId").asLong();
    assertThat(v1).isEqualTo(currentFileId(f));

    long v2 =
        callInTenant(
            1L,
            () -> {
              try {
                return fileService
                    .addVersion(
                        owner,
                        f,
                        UploadSource.ofBytes(
                            "판.txt", "text/plain", "둘째 판".getBytes(StandardCharsets.UTF_8)))
                    .fileId();
              } catch (Exception e) {
                throw new IllegalStateException(e);
              }
            });
    assertThat(v2).isNotEqualTo(v1);
    assertThat(recent(owner, "").get("items").get(0).get("fileId").asLong()).isEqualTo(v2);
  }

  /** 드라이브 파일의 지금 버전 core 파일 id(drive_file.file_id). */
  private long currentFileId(long driveFileId) {
    return callInTenant(
        1L,
        () ->
            dsl.select(DRIVE_FILE.FILE_ID)
                .from(DRIVE_FILE)
                .where(DRIVE_FILE.ID.eq(driveFileId))
                .fetchOne(DRIVE_FILE.FILE_ID));
  }

  /** 별표(WP-1698) — 내가 별표한 파일만 starred=true, 별표를 빼면 다시 false. 행의 별표 단추가 이 값으로 켜진 모양을 정한다. */
  @Test
  void recent_carriesMyStar() throws Exception {
    long a = seedFile(spaceId, null, "별표.txt");
    long b = seedFile(spaceId, null, "그냥.txt");
    record(owner, a, DriveFileAction.OPEN);
    record(owner, b, DriveFileAction.OPEN);
    mockMvc
        .perform(
            put("/api/v1/drive/stars")
                .header("Authorization", bearer(owner))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"kind\":\"FILE\",\"id\":" + a + "}"))
        .andExpect(status().isNoContent());

    JsonNode items = recent(owner, "").get("items");
    assertThat(items).hasSize(2);
    for (JsonNode it : items) {
      boolean expected = it.get("driveFileId").asLong() == a;
      assertThat(it.get("starred").asBoolean()).as("file %s", it.get("name")).isEqualTo(expected);
    }

    mockMvc
        .perform(
            delete("/api/v1/drive/stars")
                .header("Authorization", bearer(owner))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"kind\":\"FILE\",\"id\":" + a + "}"))
        .andExpect(status().isNoContent());
    for (JsonNode it : recent(owner, "").get("items")) {
      assertThat(it.get("starred").asBoolean()).isFalse();
    }
  }

  private long folder(Long parentId, String name) throws Exception {
    String body =
        parentId == null
            ? "{\"name\":\"" + name + "\"}"
            : "{\"name\":\"" + name + "\",\"parentId\":" + parentId + "}";
    String json =
        mockMvc
            .perform(
                post("/api/v1/drive/spaces/" + spaceId + "/folders")
                    .header("Authorization", bearer(owner))
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(body))
            .andExpect(status().isCreated())
            .andReturn()
            .getResponse()
            .getContentAsString();
    return objectMapper.readTree(json).get("id").asLong();
  }

  @Test
  void recent_paginates50WithCursor() throws Exception {
    for (int i = 0; i < 51; i++) {
      long f = seedFile(spaceId, null, "f" + i + ".txt");
      record(owner, f, DriveFileAction.UPLOAD);
    }
    JsonNode page1 = recent(owner, "");
    assertThat(page1.get("items")).hasSize(50);
    assertThat(page1.get("items").get(0).get("name").asString()).isEqualTo("f50.txt");
    String cursor = page1.get("nextCursor").asString();
    assertThat(cursor).isNotBlank();

    JsonNode page2 = recent(owner, "?cursor=" + cursor);
    assertThat(page2.get("items")).hasSize(1);
    assertThat(page2.get("items").get(0).get("name").asString()).isEqualTo("f0.txt");
    assertThat(page2.get("nextCursor").isNull()).isTrue();
  }

  @Test
  void recent_sameTimestampAcrossPageBoundary_noGapNoOverlap() throws Exception {
    // 같은 last_at 3줄 + limit 2 — 쪽 경계에서 빠지거나 겹치지 않아야 한다.
    for (int i = 0; i < 3; i++) {
      long f = seedFile(spaceId, null, "same" + i + ".txt");
      record(owner, f, DriveFileAction.UPLOAD);
    }
    callInTenant(
        1L,
        () ->
            dsl.update(DRIVE_FILE_ACTIVITY)
                .set(DRIVE_FILE_ACTIVITY.LAST_AT, OffsetDateTime.now().minusMinutes(5))
                .where(DRIVE_FILE_ACTIVITY.USER_ID.eq(owner))
                .execute());
    JsonNode p1 = recent(owner, "?limit=2");
    assertThat(p1.get("items")).hasSize(2);
    JsonNode p2 = recent(owner, "?limit=2&cursor=" + p1.get("nextCursor").asString());
    assertThat(p2.get("items")).hasSize(1);
    assertThat(p2.get("nextCursor").isNull()).isTrue();
    List<String> names = new ArrayList<>();
    for (JsonNode n : p1.get("items")) names.add(n.get("name").asString());
    names.add(p2.get("items").get(0).get("name").asString());
    assertThat(names).doesNotHaveDuplicates().hasSize(3);
  }

  @Test
  void recent_limitClamped() throws Exception {
    long f = seedFile(spaceId, null, "하나.txt");
    record(owner, f, DriveFileAction.UPLOAD);
    assertThat(recent(owner, "?limit=0").get("items")).hasSize(1);
    assertThat(recent(owner, "?limit=9999").get("items")).hasSize(1);
  }

  @Test
  void recent_excludesTrashed_restoresAfterRestore() throws Exception {
    long f = seedFile(spaceId, null, "버릴것.txt");
    record(owner, f, DriveFileAction.OPEN);
    mockMvc
        .perform(delete("/api/v1/drive/files/" + f).header("Authorization", bearer(owner)))
        .andExpect(status().is2xxSuccessful());
    assertThat(recent(owner, "").get("items")).isEmpty();

    mockMvc
        .perform(
            post("/api/v1/drive/files/" + f + "/restore").header("Authorization", bearer(owner)))
        .andExpect(status().is2xxSuccessful());
    assertThat(recent(owner, "").get("items")).hasSize(1);
  }

  @Test
  void recent_excludesSpaceAfterMemberRemoved() throws Exception {
    long member = withMembership(TestFixtures.createHuman(dsl));
    userIds.add(member);
    mockMvc
        .perform(
            post("/api/v1/drive/spaces/" + spaceId + "/members")
                .header("Authorization", bearer(owner))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"userId\":" + member + ",\"role\":\"EDITOR\"}"))
        .andExpect(status().is2xxSuccessful());
    long f = seedFile(spaceId, null, "팀파일.txt");
    mockMvc
        .perform(
            get("/api/v1/drive/files/" + f + "/content").header("Authorization", bearer(member)))
        .andExpect(status().isOk());
    assertThat(recent(member, "").get("items")).hasSize(1);

    mockMvc
        .perform(
            delete("/api/v1/drive/spaces/" + spaceId + "/members/" + member)
                .header("Authorization", bearer(owner)))
        .andExpect(status().is2xxSuccessful());
    assertThat(recent(member, "").get("items")).isEmpty();
  }

  @Test
  void recent_cannotSeeOthers() throws Exception {
    long f = seedFile(spaceId, null, "내것.txt");
    record(owner, f, DriveFileAction.OPEN);
    long other = withMembership(TestFixtures.createHuman(dsl));
    userIds.add(other);
    assertThat(recent(other, "").get("items")).isEmpty();
    assertThat(recent(owner, "").get("items")).hasSize(1);
  }

  @Test
  void recent_empty() throws Exception {
    mockMvc
        .perform(get("/api/v1/drive/recent").header("Authorization", bearer(owner)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items", hasSize(0)))
        .andExpect(jsonPath("$.nextCursor", nullValue()));
  }

  @Test
  void recent_badCursor_is400() throws Exception {
    mockMvc
        .perform(
            get("/api/v1/drive/recent?cursor=!!not-a-cursor!!")
                .header("Authorization", bearer(owner)))
        .andExpect(status().isBadRequest());
    mockMvc
        .perform(get("/api/v1/drive/recent?cursor=YWJj").header("Authorization", bearer(owner)))
        .andExpect(status().isBadRequest());
  }

  @Test
  void recent_requiresLogin() throws Exception {
    mockMvc.perform(get("/api/v1/drive/recent")).andExpect(status().isUnauthorized());
  }
}
