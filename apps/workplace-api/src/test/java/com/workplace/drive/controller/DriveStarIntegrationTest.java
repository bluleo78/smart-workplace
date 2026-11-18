package com.workplace.drive.controller;

import static com.workplace.jooq.Tables.DRIVE_FILE;
import static com.workplace.jooq.Tables.DRIVE_FOLDER;
import static com.workplace.jooq.Tables.DRIVE_SPACE;
import static com.workplace.jooq.Tables.DRIVE_SPACE_MEMBER;
import static com.workplace.jooq.Tables.DRIVE_SPACE_MEMBER_GROUP;
import static com.workplace.jooq.Tables.DRIVE_STAR;
import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_GROUP;
import static com.workplace.jooq.Tables.USER_GROUP_MEMBER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.drive.service.DriveFileService;
import com.workplace.drive.service.DriveFolderService;
import com.workplace.drive.service.DriveTrashService;
import com.workplace.file.storage.FileStore;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * 드라이브 「별표」(WP-1698) 통합 테스트 — PUT/DELETE /drive/stars 로 넣고 빼고, GET /drive/starred 로 내 목록을 읽는다. 공간
 * 폴더 목록 행의 starred 도 본다.
 *
 * <p>규칙: 별표는 권한을 주지 않는다 — 넣을 때 볼 수 없는 항목은 없는 항목과 같은 404, 목록은 읽을 때마다 공간 실효 멤버·휴지통으로 다시 거른다(행은 지우지 않아
 * 다시 볼 수 있게 되면 돌아온다). {@code @Transactional}: 끝나면 롤백된다. 한 트랜잭션 안이라 now() 가 고정돼 별표 시각이 모두 같으므로, 순서
 * 확인은 시각을 직접 고쳐 둔다.
 */
@Transactional
class DriveStarIntegrationTest extends IntegrationTestBase {
  @Autowired MockMvc mockMvc;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwtTokenProvider;
  @Autowired ObjectMapper objectMapper;
  @Autowired DriveFileService fileService;
  @Autowired DriveFolderService folderService;
  @Autowired DriveTrashService trashService;
  @Autowired FileStore fileStore;

  private long owner; // 공간 주인
  private long member; // 공간 VIEWER — 별표하는 사람
  private long outsider; // 같은 워크스페이스, 공간 구성원 아님
  private long spaceId;
  private long fileId;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    owner = withMembership(seedUser("김민수"));
    member = withMembership(seedUser("별표하는이"));
    outsider = withMembership(seedUser("바깥사람"));
    spaceId = seedSpace(owner, "경영지원");
    addMember(spaceId, member, "VIEWER");
    fileId = seedFile(spaceId, null, "사업계획.pdf");
  }

  // --- 넣기·빼기 ---

  @Test
  void 별표를_두_번_넣어도_행은_하나이고_빼면_없어지며_없는_별표_빼기도_204() throws Exception {
    star(member, "FILE", fileId).andExpect(status().isNoContent());
    star(member, "FILE", fileId).andExpect(status().isNoContent());
    assertThat(starCount(member)).isEqualTo(1);

    unstar(member, "FILE", fileId).andExpect(status().isNoContent());
    assertThat(starCount(member)).isZero();
    // 없는 별표·없는 항목을 빼도 조용히 204
    unstar(member, "FILE", fileId).andExpect(status().isNoContent());
    unstar(member, "FOLDER", 999_999_999L).andExpect(status().isNoContent());
  }

  @Test
  void 폴더에도_별표하고_파일과_폴더는_따로_센다() throws Exception {
    long folderId = seedFolder(spaceId, null, "분기 보고");
    star(member, "FOLDER", folderId).andExpect(status().isNoContent());
    star(member, "FILE", fileId).andExpect(status().isNoContent());
    star(member, "FOLDER", folderId).andExpect(status().isNoContent());
    assertThat(starCount(member)).isEqualTo(2);
  }

  @Test
  void kind_누락_잘못된_값은_400() throws Exception {
    call(put("/api/v1/drive/stars").content("{\"id\":" + fileId + "}"), member)
        .andExpect(status().isBadRequest());
    call(put("/api/v1/drive/stars").content("{\"kind\":\"FILEX\",\"id\":" + fileId + "}"), member)
        .andExpect(status().isBadRequest());
    call(put("/api/v1/drive/stars").content("{\"kind\":\"FILE\"}"), member)
        .andExpect(status().isBadRequest());
    assertThat(starCount(member)).isZero();
  }

  @Test
  void 볼_수_없는_파일은_없는_파일과_같은_404_본문() throws Exception {
    JsonNode hidden = errorBody(star(outsider, "FILE", fileId).andExpect(status().isNotFound()));
    JsonNode absent =
        errorBody(star(outsider, "FILE", 999_999_999L).andExpect(status().isNotFound()));
    assertSameError(hidden, absent);
    assertThat(starCount(outsider)).isZero();
  }

  @Test
  void 볼_수_없는_폴더는_없는_폴더와_같은_404_본문() throws Exception {
    long folderId = seedFolder(spaceId, null, "비공개");
    JsonNode hidden =
        errorBody(star(outsider, "FOLDER", folderId).andExpect(status().isNotFound()));
    JsonNode absent =
        errorBody(star(outsider, "FOLDER", 999_999_999L).andExpect(status().isNotFound()));
    assertSameError(hidden, absent);
  }

  @Test
  void kind_와_id_가_어긋나면_404() throws Exception {
    // 폴더라며 파일 id — 그 id 의 폴더가 없으면 404. 같은 숫자의 폴더가 우연히 있을 수 있어 폴더 id 를 피한 파일 id 를 쓴다.
    long folderId = seedFolder(spaceId, null, "폴더");
    long mismatched = Math.max(fileId, folderId) + 1_000_000L;
    star(member, "FOLDER", mismatched).andExpect(status().isNotFound());
    star(member, "FILE", folderId + 1_000_000L).andExpect(status().isNotFound());
    assertThat(starCount(member)).isZero();
  }

  @Test
  void 휴지통_항목은_별표할_수_없다_404() throws Exception {
    fileService.delete(owner, fileId);
    star(member, "FILE", fileId).andExpect(status().isNotFound());
  }

  @Test
  void 남의_개인_공간_파일은_별표할_수_없다_404() throws Exception {
    long personal = seedPersonalSpace(owner);
    long memo = seedFile(personal, null, "메모.txt");
    star(member, "FILE", memo).andExpect(status().isNotFound());
    // 주인은 된다 — 내 개인 공간 이름은 그대로 「내 드라이브」
    star(owner, "FILE", memo).andExpect(status().isNoContent());
    JsonNode page = listStarred(owner, null);
    assertThat(page.get("items").get(0).get("spaceName").asString()).isEqualTo("내 드라이브");
  }

  @Test
  void 보관된_공간의_항목도_별표할_수_있다() throws Exception {
    dsl.update(DRIVE_SPACE)
        .set(DRIVE_SPACE.ARCHIVED_AT, OffsetDateTime.now())
        .where(DRIVE_SPACE.ID.eq(spaceId))
        .execute();
    star(member, "FILE", fileId).andExpect(status().isNoContent());
    assertThat(listStarred(member, null).get("items")).hasSize(1);
  }

  // --- 목록 ---

  @Test
  void 목록은_파일_폴더_칸과_경로_공간을_싣는다() throws Exception {
    long reports = seedFolder(spaceId, null, "보고");
    long q1 = seedFolder(spaceId, reports, "1분기");
    seedFolder(spaceId, q1, "하위");
    seedFile(spaceId, q1, "a.txt");
    long trashedChild = seedFile(spaceId, q1, "지움.txt");
    long deep = seedFile(spaceId, q1, "실적.pdf");
    fileService.delete(owner, trashedChild);
    star(member, "FOLDER", q1).andExpect(status().isNoContent());
    star(member, "FILE", deep).andExpect(status().isNoContent());
    // 파일을 나중에 별표한 것으로 — 목록 첫 줄이 파일
    setStarredAt(member, null, q1, OffsetDateTime.now().minusMinutes(5));

    JsonNode items = listStarred(member, null).get("items");
    assertThat(items).hasSize(2);
    JsonNode file = items.get(0);
    assertThat(file.get("kind").asString()).isEqualTo("FILE");
    assertThat(file.get("id").asLong()).isEqualTo(deep);
    assertThat(file.get("name").asString()).isEqualTo("실적.pdf");
    assertThat(file.get("mimeType").asString()).isEqualTo("application/pdf");
    assertThat(file.get("sizeBytes").asLong()).isEqualTo(4200L);
    assertThat(file.get("fileId").isNull()).isFalse();
    assertThat(file.get("folderCount").isNull()).isTrue();
    assertThat(file.get("parentFolderId").asLong()).isEqualTo(q1);
    assertThat(file.get("path").asString()).isEqualTo("보고/1분기");
    assertThat(file.get("spaceId").asLong()).isEqualTo(spaceId);
    assertThat(file.get("spaceName").asString()).isEqualTo("경영지원");
    assertThat(file.get("starredAt").isNull()).isFalse();

    JsonNode folder = items.get(1);
    assertThat(folder.get("kind").asString()).isEqualTo("FOLDER");
    assertThat(folder.get("id").asLong()).isEqualTo(q1);
    assertThat(folder.get("mimeType").isNull()).isTrue();
    assertThat(folder.get("sizeBytes").isNull()).isTrue();
    // 바로 아래 살아 있는 것만 — 하위 폴더 1, 파일 2(a.txt·실적.pdf, 휴지통 제외)
    assertThat(folder.get("folderCount").asInt()).isEqualTo(1);
    assertThat(folder.get("fileCount").asInt()).isEqualTo(2);
    assertThat(folder.get("parentFolderId").asLong()).isEqualTo(reports);
    assertThat(folder.get("path").asString()).isEqualTo("보고");
  }

  @Test
  void 목록_파일_행은_원본_유무와_버전_수를_싣고_폴더_행은_비운다() throws Exception {
    // 원본이 저장소에 있는 파일 — 공간 폴더 목록과 같은 FileStore 확인이라 available=true
    long present = seedFile(spaceId, null, "있음.pdf");
    String rel = "star-test/" + UUID.randomUUID();
    fileStore.storeBytes(rel, "%PDF".getBytes(StandardCharsets.UTF_8));
    dsl.update(FILE)
        .set(FILE.STORAGE_PATH, rel)
        .where(
            FILE.ID.eq(
                dsl.select(DRIVE_FILE.FILE_ID).from(DRIVE_FILE).where(DRIVE_FILE.ID.eq(present))))
        .execute();
    dsl.update(DRIVE_FILE)
        .set(DRIVE_FILE.VERSION_COUNT, 3)
        .where(DRIVE_FILE.ID.eq(present))
        .execute();
    long folderId = seedFolder(spaceId, null, "보고");
    try {
      // fileId 는 seed 의 저장 경로(/tmp/star-…)에 원본이 없다 — 원본 유실
      star(member, "FILE", fileId).andExpect(status().isNoContent());
      star(member, "FILE", present).andExpect(status().isNoContent());
      star(member, "FOLDER", folderId).andExpect(status().isNoContent());

      JsonNode items = listStarred(member, null).get("items");
      assertThat(items).hasSize(3);
      for (JsonNode it : items) {
        long id = it.get("id").asLong();
        if (it.get("kind").asString().equals("FOLDER")) {
          assertThat(it.get("available").isNull()).isTrue();
          assertThat(it.get("versionCount").isNull()).isTrue();
        } else if (id == present) {
          assertThat(it.get("available").asBoolean()).isTrue();
          assertThat(it.get("versionCount").asInt()).isEqualTo(3);
        } else {
          assertThat(id).isEqualTo(fileId);
          assertThat(it.get("available").asBoolean()).isFalse();
          assertThat(it.get("versionCount").asInt()).isEqualTo(1);
        }
      }
    } finally {
      fileStore.deleteQuietly(rel);
    }
  }

  @Test
  void 같은_시각_별표가_여럿이어도_커서로_빠짐없이_겹침없이_넘긴다() throws Exception {
    // 한 페이지(50)를 넘는 별표 — 시각은 셋으로만 나눠 같은 시각 행이 페이지 경계에 걸치게 한다.
    OffsetDateTime base = OffsetDateTime.now().minusDays(1).truncatedTo(ChronoUnit.MICROS);
    List<Long> ids = new ArrayList<>();
    for (int i = 0; i < 55; i++) {
      long f = seedFile(spaceId, null, "f" + i + ".txt");
      ids.add(f);
      dsl.insertInto(DRIVE_STAR)
          .set(DRIVE_STAR.USER_ID, member)
          .set(DRIVE_STAR.DRIVE_FILE_ID, f)
          .set(DRIVE_STAR.CREATED_AT, base.plusMinutes(i % 3))
          .execute();
    }

    JsonNode first = listStarred(member, null);
    assertThat(first.get("items")).hasSize(50);
    String cursor = first.get("nextCursor").asString();
    assertThat(cursor).isNotBlank();
    JsonNode second = listStarred(member, cursor);
    assertThat(second.get("items")).hasSize(5);
    assertThat(second.get("nextCursor").isNull()).isTrue();

    List<Long> seen = new ArrayList<>();
    List<String> times = new ArrayList<>();
    for (JsonNode page : List.of(first, second)) {
      for (JsonNode n : page.get("items")) {
        seen.add(n.get("id").asLong());
        times.add(n.get("starredAt").asString());
      }
    }
    assertThat(seen).doesNotHaveDuplicates().containsExactlyInAnyOrderElementsOf(ids);
    // 최근 별표 먼저 — 시각이 내림차순
    List<OffsetDateTime> parsed = times.stream().map(OffsetDateTime::parse).toList();
    for (int i = 1; i < parsed.size(); i++) {
      assertThat(parsed.get(i)).isBeforeOrEqualTo(parsed.get(i - 1));
    }
  }

  @Test
  void 잘못된_커서는_400() throws Exception {
    call(get("/api/v1/drive/starred").param("cursor", "아무거나"), member)
        .andExpect(status().isBadRequest());
    call(get("/api/v1/drive/starred").param("cursor", "2026-01-01T00:00:00Z~x"), member)
        .andExpect(status().isBadRequest());
  }

  @Test
  void 파일을_휴지통에_보내면_빠지고_되살리면_돌아온다() throws Exception {
    star(member, "FILE", fileId).andExpect(status().isNoContent());
    fileService.delete(owner, fileId);
    assertThat(listStarred(member, null).get("items")).isEmpty();
    // 행은 남는다
    assertThat(starCount(member)).isEqualTo(1);

    trashService.restoreFile(owner, fileId);
    assertThat(listStarred(member, null).get("items")).hasSize(1);
  }

  @Test
  void 폴더를_휴지통에_보내면_하위_파일_별표도_빠지고_되살리면_돌아온다() throws Exception {
    long folderId = seedFolder(spaceId, null, "보고");
    long sub = seedFolder(spaceId, folderId, "하위");
    long inner = seedFile(spaceId, sub, "안쪽.txt");
    star(member, "FILE", inner).andExpect(status().isNoContent());
    star(member, "FOLDER", sub).andExpect(status().isNoContent());

    folderService.delete(owner, folderId);
    assertThat(listStarred(member, null).get("items")).isEmpty();

    trashService.restoreFolder(owner, folderId);
    assertThat(listStarred(member, null).get("items")).hasSize(2);
  }

  @Test
  void 구성원에서_빠지면_안_보이고_다시_들어오면_돌아온다() throws Exception {
    star(member, "FILE", fileId).andExpect(status().isNoContent());
    dsl.deleteFrom(DRIVE_SPACE_MEMBER)
        .where(DRIVE_SPACE_MEMBER.SPACE_ID.eq(spaceId))
        .and(DRIVE_SPACE_MEMBER.USER_ID.eq(member))
        .execute();
    assertThat(listStarred(member, null).get("items")).isEmpty();
    assertThat(starCount(member)).isEqualTo(1);

    addMember(spaceId, member, "VIEWER");
    assertThat(listStarred(member, null).get("items")).hasSize(1);
  }

  @Test
  void 부서로만_들어온_구성원도_별표하고_목록에서_본다() throws Exception {
    long deptMember = withMembership(seedUser("부서원"));
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    long dept = seedDepartment("개발팀-" + suffix);
    long child = seedDepartment("백엔드-" + suffix, dept);
    joinDepartment(child, deptMember);
    // 비멤버일 때는 404
    star(deptMember, "FILE", fileId).andExpect(status().isNotFound());

    dsl.insertInto(DRIVE_SPACE_MEMBER_GROUP)
        .set(DRIVE_SPACE_MEMBER_GROUP.SPACE_ID, spaceId)
        .set(DRIVE_SPACE_MEMBER_GROUP.GROUP_ID, dept)
        .set(DRIVE_SPACE_MEMBER_GROUP.ROLE, "VIEWER")
        .execute();
    star(deptMember, "FILE", fileId).andExpect(status().isNoContent());
    assertThat(listStarred(deptMember, null).get("items")).hasSize(1);

    // 부서에서 빠지면 목록에서 빠진다
    dsl.deleteFrom(USER_GROUP_MEMBER).where(USER_GROUP_MEMBER.GROUP_ID.eq(child)).execute();
    assertThat(listStarred(deptMember, null).get("items")).isEmpty();
  }

  @Test
  void 다른_사람의_별표는_보이지_않고_빼지도_못한다() throws Exception {
    long other = withMembership(seedUser("다른 구성원"));
    addMember(spaceId, other, "VIEWER");
    star(other, "FILE", fileId).andExpect(status().isNoContent());

    assertThat(listStarred(member, null).get("items")).isEmpty();
    // 내가 빼기를 불러도 남의 행은 그대로
    unstar(member, "FILE", fileId).andExpect(status().isNoContent());
    assertThat(starCount(other)).isEqualTo(1);
    assertThat(listStarred(other, null).get("items")).hasSize(1);
  }

  @Test
  void 다른_워크스페이스_컨텍스트에서는_별표가_보이지_않는다_RLS() throws Exception {
    star(member, "FILE", fileId).andExpect(status().isNoContent());
    long otherTenant = ensureFixtureTenant("wp1698-other");
    useTenant(otherTenant);
    assertThat(dsl.fetchCount(DRIVE_STAR)).isZero();
    useTenant(1L);
    assertThat(dsl.fetchCount(DRIVE_STAR)).isEqualTo(1);
  }

  @Test
  void 영구_삭제하면_별표_행도_지워진다() throws Exception {
    long folderId = seedFolder(spaceId, null, "지울 폴더");
    star(member, "FILE", fileId).andExpect(status().isNoContent());
    star(member, "FOLDER", folderId).andExpect(status().isNoContent());

    dsl.deleteFrom(DRIVE_FILE).where(DRIVE_FILE.ID.eq(fileId)).execute();
    dsl.deleteFrom(DRIVE_FOLDER).where(DRIVE_FOLDER.ID.eq(folderId)).execute();

    assertThat(starCount(member)).isZero();
  }

  // --- 공간 폴더 목록 행 ---

  @Test
  void 공간_폴더_목록_행에_내_별표_여부가_실린다() throws Exception {
    long folderId = seedFolder(spaceId, null, "보고");
    long other = seedFile(spaceId, null, "다른.txt");
    star(member, "FILE", fileId).andExpect(status().isNoContent());
    star(member, "FOLDER", folderId).andExpect(status().isNoContent());

    JsonNode items =
        json(
            call(get("/api/v1/drive/spaces/" + spaceId + "/items"), member)
                .andExpect(status().isOk()));
    assertThat(items.get("folders").get(0).get("starred").asBoolean()).isTrue();
    for (JsonNode f : items.get("files")) {
      boolean expected = f.get("id").asLong() == fileId;
      assertThat(f.get("starred").asBoolean()).as("file %s", f.get("id")).isEqualTo(expected);
    }
    assertThat(items.get("files")).anyMatch(f -> f.get("id").asLong() == other);

    // 다른 사람에게는 별표 없음
    JsonNode ownerView =
        json(
            call(get("/api/v1/drive/spaces/" + spaceId + "/items"), owner)
                .andExpect(status().isOk()));
    assertThat(ownerView.get("folders").get(0).get("starred").asBoolean()).isFalse();
  }

  @Test
  void 바인드_한도를_넘는_큰_폴더도_쪽_없이_한_번에_별표_여부를_싣는다() throws Exception {
    // 옛 PostgreSQL 바인드 변수 한도(32767)를 넘는 행 — 별표 여부를 묻는 IN 목록이 id 마다 바인드돼도 깨지지 않음을 지킨다(지금은
    // pgjdbc 한도가 65535 이고, jOOQ 가 방언 한도를 넘는 바인드는 값으로 펼쳐 보낸다). 쿼리는 한 번이다.
    int n = 33_000;
    long big = seedFolder(spaceId, null, "큰폴더");
    String tag = UUID.randomUUID().toString().substring(0, 8);
    dsl.execute(
        "INSERT INTO file (original_name, stored_name, storage_path, mime_type, size_bytes,"
            + " uploaded_by) SELECT 'f' || g || '.txt', 'big-' || ? || '-' || g, '/tmp/big-' ||"
            + " g, 'text/plain', 1, ? FROM generate_series(1, ?) g",
        tag,
        owner,
        n);
    dsl.execute(
        "INSERT INTO drive_file (space_id, folder_id, file_id, name) SELECT ?, ?, id,"
            + " original_name FROM file WHERE stored_name LIKE ?",
        spaceId,
        big,
        "big-" + tag + "-%");
    long starredFile =
        dsl.select(DRIVE_FILE.ID)
            .from(DRIVE_FILE)
            .where(DRIVE_FILE.FOLDER_ID.eq(big))
            .and(DRIVE_FILE.NAME.eq("f777.txt"))
            .fetchOne(DRIVE_FILE.ID);
    star(member, "FILE", starredFile).andExpect(status().isNoContent());

    JsonNode items =
        json(
            call(
                    get("/api/v1/drive/spaces/" + spaceId + "/items").param("parentId", "" + big),
                    member)
                .andExpect(status().isOk()));
    JsonNode files = items.get("files");
    assertThat(files).hasSize(n);
    for (JsonNode f : files) {
      boolean expected = f.get("id").asLong() == starredFile;
      if (f.get("starred").asBoolean() != expected) {
        assertThat(f.get("starred").asBoolean()).as("file %s", f.get("id")).isEqualTo(expected);
      }
    }
  }

  // --- 헬퍼 ---

  private ResultActions star(long userId, String kind, long id) throws Exception {
    return call(put("/api/v1/drive/stars").content(body(kind, id)), userId);
  }

  private ResultActions unstar(long userId, String kind, long id) throws Exception {
    return call(delete("/api/v1/drive/stars").content(body(kind, id)), userId);
  }

  private static String body(String kind, long id) {
    return "{\"kind\":\"" + kind + "\",\"id\":" + id + "}";
  }

  private JsonNode listStarred(long userId, String cursor) throws Exception {
    MockHttpServletRequestBuilder req = get("/api/v1/drive/starred");
    if (cursor != null) req = req.param("cursor", cursor);
    return json(call(req, userId).andExpect(status().isOk()));
  }

  /** 요청 — 본문은 JSON. 요청이 TenantContext 를 비울 수 있어 끝나면 워크스페이스 1 로 되돌린다. */
  private ResultActions call(MockHttpServletRequestBuilder req, long userId) throws Exception {
    req.header(
            "Authorization",
            "Bearer " + jwtTokenProvider.generateAccessToken(userId, "u-" + userId, 1L))
        .contentType(MediaType.APPLICATION_JSON);
    ResultActions r = mockMvc.perform(req);
    TenantContext.set(1L);
    return r;
  }

  private JsonNode json(ResultActions r) throws Exception {
    MvcResult res = r.andReturn();
    return objectMapper.readTree(res.getResponse().getContentAsString(StandardCharsets.UTF_8));
  }

  private JsonNode errorBody(ResultActions r) throws Exception {
    return json(r);
  }

  /** 두 오류 응답이 상태·문구·오류 칸까지 같은지 — 시각·경로는 요청마다 달라 빼고 본다. */
  private static void assertSameError(JsonNode a, JsonNode b) {
    assertThat(a.get("status")).isEqualTo(b.get("status"));
    assertThat(a.get("error")).isEqualTo(b.get("error"));
    assertThat(a.get("message")).isEqualTo(b.get("message"));
    assertThat(a.get("errors")).isEqualTo(b.get("errors"));
  }

  private int starCount(long userId) {
    return dsl.fetchCount(DRIVE_STAR, DRIVE_STAR.USER_ID.eq(userId));
  }

  private void setStarredAt(long userId, Long driveFileId, Long folderId, OffsetDateTime at) {
    dsl.update(DRIVE_STAR)
        .set(DRIVE_STAR.CREATED_AT, at)
        .where(DRIVE_STAR.USER_ID.eq(userId))
        .and(
            driveFileId != null
                ? DRIVE_STAR.DRIVE_FILE_ID.eq(driveFileId)
                : DRIVE_STAR.DRIVE_FOLDER_ID.eq(folderId))
        .execute();
  }

  private long seedUser(String name) {
    long id = TestFixtures.createHuman(dsl);
    dsl.update(USER).set(USER.NAME, name).where(USER.ID.eq(id)).execute();
    return id;
  }

  private long seedSpace(long ownerId, String name) {
    long id =
        dsl.insertInto(DRIVE_SPACE)
            .set(DRIVE_SPACE.TYPE, "TEAM")
            .set(DRIVE_SPACE.NAME, name)
            .set(DRIVE_SPACE.OWNER_ID, ownerId)
            .returning(DRIVE_SPACE.ID)
            .fetchOne()
            .getId();
    addMember(id, ownerId, "OWNER");
    return id;
  }

  private long seedPersonalSpace(long ownerId) {
    long id =
        dsl.insertInto(DRIVE_SPACE)
            .set(DRIVE_SPACE.TYPE, "PERSONAL")
            .set(DRIVE_SPACE.NAME, "내 드라이브")
            .set(DRIVE_SPACE.OWNER_ID, ownerId)
            .returning(DRIVE_SPACE.ID)
            .fetchOne()
            .getId();
    addMember(id, ownerId, "OWNER");
    return id;
  }

  private void addMember(long space, long userId, String role) {
    dsl.insertInto(DRIVE_SPACE_MEMBER)
        .set(DRIVE_SPACE_MEMBER.SPACE_ID, space)
        .set(DRIVE_SPACE_MEMBER.USER_ID, userId)
        .set(DRIVE_SPACE_MEMBER.ROLE, role)
        .execute();
  }

  private long seedDepartment(String name) {
    return seedDepartment(name, null);
  }

  /** 조직도 부서(SHARED 그룹) — parentId 가 있으면 그 아래 하위 부서. */
  private long seedDepartment(String name, Long parentId) {
    return dsl.insertInto(USER_GROUP)
        .set(USER_GROUP.NAME, name)
        .set(USER_GROUP.VISIBILITY, "SHARED")
        .set(USER_GROUP.PARENT_ID, parentId)
        .returning(USER_GROUP.ID)
        .fetchOne()
        .getId();
  }

  private void joinDepartment(long groupId, long userId) {
    dsl.insertInto(USER_GROUP_MEMBER)
        .set(USER_GROUP_MEMBER.GROUP_ID, groupId)
        .set(USER_GROUP_MEMBER.TARGET_TYPE, "MEMBER")
        .set(USER_GROUP_MEMBER.TARGET_ID, userId)
        .execute();
  }

  private long seedFolder(long space, Long parentId, String name) {
    return dsl.insertInto(DRIVE_FOLDER)
        .set(DRIVE_FOLDER.SPACE_ID, space)
        .set(DRIVE_FOLDER.PARENT_ID, parentId)
        .set(DRIVE_FOLDER.NAME, name)
        .returning(DRIVE_FOLDER.ID)
        .fetchOne()
        .getId();
  }

  /** 파일 하나 — folderId 가 null 이면 공간 최상위, 아니면 그 폴더 안. */
  private long seedFile(long space, Long folderId, String name) {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    long coreFileId =
        dsl.insertInto(FILE)
            .set(FILE.ORIGINAL_NAME, name)
            .set(FILE.STORED_NAME, "stored-" + s)
            .set(FILE.STORAGE_PATH, "/tmp/star-" + s)
            .set(FILE.MIME_TYPE, "application/pdf")
            .set(FILE.SIZE_BYTES, 4200L)
            .set(FILE.UPLOADED_BY, owner)
            .returning(FILE.ID)
            .fetchOne()
            .getId();
    return dsl.insertInto(DRIVE_FILE)
        .set(DRIVE_FILE.SPACE_ID, space)
        .set(DRIVE_FILE.FOLDER_ID, folderId)
        .set(DRIVE_FILE.FILE_ID, coreFileId)
        .set(DRIVE_FILE.NAME, name)
        .returning(DRIVE_FILE.ID)
        .fetchOne()
        .getId();
  }
}
