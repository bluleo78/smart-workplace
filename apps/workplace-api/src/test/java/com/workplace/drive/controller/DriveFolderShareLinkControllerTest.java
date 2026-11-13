package com.workplace.drive.controller;

import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.DRIVE_FOLDER;
import static com.workplace.jooq.Tables.DRIVE_SPACE;
import static com.workplace.jooq.Tables.DRIVE_SPACE_MEMBER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.startsWith;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import com.workplace.drive.service.DriveShareLinkService;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.OffsetDateTime;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.annotation.Transactional;

/**
 * 폴더 공유 링크 관리 API(WP-1538) — 생성(201)·목록·폐기, 역할·보관 공간·휴지통·존재 숨김, 감사 FOLDER_SHARE. 실제 API(MockMvc)로
 * 부른다. {@code @Transactional}: 끝나면 롤백된다.
 */
@Transactional
class DriveFolderShareLinkControllerTest extends IntegrationTestBase {
  private static final String BODY = "{\"audience\":\"EXTERNAL\"}";

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwt;
  @Autowired DriveShareLinkService service;

  private long editorId;
  private long viewerId;
  private long strangerId;
  private long spaceId;
  private long folderId;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    editorId = withMembership(TestFixtures.createHuman(dsl));
    viewerId = withMembership(TestFixtures.createHuman(dsl));
    strangerId = withMembership(TestFixtures.createHuman(dsl));
    spaceId =
        dsl.insertInto(DRIVE_SPACE)
            .set(DRIVE_SPACE.TYPE, "TEAM")
            .set(DRIVE_SPACE.NAME, "sp")
            .set(DRIVE_SPACE.OWNER_ID, editorId)
            .returning(DRIVE_SPACE.ID)
            .fetchOne()
            .getId();
    member(editorId, "EDITOR");
    member(viewerId, "VIEWER");
    folderId = folder("보고서");
  }

  private void member(long userId, String role) {
    dsl.insertInto(DRIVE_SPACE_MEMBER)
        .set(DRIVE_SPACE_MEMBER.SPACE_ID, spaceId)
        .set(DRIVE_SPACE_MEMBER.USER_ID, userId)
        .set(DRIVE_SPACE_MEMBER.ROLE, role)
        .execute();
  }

  private long folder(String name) {
    return dsl.insertInto(DRIVE_FOLDER)
        .set(DRIVE_FOLDER.SPACE_ID, spaceId)
        .set(DRIVE_FOLDER.NAME, name)
        .returning(DRIVE_FOLDER.ID)
        .fetchOne()
        .getId();
  }

  private ResultActions postJson(String path, long userId, String body) throws Exception {
    TenantContext.set(1L);
    ResultActions r =
        mvc.perform(
            post(path)
                .header("Authorization", bearer(userId))
                .contentType(MediaType.APPLICATION_JSON)
                .content(body));
    TenantContext.set(1L);
    return r;
  }

  private ResultActions getList(long folder, long userId) throws Exception {
    TenantContext.set(1L);
    ResultActions r =
        mvc.perform(
            get("/api/v1/drive/folders/" + folder + "/share-links")
                .header("Authorization", bearer(userId)));
    TenantContext.set(1L);
    return r;
  }

  private String bearer(long userId) {
    return "Bearer " + jwt.generateAccessToken(userId, "u-" + userId, 1L);
  }

  private ResultActions create(long folder, long userId, String body) throws Exception {
    return postJson("/api/v1/drive/folders/" + folder + "/share-links", userId, body);
  }

  @Test
  void create_editor_201_andAuditFolderShare() throws Exception {
    create(folderId, editorId, BODY)
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.token", startsWith("sl_")))
        .andExpect(jsonPath("$.audience").value("EXTERNAL"));
    int count =
        dsl.fetchCount(
            AUDIT_LOG,
            AUDIT_LOG
                .ACTION_TYPE
                .eq("FOLDER_SHARE")
                .and(AUDIT_LOG.RESOURCE_ID.eq(String.valueOf(folderId)))
                .and(org.jooq.impl.DSL.condition("metadata->>'target' = 'FOLDER'")));
    assertThat(count).isEqualTo(1);
  }

  @Test
  void create_viewer_403() throws Exception {
    create(folderId, viewerId, BODY).andExpect(status().isForbidden());
  }

  @Test
  void create_nonMember_404() throws Exception {
    create(folderId, strangerId, BODY)
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.message").value("드라이브 폴더를 찾을 수 없습니다"));
  }

  @Test
  void create_archivedSpace_403() throws Exception {
    archive();
    create(folderId, editorId, BODY).andExpect(status().isForbidden());
  }

  @Test
  void create_trashedFolder_404() throws Exception {
    dsl.update(DRIVE_FOLDER)
        .set(DRIVE_FOLDER.TRASHED_AT, OffsetDateTime.now())
        .where(DRIVE_FOLDER.ID.eq(folderId))
        .execute();
    create(folderId, editorId, BODY).andExpect(status().isNotFound());
  }

  @Test
  void create_badAudience_400() throws Exception {
    create(folderId, editorId, "{\"audience\":\"NOPE\"}").andExpect(status().isBadRequest());
  }

  @Test
  void list_archivedSpace_editor_200_returnsFolderLinksOnly() throws Exception {
    create(folderId, editorId, BODY).andExpect(status().isCreated());
    long other = folder("다른 폴더");
    create(other, editorId, BODY).andExpect(status().isCreated());
    archive();
    getList(folderId, editorId).andExpect(status().isOk()).andExpect(jsonPath("$", hasSize(1)));
  }

  @Test
  void list_viewer_403() throws Exception {
    getList(folderId, viewerId).andExpect(status().isForbidden());
  }

  @Test
  void revoke_folderLink_204_thenListShowsRevoked() throws Exception {
    String res = create(folderId, editorId, BODY).andReturn().getResponse().getContentAsString();
    long linkId = ((Number) JsonPath.read(res, "$.id")).longValue();
    TenantContext.set(1L);
    mvc.perform(
            delete("/api/v1/drive/share-links/" + linkId).header("Authorization", bearer(editorId)))
        .andExpect(status().isNoContent());
    TenantContext.set(1L);
    getList(folderId, editorId)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[0].revoked").value(true))
        .andExpect(jsonPath("$[0].token").doesNotExist());
  }

  private void archive() {
    dsl.update(DRIVE_SPACE)
        .set(DRIVE_SPACE.ARCHIVED_AT, OffsetDateTime.now())
        .where(DRIVE_SPACE.ID.eq(spaceId))
        .execute();
  }
}
