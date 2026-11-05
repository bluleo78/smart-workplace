package com.workplace.search;

import static com.workplace.jooq.Tables.FILE_EXTRACTION;
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
 * WP-1356: 본문(추출 텍스트)만 맞은 파일이 이름 결과 뒤에 발췌와 함께 이어지고, 이름·본문 둘 다 맞으면 한 번만 나온다.
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

  /** 업로드가 만든 추출 행(PENDING)을 추출 완료 상태로 덮어 본문을 심는다 — 워커 없이 본문 검색을 재현한다. */
  private void extracted(DriveFileResponse f, String text) {
    dsl.insertInto(FILE_EXTRACTION)
        .set(FILE_EXTRACTION.FILE_ID, f.fileId())
        .set(FILE_EXTRACTION.STATUS, "DONE")
        .set(FILE_EXTRACTION.EXTRACTED_TEXT, text)
        .set(FILE_EXTRACTION.TENANT_ID, 1L)
        .onConflict(FILE_EXTRACTION.FILE_ID)
        .doUpdate()
        .set(FILE_EXTRACTION.STATUS, "DONE")
        .set(FILE_EXTRACTION.EXTRACTED_TEXT, text)
        .execute();
  }

  @Test
  void searchDrive_bodyOnlyFilesFollowNameHitsWithSnippet() throws Exception {
    DriveFolderResponse folder = folderService.create(me, mySpace, null, "폴더-" + word);
    DriveFileResponse named = file(me, mySpace, null, word + "-이름.txt");
    DriveFileResponse body = file(me, mySpace, folder.id(), "보고서.txt");
    extracted(body, "첫 줄\n둘째 줄에 " + word + " 이 들어 있다");
    DriveFileResponse plain = file(me, mySpace, null, "무관.txt");
    extracted(plain, "아무 관련 없는 본문");

    JsonNode items = search(me, word, null, null).get("items");

    // 이름 맞은 폴더 → 이름 맞은 파일 → 본문만 맞은 파일. 본문이 안 맞는 파일은 없다.
    assertThat(items).hasSize(3);
    assertThat(items.get(0).get("id").asLong()).isEqualTo(folder.id());
    assertThat(items.get(1).get("id").asLong()).isEqualTo(named.id());
    assertThat(items.get(1).get("snippet").isNull()).isTrue();
    JsonNode hit = items.get(2);
    assertThat(hit.get("kind").asText()).isEqualTo("FILE");
    assertThat(hit.get("id").asLong()).isEqualTo(body.id());
    assertThat(hit.get("name").asText()).isEqualTo("보고서.txt");
    assertThat(hit.get("folderId").asLong()).isEqualTo(folder.id());
    assertThat(hit.get("folderPath").asText()).isEqualTo("폴더-" + word);
    // 줄바꿈은 한 칸 공백으로 펴고, 짧은 본문은 자르지 않아 「…」가 없다.
    assertThat(hit.get("snippet").asText()).isEqualTo("첫 줄 둘째 줄에 " + word + " 이 들어 있다");
  }

  @Test
  void searchDrive_nameAndBodyMatch_listedOnce() throws Exception {
    DriveFileResponse both = file(me, mySpace, null, word + "-둘다.txt");
    extracted(both, "본문에도 " + word + " 가 있다");

    JsonNode items = search(me, word, null, null).get("items");

    assertThat(items).hasSize(1);
    assertThat(items.get(0).get("id").asLong()).isEqualTo(both.id());
    // 이름 쪽 결과로 나와 발췌가 없다.
    assertThat(items.get(0).get("snippet").isNull()).isTrue();
  }

  @Test
  void searchDrive_bodyMatch_excludesOtherSpacesAndTrash() throws Exception {
    long theirs = spaceService.createTeamSpace(other, "남의공간-" + word).id();
    extracted(file(other, theirs, null, "남의.txt"), "비밀 " + word);
    DriveFileResponse gone = file(me, mySpace, null, "지운.txt");
    extracted(gone, "지운 " + word);
    DriveFolderResponse trashed = folderService.create(me, mySpace, null, "휴지통행");
    extracted(file(me, mySpace, trashed.id(), "안쪽.txt"), "안쪽 " + word);
    DriveFileResponse live = file(me, mySpace, null, "산.txt");
    extracted(live, "살아 있는 " + word);
    fileService.delete(me, gone.id());
    folderService.delete(me, trashed.id());

    JsonNode items = search(me, word, null, null).get("items");

    assertThat(items).hasSize(1);
    assertThat(items.get(0).get("id").asLong()).isEqualTo(live.id());
  }

  @Test
  void searchDrive_bodyWildcardIsEscaped() throws Exception {
    DriveFileResponse percent = file(me, mySpace, null, "할인.txt");
    extracted(percent, word + " 할인 5% 적용");
    extracted(file(me, mySpace, null, "개수.txt"), word + " 50 개");
    DriveFileResponse underscore = file(me, mySpace, null, "변수.txt");
    extracted(underscore, word + " a_b 변수");
    extracted(file(me, mySpace, null, "글자.txt"), word + " axb 글자");

    // 「%」·「_」 는 글자 그대로 — 「50」·「axb」 와 맞지 않는다.
    JsonNode p = search(me, "5%", null, null).get("items");
    assertThat(p).hasSize(1);
    assertThat(p.get(0).get("id").asLong()).isEqualTo(percent.id());
    JsonNode u = search(me, "a_b", null, null).get("items");
    assertThat(u).hasSize(1);
    assertThat(u.get(0).get("id").asLong()).isEqualTo(underscore.id());
  }

  @Test
  void searchDrive_longBodySnippetIsWindowedWithEllipsis() throws Exception {
    DriveFileResponse f = file(me, mySpace, null, "긴글.txt");
    String filler = "가".repeat(500);
    extracted(f, filler + " " + word + " " + filler);

    String snippet = search(me, word, null, null).get("items").get(0).get("snippet").asText();

    // 맞은 곳 앞뒤로 잘려 양쪽에 「…」, 맞은 낱말이 들어 있고, 긴 본문 전체가 오지 않는다.
    assertThat(snippet).startsWith("…").endsWith("…").contains(word);
    assertThat(snippet.length()).isLessThan(200);
  }

  @Test
  void searchDrive_pagesAcrossNameAndBodyHits() throws Exception {
    DriveFileResponse named = file(me, mySpace, null, word + ".txt");
    DriveFileResponse b1 = file(me, mySpace, null, "가.txt");
    extracted(b1, word);
    DriveFileResponse b2 = file(me, mySpace, null, "나.txt");
    extracted(b2, word);

    JsonNode p1 = search(me, word, 0, 2);
    assertThat(p1.get("items")).hasSize(2);
    assertThat(p1.get("items").get(0).get("id").asLong()).isEqualTo(named.id());
    assertThat(p1.get("items").get(1).get("id").asLong()).isEqualTo(b1.id());
    assertThat(p1.get("hasMore").asBoolean()).isTrue();
    JsonNode p2 = search(me, word, 2, 2);
    assertThat(p2.get("items")).hasSize(1);
    assertThat(p2.get("items").get(0).get("id").asLong()).isEqualTo(b2.id());
    assertThat(p2.get("hasMore").asBoolean()).isFalse();
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
    assertThat(second.get("folderPath").asText()).isEqualTo("프로젝트/문서");
  }

  @Test
  void searchDrive_rootItemHasEmptyPath() throws Exception {
    file(me, mySpace, null, word + ".txt");
    JsonNode item = search(me, word, null, null).get("items").get(0);
    assertThat(item.get("folderId").isNull()).isTrue();
    assertThat(item.get("folderPath").asText()).isEmpty();
  }

  @Test
  void searchDrive_wildcardIsEscaped() throws Exception {
    file(me, mySpace, null, "a_" + word + ".txt");
    file(me, mySpace, null, "ab" + word + ".txt");

    JsonNode items = search(me, "a_", null, null).get("items");

    // 「_」 는 글자 그대로 — 「ab…」 와 맞지 않는다.
    assertThat(items).hasSize(1);
    assertThat(items.get(0).get("name").asText()).isEqualTo("a_" + word + ".txt");
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
