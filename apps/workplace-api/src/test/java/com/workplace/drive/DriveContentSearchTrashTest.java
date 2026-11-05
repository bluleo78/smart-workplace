package com.workplace.drive;

import static com.workplace.jooq.Tables.DRIVE_FILE;
import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.FILE_EXTRACTION;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.drive.service.DriveSpaceService;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;

/**
 * 드라이브 본문 검색(GET /api/v1/drive/search)이 휴지통 파일을 내지 않는다(WP-1378) — 컨트롤러부터 저장소까지 실제로 거친다.
 *
 * <p>본문이 맞는(추출 DONE) 파일을 실제 휴지통 API 로 넣으면 결과에서 빠지고, 복원 API 로 되돌리면 다시 나와야 한다. 폴더째 휴지통에 넣은 경우(하위 파일이
 * 같은 op 로 trashed_at 을 받는다)도 같다.
 *
 * <p>@Transactional: MockMvc 요청이 테스트 트랜잭션에 합류해 시드를 보고 끝나면 롤백된다(DriveSpaceMemberGroupTest 와 같은 방식).
 */
@Transactional
class DriveContentSearchTrashTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwt;
  @Autowired DriveSpaceService spaceService;

  private long ownerId; // 공간 OWNER — 업로드·휴지통·복원·검색을 모두 이 사람이 한다
  private long spaceId;
  private String token; // 이 테스트에서만 본문에 넣는 고유 검색어(다른 테스트 데이터와 섞이지 않게)

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    String suffix = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    token = "trashprobe" + suffix;
    ownerId = withMembership(TestFixtures.createHuman(dsl));
    spaceId = spaceService.createTeamSpace(ownerId, "휴지통검색-" + suffix).id();
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  /** 파일을 휴지통에 넣으면 본문 검색에서 빠지고, 복원하면 다시 나온다. 같은 본문의 다른 파일은 계속 나온다. */
  @Test
  void trashed_file_is_hidden_from_content_search_and_back_after_restore() throws Exception {
    long kept = seedDriveFileWithExtraction(null, "분기 매출 " + token);
    long target = seedDriveFileWithExtraction(null, "분기 매출 " + token);
    assertThat(searchIds()).contains(kept, target);

    call(delete("/api/v1/drive/files/{id}", target)).andExpect(status().isNoContent());
    assertThat(searchIds()).contains(kept).doesNotContain(target);
    // 공간을 지정한 검색(공간 AI 요약이 쓰는 경로)에서도 빠진다.
    assertThat(searchIds(spaceId)).contains(kept).doesNotContain(target);

    call(post("/api/v1/drive/files/{id}/restore", target)).andExpect(status().is2xxSuccessful());
    assertThat(searchIds()).contains(kept, target);
  }

  /** 폴더째 휴지통에 넣으면 그 안 파일도 본문 검색에서 빠지고, 폴더를 복원하면 다시 나온다. */
  @Test
  void files_in_trashed_folder_are_hidden_and_back_after_folder_restore() throws Exception {
    long folderId =
        json(call(post("/api/v1/drive/spaces/{id}/folders", spaceId)
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(om.writeValueAsString(Map.of("name", "폴더-" + token))))
                .andExpect(status().isCreated()))
            .get("id")
            .asLong();
    long inFolder = seedDriveFileWithExtraction(folderId, "회의록 " + token);
    assertThat(searchIds()).contains(inFolder);

    call(delete("/api/v1/drive/folders/{id}", folderId)).andExpect(status().is2xxSuccessful());
    assertThat(searchIds()).doesNotContain(inFolder);

    call(post("/api/v1/drive/folders/{id}/restore", folderId))
        .andExpect(status().is2xxSuccessful());
    assertThat(searchIds()).contains(inFolder);
  }

  // ── 도우미 ─────────────────────────────────────────────────────────────

  /** 테넌트 전역 본문 검색 결과의 driveFileId 목록. */
  private List<Long> searchIds() throws Exception {
    return searchIds(null);
  }

  /** 본문 검색 결과의 driveFileId 목록(spaceId 가 있으면 그 공간으로 제한). */
  private List<Long> searchIds(Long scope) throws Exception {
    MockHttpServletRequestBuilder req = get("/api/v1/drive/search").param("q", token);
    if (scope != null) {
      req.param("spaceId", String.valueOf(scope));
    }
    JsonNode body = json(call(req).andExpect(status().isOk()));
    List<Long> ids = new ArrayList<>();
    body.get("hits").forEach(h -> ids.add(h.get("driveFileId").asLong()));
    return ids;
  }

  /**
   * file → drive_file → file_extraction(DONE) 시드 — 이 테스트 스택엔 추출 워커가 없어 추출 완료 상태를 직접 채운다
   * (DriveContentSearchRepositoryTest 와 같은 방식). folderId 가 null 이면 공간 루트.
   */
  private long seedDriveFileWithExtraction(Long folderId, String extractedText) {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    long fileId =
        dsl.insertInto(FILE)
            .set(FILE.ORIGINAL_NAME, "보고서-" + s)
            .set(FILE.STORED_NAME, "stored_" + s)
            .set(FILE.MIME_TYPE, "text/plain")
            .set(FILE.SIZE_BYTES, 100L)
            .set(FILE.STORAGE_PATH, "/data/uploads/" + s)
            .set(FILE.UPLOADED_BY, ownerId)
            .returning(FILE.ID)
            .fetchOne()
            .getId();
    dsl.insertInto(DRIVE_FILE)
        .set(DRIVE_FILE.SPACE_ID, spaceId)
        .set(DRIVE_FILE.FOLDER_ID, folderId)
        .set(DRIVE_FILE.FILE_ID, fileId)
        .set(DRIVE_FILE.NAME, "보고서-" + s)
        .execute();
    dsl.insertInto(FILE_EXTRACTION)
        .set(FILE_EXTRACTION.FILE_ID, fileId)
        .set(FILE_EXTRACTION.STATUS, "DONE")
        .set(FILE_EXTRACTION.EXTRACTED_TEXT, extractedText)
        .set(FILE_EXTRACTION.TENANT_ID, 1L)
        .execute();
    return dsl.select(DRIVE_FILE.ID)
        .from(DRIVE_FILE)
        .where(DRIVE_FILE.FILE_ID.eq(fileId))
        .fetchOne(DRIVE_FILE.ID);
  }

  private JsonNode json(ResultActions r) throws Exception {
    return om.readTree(r.andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8));
  }

  /** 공간 OWNER 의 JWT 로 요청 — 요청이 끝나면 필터가 지운 테넌트 컨텍스트를 되살린다. */
  private ResultActions call(MockHttpServletRequestBuilder req) throws Exception {
    req.header("Authorization", "Bearer " + jwt.generateAccessToken(ownerId, "u-" + ownerId, 1L));
    ResultActions r = mvc.perform(req);
    TenantContext.set(1L);
    return r;
  }
}
