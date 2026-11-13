package com.workplace.drive.controller;

import static com.workplace.jooq.Tables.DRIVE_FILE;
import static com.workplace.jooq.Tables.DRIVE_FOLDER;
import static com.workplace.jooq.Tables.DRIVE_SHARE_LINK;
import static com.workplace.jooq.Tables.DRIVE_SHARE_LINK_VISIT;
import static com.workplace.jooq.Tables.DRIVE_SPACE;
import static com.workplace.jooq.Tables.DRIVE_SPACE_MEMBER;
import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.drive.dto.CreateShareLinkRequest;
import com.workplace.drive.exception.DriveForbiddenException;
import com.workplace.drive.repository.DriveShareLinkVisitRepository;
import com.workplace.drive.service.DriveShareLinkService;
import com.workplace.drive.service.DriveSharedWithMeService;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.global.util.CapabilityTokens;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.OffsetDateTime;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.annotation.Transactional;

/**
 * 「공유받은 항목」(WP-1539) 통합 테스트 — 공유 정보 조회(GET /public/drive/share/{token})가 기록하고, GET/DELETE
 * /drive/shared-with-me 가 내 목록을 보이고 숨긴다.
 *
 * <p>기록 규칙: 로그인한 같은 워크스페이스 사람이 사내 링크를 열 때만(비밀번호 링크는 잠금 해제 뒤). 외부 링크·내가 만든 링크·이미 구성원인 공간은 기록하지 않는다.
 * 목록은 읽을 때 다시 구성원 여부를 보고, 폐기·만료·휴지통은 「열 수 없음」. {@code @Transactional}: 끝나면 롤백된다 — 한 트랜잭션 안이라 now()
 * 가 고정돼, 「다시 열면 갱신」은 마지막으로 연 시각을 과거로 돌려 놓고 확인한다.
 */
@Transactional
class DriveSharedWithMeIntegrationTest extends IntegrationTestBase {
  @Autowired MockMvc mockMvc;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwtTokenProvider;
  @Autowired ObjectMapper objectMapper;
  @Autowired DriveShareLinkService shareLinks;
  @Autowired DriveSharedWithMeService sharedWithMe;

  private long owner; // 링크를 만든 사람(공간 주인)
  private long outsider; // 같은 워크스페이스, 공간 구성원 아님 — 기록 대상
  private long member; // 공간 VIEWER
  private long spaceId;
  private long fileId;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    owner = withMembership(seedUser("김민수"));
    outsider = withMembership(seedUser("받는이"));
    member = withMembership(seedUser("구성원"));
    spaceId = seedSpace(owner, "경영지원");
    addMember(spaceId, member, "VIEWER");
    fileId = seedFile(spaceId, "2026 하반기 사업계획.pptx");
  }

  @Test
  void 사내_링크를_처음_열면_목록에_들어간다_파일_공간_공유한_사람_토큰() throws Exception {
    String token = link("INTERNAL", null);

    openShare(token, outsider).andExpect(status().isOk());

    mockMvc
        .perform(get("/api/v1/drive/shared-with-me").header("Authorization", bearer(outsider)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$", hasSize(1)))
        .andExpect(jsonPath("$[0].shareLinkId").value(linkId(token)))
        .andExpect(jsonPath("$[0].kind").value("FILE"))
        .andExpect(jsonPath("$[0].name").value("2026 하반기 사업계획.pptx"))
        .andExpect(jsonPath("$[0].mimeType").value("application/pdf"))
        .andExpect(jsonPath("$[0].sizeBytes").value(4200000))
        .andExpect(jsonPath("$[0].spaceName").value("경영지원"))
        .andExpect(jsonPath("$[0].sharedBy").value("김민수"))
        .andExpect(jsonPath("$[0].openable").value(true))
        .andExpect(jsonPath("$[0].hasPassword").value(false))
        .andExpect(jsonPath("$[0].token").value(token))
        .andExpect(jsonPath("$[0].lastOpenedAt").isNotEmpty());
  }

  @Test
  void 다시_열면_마지막으로_연_시각이_갱신되고_목록에서_뺀_것이_돌아온다() throws Exception {
    String token = link("INTERNAL", null);
    openShare(token, outsider).andExpect(status().isOk());
    long id = linkId(token);
    // Postgres timestamptz 는 마이크로초까지라 나노초를 잘라 둔다 — 아니면 되읽은 값과 비교가 시계에 따라 어긋난다.
    OffsetDateTime past = OffsetDateTime.now().minusDays(3).truncatedTo(ChronoUnit.MICROS);
    dsl.update(DRIVE_SHARE_LINK_VISIT)
        .set(DRIVE_SHARE_LINK_VISIT.LAST_OPENED_AT, past)
        .set(DRIVE_SHARE_LINK_VISIT.FIRST_OPENED_AT, past)
        .where(DRIVE_SHARE_LINK_VISIT.SHARE_LINK_ID.eq(id))
        .execute();
    mockMvc
        .perform(
            delete("/api/v1/drive/shared-with-me/" + id).header("Authorization", bearer(outsider)))
        .andExpect(status().isNoContent());
    assertThat(sharedWithMe.list(outsider)).isEmpty();

    // 목록에서 빼도 링크 권한은 그대로 — 다시 열린다
    openShare(token, outsider).andExpect(status().isOk());

    var row =
        dsl.selectFrom(DRIVE_SHARE_LINK_VISIT)
            .where(DRIVE_SHARE_LINK_VISIT.SHARE_LINK_ID.eq(id))
            .fetchOne();
    assertThat(row.getHiddenAt()).isNull();
    assertThat(row.getLastOpenedAt()).isAfter(past);
    assertThat(row.getFirstOpenedAt().toInstant()).isEqualTo(past.toInstant());
    assertThat(sharedWithMe.list(outsider)).hasSize(1);
  }

  @Test
  void 외부_링크_내가_만든_링크_구성원인_공간은_기록하지_않는다() throws Exception {
    String external = link("EXTERNAL", null);
    String internal = link("INTERNAL", null);

    openShare(external, outsider).andExpect(status().isOk());
    openShare(internal, owner).andExpect(status().isOk());
    openShare(internal, member).andExpect(status().isOk());

    assertThat(visitCount()).isZero();
  }

  /**
   * 폴더 공유 링크(WP-1538)는 공유받은 항목에 아직 기록하지 않는다 — 목록이 파일 행만 다루므로(폴더 지원은 WP-1540) 기록하면 빈 행이 생긴다. 폴더 링크를
   * 열어도 공유 화면은 그대로 열리고, 목록은 파일 링크 행만 깨지지 않고 보인다.
   */
  @Test
  void 사내_폴더_링크를_열어도_기록하지_않고_목록은_파일_행만_그대로다() throws Exception {
    long folderId =
        dsl.insertInto(DRIVE_FOLDER)
            .set(DRIVE_FOLDER.SPACE_ID, spaceId)
            .set(DRIVE_FOLDER.NAME, "분기 보고")
            .returning(DRIVE_FOLDER.ID)
            .fetchOne()
            .getId();
    String folderToken =
        shareLinks
            .create(
                owner,
                new DriveShareLinkService.Target.Folder(folderId),
                new CreateShareLinkRequest("INTERNAL", null, null))
            .token();
    String fileToken = link("INTERNAL", null);

    openShare(folderToken, outsider)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.kind").value("FOLDER"))
        .andExpect(jsonPath("$.name").value("분기 보고"));
    assertThat(visitCount()).isZero();

    openShare(fileToken, outsider).andExpect(status().isOk());
    mockMvc
        .perform(get("/api/v1/drive/shared-with-me").header("Authorization", bearer(outsider)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$", hasSize(1)))
        .andExpect(jsonPath("$[0].shareLinkId").value(linkId(fileToken)))
        .andExpect(jsonPath("$[0].name").value("2026 하반기 사업계획.pptx"));
  }

  @Test
  void 비밀번호_링크는_잠금_해제_뒤에_열어야_기록된다() throws Exception {
    String token = link("INTERNAL", "secret");

    openShare(token, outsider).andExpect(jsonPath("$.passwordRequired").value(true));
    assertThat(visitCount()).isZero();

    String body =
        mockMvc
            .perform(
                post("/api/v1/public/drive/share/" + token + "/unlock")
                    .header("Authorization", bearer(outsider))
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("{\"password\":\"secret\"}"))
            .andExpect(status().isOk())
            .andReturn()
            .getResponse()
            .getContentAsString();
    String viewToken = objectMapper.readTree(body).get("viewToken").asText();
    mockMvc
        .perform(
            get("/api/v1/public/drive/share/" + token)
                .header("Authorization", bearer(outsider))
                .header(PublicDriveShareController.VIEW_TOKEN_HEADER, viewToken))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.name").value("2026 하반기 사업계획.pptx"));

    var items = sharedWithMe.list(outsider);
    assertThat(items).hasSize(1);
    assertThat(items.get(0).hasPassword()).isTrue();
    assertThat(items.get(0).token()).isEqualTo(token);
  }

  @Test
  void 다른_워크스페이스는_기록되지_않고_남의_워크스페이스_기록도_보이지_않는다() {
    String token = link("INTERNAL", null);
    long otherTenant = ensureFixtureTenant("wp1539-other");

    // 다른 워크스페이스 요청은 사내 링크에서 403 — 기록 없음
    assertThatThrownBy(() -> shareLinks.info(token, null, otherTenant, outsider))
        .isInstanceOf(DriveForbiddenException.class);
    assertThat(visitCount()).isZero();

    // 워크스페이스 1 에서 남긴 기록은 다른 워크스페이스 컨텍스트에서 보이지 않는다(RLS)
    shareLinks.info(token, null, 1L, outsider);
    assertThat(sharedWithMe.list(outsider)).hasSize(1);
    useTenant(otherTenant);
    assertThat(sharedWithMe.list(outsider)).isEmpty();
    useTenant(1L);
  }

  @Test
  void 폐기_만료_휴지통은_열_수_없음으로_남고_토큰을_싣지_않는다() throws Exception {
    String revoked = link("INTERNAL", null);
    String expired = link("INTERNAL", null);
    long trashedFile = seedFile(spaceId, "보안 점검 체크리스트.xlsx");
    String trashed = linkOf(trashedFile, "INTERNAL");
    for (String t : new String[] {revoked, expired, trashed}) {
      openShare(t, outsider).andExpect(status().isOk());
    }
    shareLinks.revoke(owner, linkId(revoked));
    dsl.update(DRIVE_SHARE_LINK)
        .set(DRIVE_SHARE_LINK.EXPIRES_AT, OffsetDateTime.now().minusDays(1))
        .where(DRIVE_SHARE_LINK.ID.eq(linkId(expired)))
        .execute();
    dsl.update(DRIVE_FILE)
        .set(DRIVE_FILE.TRASHED_AT, OffsetDateTime.now())
        .where(DRIVE_FILE.ID.eq(trashedFile))
        .execute();

    String body =
        mockMvc
            .perform(get("/api/v1/drive/shared-with-me").header("Authorization", bearer(outsider)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$", hasSize(3)))
            .andExpect(jsonPath("$[0].token").value(nullValue()))
            .andReturn()
            .getResponse()
            .getContentAsString();
    for (JsonNode n : objectMapper.readTree(body)) {
      assertThat(n.get("openable").asBoolean()).isFalse();
      assertThat(n.get("token").isNull()).isTrue();
    }

    // 열 수 없는 행도 목록에서 뺄 수 있다
    sharedWithMe.hide(outsider, linkId(revoked));
    assertThat(sharedWithMe.list(outsider)).hasSize(2);
  }

  @Test
  void 나중에_공간_구성원이_되면_목록에서_빠진다() throws Exception {
    String token = link("INTERNAL", null);
    openShare(token, outsider).andExpect(status().isOk());
    assertThat(sharedWithMe.list(outsider)).hasSize(1);

    addMember(spaceId, outsider, "VIEWER");

    assertThat(sharedWithMe.list(outsider)).isEmpty();
  }

  @Test
  void 목록에서_빼기는_내_행만_숨기고_없는_행도_204() throws Exception {
    String token = link("INTERNAL", null);
    long other = withMembership(seedUser("다른 받는이"));
    openShare(token, outsider).andExpect(status().isOk());
    openShare(token, other).andExpect(status().isOk());

    mockMvc
        .perform(
            delete("/api/v1/drive/shared-with-me/" + linkId(token))
                .header("Authorization", bearer(outsider)))
        .andExpect(status().isNoContent());
    mockMvc
        .perform(
            delete("/api/v1/drive/shared-with-me/999999999")
                .header("Authorization", bearer(outsider)))
        .andExpect(status().isNoContent());

    assertThat(sharedWithMe.list(outsider)).isEmpty();
    assertThat(sharedWithMe.list(other)).hasSize(1);
  }

  @Test
  void 남의_개인_공간은_주인_이름의_드라이브로_보인다() throws Exception {
    long personal =
        dsl.insertInto(DRIVE_SPACE)
            .set(DRIVE_SPACE.TYPE, "PERSONAL")
            .set(DRIVE_SPACE.NAME, "내 드라이브")
            .set(DRIVE_SPACE.OWNER_ID, owner)
            .returning(DRIVE_SPACE.ID)
            .fetchOne()
            .getId();
    addMember(personal, owner, "OWNER");
    String token = linkOf(seedFile(personal, "메모.txt"), "INTERNAL");
    openShare(token, outsider).andExpect(status().isOk());

    assertThat(sharedWithMe.list(outsider).get(0).spaceName()).isEqualTo("김민수의 드라이브");
  }

  @Test
  void 목록은_최근에_연_것부터_상한까지만_돌려준다() {
    int limit = DriveShareLinkVisitRepository.LIST_LIMIT;
    OffsetDateTime base = OffsetDateTime.now().minusDays(1);
    long oldestLinkId = 0;
    // 상한보다 하나 많이 — 링크·기록을 직접 넣는다(서비스로 만들면 느리다). i 가 클수록 최근에 열었다.
    for (int i = 0; i <= limit; i++) {
      long id =
          dsl.insertInto(DRIVE_SHARE_LINK)
              .set(DRIVE_SHARE_LINK.DRIVE_FILE_ID, fileId)
              .set(DRIVE_SHARE_LINK.SPACE_ID, spaceId)
              .set(
                  DRIVE_SHARE_LINK.TOKEN_HASH,
                  CapabilityTokens.sha256Hex("cap-" + UUID.randomUUID()))
              .set(DRIVE_SHARE_LINK.AUDIENCE, "INTERNAL")
              .set(DRIVE_SHARE_LINK.CREATED_BY, owner)
              .returning(DRIVE_SHARE_LINK.ID)
              .fetchOne()
              .getId();
      if (i == 0) oldestLinkId = id;
      dsl.insertInto(DRIVE_SHARE_LINK_VISIT)
          .set(DRIVE_SHARE_LINK_VISIT.USER_ID, outsider)
          .set(DRIVE_SHARE_LINK_VISIT.SHARE_LINK_ID, id)
          .set(DRIVE_SHARE_LINK_VISIT.LAST_OPENED_AT, base.plusMinutes(i))
          .execute();
    }

    var items = sharedWithMe.list(outsider);
    assertThat(items).hasSize(limit);
    long excluded = oldestLinkId;
    assertThat(items).noneMatch(it -> it.shareLinkId() == excluded);
    // 토큰 암호문이 없는 행은 열 수 있어도 토큰이 없다(화면은 「링크를 열 수 없습니다」)
    assertThat(items.get(0).openable()).isTrue();
    assertThat(items.get(0).token()).isNull();
  }

  // --- 헬퍼 ---

  private ResultActions openShare(String token, long userId) throws Exception {
    return mockMvc.perform(
        get("/api/v1/public/drive/share/" + token).header("Authorization", bearer(userId)));
  }

  private String bearer(long userId) {
    return "Bearer " + jwtTokenProvider.generateAccessToken(userId, "user-" + userId, 1L);
  }

  private String link(String audience, String password) {
    return shareLinks
        .create(owner, fileId, new CreateShareLinkRequest(audience, password, null))
        .token();
  }

  private String linkOf(long driveFileId, String audience) {
    return shareLinks
        .create(owner, driveFileId, new CreateShareLinkRequest(audience, null, null))
        .token();
  }

  private long linkId(String token) {
    return dsl.select(DRIVE_SHARE_LINK.ID)
        .from(DRIVE_SHARE_LINK)
        .where(DRIVE_SHARE_LINK.TOKEN_HASH.eq(CapabilityTokens.sha256Hex(token)))
        .fetchOne(DRIVE_SHARE_LINK.ID);
  }

  private int visitCount() {
    return dsl.fetchCount(DRIVE_SHARE_LINK_VISIT);
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

  private void addMember(long space, long userId, String role) {
    dsl.insertInto(DRIVE_SPACE_MEMBER)
        .set(DRIVE_SPACE_MEMBER.SPACE_ID, space)
        .set(DRIVE_SPACE_MEMBER.USER_ID, userId)
        .set(DRIVE_SPACE_MEMBER.ROLE, role)
        .execute();
  }

  private long seedFile(long space, String name) {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    long coreFileId =
        dsl.insertInto(FILE)
            .set(FILE.ORIGINAL_NAME, name)
            .set(FILE.STORED_NAME, "stored-" + s)
            .set(FILE.STORAGE_PATH, "/tmp/swm-" + s)
            .set(FILE.MIME_TYPE, "application/pdf")
            .set(FILE.SIZE_BYTES, 4200000L)
            .set(FILE.UPLOADED_BY, owner)
            .returning(FILE.ID)
            .fetchOne()
            .getId();
    return dsl.insertInto(DRIVE_FILE)
        .set(DRIVE_FILE.SPACE_ID, space)
        .set(DRIVE_FILE.FILE_ID, coreFileId)
        .set(DRIVE_FILE.NAME, name)
        .returning(DRIVE_FILE.ID)
        .fetchOne()
        .getId();
  }
}
