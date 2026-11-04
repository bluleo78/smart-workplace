package com.workplace.search;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.drive.dto.DriveFileResponse;
import com.workplace.drive.dto.DriveFolderResponse;
import com.workplace.drive.service.DriveFileService;
import com.workplace.drive.service.DriveFolderService;
import com.workplace.drive.service.DriveSpaceService;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;

/**
 * 통합 검색 팔레트(WP-1353)의 모든 공간 드라이브 이름 검색 — 멤버 공간만, 휴지통 제외, 폴더 먼저·경로·공간 이름, hasMore 페이지, 짧은 검색어 빈 결과.
 */
@Transactional
class SearchDriveIT extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwt;
  @Autowired DriveSpaceService spaceService;
  @Autowired DriveFolderService folderService;
  @Autowired DriveFileService fileService;

  private long me;
  private long other;
  private long mySpace;
  private String word;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    word = "zq" + s;
    me = withMembership(TestFixtures.createHuman(dsl));
    other = withMembership(TestFixtures.createHuman(dsl));
    mySpace = spaceService.createTeamSpace(me, "내공간-" + s).id();
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  private DriveFileResponse file(long user, long space, Long folder, String name) throws Exception {
    return fileService.upload(
        user, space, folder, new MockMultipartFile("file", name, "text/plain", "x".getBytes()));
  }

  @Test
  void searchDrive_onlyMemberSpaces() throws Exception {
    long theirs = spaceService.createTeamSpace(other, "남의공간-" + word).id();
    file(other, theirs, null, word + "-secret.txt");
    file(me, mySpace, null, word + "-mine.txt");

    JsonNode r = search(me, word, null, null);

    assertThat(r.get("items")).hasSize(1);
    assertThat(r.get("items").get(0).get("name").asText()).isEqualTo(word + "-mine.txt");
  }

  @Test
  void searchDrive_excludesTrashed() throws Exception {
    DriveFileResponse gone = file(me, mySpace, null, word + "-gone.txt");
    DriveFolderResponse trashed = folderService.create(me, mySpace, null, "휴지통행-" + word);
    file(me, mySpace, trashed.id(), word + "-inside.txt");
    file(me, mySpace, null, word + "-live.txt");
    fileService.delete(me, gone.id());
    folderService.delete(me, trashed.id());

    JsonNode r = search(me, word, null, null);

    assertThat(r.get("items")).hasSize(1);
    assertThat(r.get("items").get(0).get("name").asText()).isEqualTo(word + "-live.txt");
  }

  @Test
  void searchDrive_foldersFirstThenFilesWithPath() throws Exception {
    DriveFolderResponse a = folderService.create(me, mySpace, null, "프로젝트");
    DriveFolderResponse b = folderService.create(me, mySpace, a.id(), "문서");
    DriveFileResponse f = file(me, mySpace, b.id(), "a-" + word + ".txt");
    DriveFolderResponse hitFolder = folderService.create(me, mySpace, a.id(), "z-" + word);

    JsonNode items = search(me, word, null, null).get("items");

    assertThat(items).hasSize(2);
    JsonNode first = items.get(0);
    assertThat(first.get("kind").asText()).isEqualTo("FOLDER");
    assertThat(first.get("id").asLong()).isEqualTo(hitFolder.id());
    assertThat(first.get("folderId").asLong()).isEqualTo(a.id());
    assertThat(first.get("folderPath").asText()).isEqualTo("프로젝트");
    assertThat(first.get("mimeType").isNull()).isTrue();
    JsonNode second = items.get(1);
    assertThat(second.get("kind").asText()).isEqualTo("FILE");
    assertThat(second.get("id").asLong()).isEqualTo(f.id());
    assertThat(second.get("spaceId").asLong()).isEqualTo(mySpace);
    assertThat(second.get("spaceName").asText()).startsWith("내공간-");
    assertThat(second.get("folderId").asLong()).isEqualTo(b.id());
    assertThat(second.get("mimeType").asText()).isEqualTo("text/plain");
    assertThat(second.get("folderPath").asText()).isEqualTo("프로젝트 / 문서");
  }

  @Test
  void searchDrive_rootItemHasEmptyPath() throws Exception {
    file(me, mySpace, null, word + ".txt");
    JsonNode item = search(me, word, null, null).get("items").get(0);
    assertThat(item.get("folderId").isNull()).isTrue();
    assertThat(item.get("folderPath").asText()).isEmpty();
  }

  @Test
  void searchDrive_pagesWithHasMore() throws Exception {
    for (int i = 0; i < 3; i++) {
      file(me, mySpace, null, word + "-" + i + ".txt");
    }
    JsonNode p1 = search(me, word, 0, 2);
    assertThat(p1.get("items")).hasSize(2);
    assertThat(p1.get("hasMore").asBoolean()).isTrue();
    JsonNode p2 = search(me, word, 2, 2);
    assertThat(p2.get("items")).hasSize(1);
    assertThat(p2.get("hasMore").asBoolean()).isFalse();
  }

  @Test
  void searchDrive_shortQueryEmpty() throws Exception {
    file(me, mySpace, null, "a.txt");
    JsonNode r = search(me, " a ", null, null);
    assertThat(r.get("items")).isEmpty();
    assertThat(r.get("hasMore").asBoolean()).isFalse();
  }

  @Test
  void searchDrive_invalidPaging_is400() throws Exception {
    call(get("/api/v1/search/drive").param("q", word).param("size", "0"), me)
        .andExpect(status().isBadRequest());
    call(get("/api/v1/search/drive").param("q", word).param("size", "51"), me)
        .andExpect(status().isBadRequest());
    call(get("/api/v1/search/drive").param("q", word).param("offset", "-1"), me)
        .andExpect(status().isBadRequest());
  }

  private JsonNode search(long user, String q, Integer offset, Integer size) throws Exception {
    MockHttpServletRequestBuilder req = get("/api/v1/search/drive").param("q", q);
    if (offset != null) req.param("offset", "" + offset);
    if (size != null) req.param("size", "" + size);
    ResultActions r = call(req, user).andExpect(status().isOk());
    return om.readTree(r.andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8));
  }

  private ResultActions call(MockHttpServletRequestBuilder req, long userId) throws Exception {
    req.header("Authorization", "Bearer " + jwt.generateAccessToken(userId, "u-" + userId, 1L));
    ResultActions r = mvc.perform(req);
    TenantContext.set(1L);
    return r;
  }
}
