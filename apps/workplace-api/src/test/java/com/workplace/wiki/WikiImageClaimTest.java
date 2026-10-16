package com.workplace.wiki;

import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static com.workplace.jooq.Tables.WIKI_PAGE_ATTACHMENT;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.file.api.StagedFileClaimer;
import com.workplace.file.exception.StagedFileUnusableException;
import com.workplace.file.storage.FileStore;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.wiki.dto.CreatePageRequest;
import com.workplace.wiki.dto.SavePageRequest;
import com.workplace.wiki.dto.WikiAttachmentResponse;
import com.workplace.wiki.service.WikiAttachmentRetentionPolicy;
import com.workplace.wiki.service.WikiPageService;
import com.workplace.wiki.service.WikiSpaceService;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/**
 * 노트 이미지 클레임(WP-424) 통합 테스트 — 먼저 올려 둔 스테이징 파일을 {@code POST /wiki/pages/{id}/attachments/claim} 으로
 * 노트 첨부로 묶는다. 묶인 이미지는 임시로 남고, 본문 저장이 참조해야 영구가 된다.
 *
 * <p>본문 저장은 테스트 프로필에서 동기화 서버가 꺼져 있어 {@code WikiPageService.save(.., ai=true)} 가 같은 호출 안에서 영구화까지
 * 끝낸다. 스테이징 파일은 FILE 행 + 디스크 blob 을 직접 시드한다(매직바이트 판정을 위해 blob 이 필요).
 */
@Transactional
class WikiImageClaimTest extends IntegrationTestBase {

  /** PNG 매직바이트 8 + 채움 8 — ImageSniffer.HEAD_BYTES(16) 판정용. */
  private static final byte[] PNG = {
    (byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0, 0, 0, 0, 0
  };

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwtTokenProvider;
  @Autowired WikiSpaceService spaceService;
  @Autowired WikiPageService pageService;
  @Autowired FileStore fileStore;
  @Autowired StagedFileClaimer claimer;
  @Autowired WikiAttachmentRetentionPolicy retentionPolicy;

  private long ownerId;
  private long viewerId;
  private long pageId;

  @BeforeEach
  void setUp() {
    ownerId = createUser("own");
    viewerId = createUser("vwr");
    long spaceId = spaceService.createTeamSpace(ownerId, "클레임 공간").id();
    spaceService.addMember(ownerId, spaceId, viewerId, "VIEWER");
    pageId = pageService.create(ownerId, spaceId, new CreatePageRequest(null, "클레임 페이지")).id();
  }

  @Test
  void 스테이징_PNG_를_클레임하면_임시로_묶이고_본문이_참조하면_영구() throws Exception {
    long fileId = seedStaged(ownerId, "a.png", PNG, "image/png", PNG.length);

    claim(ownerId, List.of(fileId))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[0].fileId").value(fileId))
        .andExpect(
            jsonPath("$[0].url")
                .value("/api/v1/wiki/pages/" + pageId + "/attachments/" + fileId + "/content"))
        .andExpect(jsonPath("$[0].mimeType").value("image/png"));

    assertThat(boundCount(fileId)).isEqualTo(1);
    assertThat(expiresAtOf(fileId)).isNotNull();

    saveBody("![img](" + WikiAttachmentResponse.urlOf(pageId, fileId) + ")");

    assertThat(expiresAtOf(fileId)).isNull();
  }

  @Test
  void 참조하지_않으면_임시로_남아_만료_뒤_지워진다() throws Exception {
    long fileId = seedStaged(ownerId, "a.png", PNG, "image/png", PNG.length);
    claim(ownerId, List.of(fileId)).andExpect(status().isOk());

    saveBody("이미지를 넣지 않은 본문");

    // 본문이 참조하지 않은 임시 파일은 만료가 그대로 남고, 만료 스윕의 보존 정책도 살리지 않는다.
    assertThat(expiresAtOf(fileId)).isNotNull();
    assertThat(retentionPolicy.retain(List.of(fileId))).isEmpty();
  }

  @Test
  void PDF_는_이미지만_오류_아무것도_묶이지_않음() throws Exception {
    long png = seedStaged(ownerId, "a.png", PNG, "image/png", PNG.length);
    byte[] pdf = "%PDF-1.4 hello world padding".getBytes();
    long doc = seedStaged(ownerId, "doc.pdf", pdf, "application/pdf", pdf.length);

    claim(ownerId, List.of(png, doc))
        .andExpect(status().isBadRequest())
        .andExpect(
            jsonPath("$.message").value("이미지 파일(PNG·JPEG·GIF·WebP)만 노트에 넣을 수 있습니다: doc.pdf"));

    assertThat(boundCount(png)).isZero();
    assertThat(boundCount(doc)).isZero();
  }

  @Test
  void 열_MB_초과_거절() throws Exception {
    long big = seedStaged(ownerId, "big.png", PNG, "image/png", 10L * 1024 * 1024 + 1);

    claim(ownerId, List.of(big))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("파일 크기가 한도를 초과했습니다: 10485761 > 10485760"));

    assertThat(boundCount(big)).isZero();
  }

  @Test
  void 같은_호출_재시도는_성공() throws Exception {
    long fileId = seedStaged(ownerId, "a.png", PNG, "image/png", PNG.length);
    claim(ownerId, List.of(fileId)).andExpect(status().isOk());

    claim(ownerId, List.of(fileId))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[0].fileId").value(fileId))
        .andExpect(jsonPath("$[0].mimeType").value("image/png"));

    assertThat(boundCount(fileId)).isEqualTo(1);
  }

  @Test
  void 이_페이지에_이미_묶인_남의_파일은_거절() throws Exception {
    long other = createUser("oth");
    long fileId = seedStaged(other, "a.png", PNG, "image/png", PNG.length);
    dsl.insertInto(WIKI_PAGE_ATTACHMENT)
        .set(WIKI_PAGE_ATTACHMENT.FILE_ID, fileId)
        .set(WIKI_PAGE_ATTACHMENT.PAGE_ID, pageId)
        .set(WIKI_PAGE_ATTACHMENT.ATTACHED_BY, other)
        .execute();

    claim(ownerId, List.of(fileId)).andExpect(status().isBadRequest());
  }

  @Test
  void VIEWER_는_403() throws Exception {
    long fileId = seedStaged(viewerId, "a.png", PNG, "image/png", PNG.length);

    claim(viewerId, List.of(fileId)).andExpect(status().isForbidden());

    assertThat(boundCount(fileId)).isZero();
  }

  @Test
  void 클레임한_이미지는_메시지로_다시_묶을_수_없다() throws Exception {
    long fileId = seedStaged(ownerId, "a.png", PNG, "image/png", PNG.length);
    claim(ownerId, List.of(fileId)).andExpect(status().isOk());

    // 다른 도메인(메시지·이슈 등)의 클레임은 같은 StagedFileClaimer 를 거친다 — 노트 정션이 lookup 으로 보여 거절된다.
    assertThatThrownBy(
            () -> claimer.claim(ownerId, List.of(fileId), StagedFileClaimer.Retention.PERMANENT))
        .isInstanceOf(StagedFileUnusableException.class);
  }

  @Test
  void MIME_은_스니프_값으로_고쳐진다() throws Exception {
    long fileId = seedStaged(ownerId, "a.bin", PNG, "application/octet-stream", PNG.length);

    claim(ownerId, List.of(fileId))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[0].mimeType").value("image/png"));

    assertThat(mimeOf(fileId)).isEqualTo("image/png");
  }

  // ---------------------------------------------------------------------------------------------

  /** 클레임 호출 — 요청 필터가 지우는 테넌트 컨텍스트를 되돌려 이후 검증 쿼리가 같은 테넌트로 돈다. */
  private org.springframework.test.web.servlet.ResultActions claim(long userId, List<Long> ids)
      throws Exception {
    var result =
        mvc.perform(
            post("/api/v1/wiki/pages/" + pageId + "/attachments/claim")
                .header(
                    "Authorization",
                    "Bearer " + jwtTokenProvider.generateAccessToken(userId, "user-" + userId, 1L))
                .contentType(MediaType.APPLICATION_JSON)
                .content(om.writeValueAsString(Map.of("fileIds", ids))));
    TenantContext.set(1L);
    return result;
  }

  /** 본문 저장(AI 경로) — 동기화 서버가 꺼진 테스트 프로필이라 같은 호출에서 참조 동기화까지 돈다. */
  private void saveBody(String body) {
    int version =
        dsl.select(com.workplace.jooq.Tables.WIKI_PAGE.VERSION)
            .from(com.workplace.jooq.Tables.WIKI_PAGE)
            .where(com.workplace.jooq.Tables.WIKI_PAGE.ID.eq(pageId))
            .fetchOne(com.workplace.jooq.Tables.WIKI_PAGE.VERSION);
    pageService.save(ownerId, pageId, new SavePageRequest(null, body, version, false), true);
  }

  /** 스테이징 파일 시드 — FILE 행(임시 ATTACHMENT) + 디스크 blob. sizeBytes 는 행에만 적용(크기 상한 검증용). */
  private long seedStaged(long uploader, String name, byte[] bytes, String mime, long sizeBytes) {
    String path = "tenant-1/staged/" + UUID.randomUUID();
    fileStore.storeBytes(path, bytes);
    return dsl.insertInto(FILE)
        .set(FILE.ORIGINAL_NAME, name)
        .set(FILE.STORED_NAME, path)
        .set(FILE.STORAGE_PATH, path)
        .set(FILE.MIME_TYPE, mime)
        .set(FILE.SIZE_BYTES, sizeBytes)
        .set(FILE.CATEGORY, "ATTACHMENT")
        .set(FILE.UPLOADED_BY, uploader)
        .set(FILE.EXPIRES_AT, OffsetDateTime.now().plusHours(24))
        .returning(FILE.ID)
        .fetchOne()
        .getId();
  }

  private int boundCount(long fileId) {
    return dsl.fetchCount(WIKI_PAGE_ATTACHMENT, WIKI_PAGE_ATTACHMENT.FILE_ID.eq(fileId));
  }

  private OffsetDateTime expiresAtOf(long fileId) {
    return dsl.select(FILE.EXPIRES_AT)
        .from(FILE)
        .where(FILE.ID.eq(fileId))
        .fetchOne(FILE.EXPIRES_AT);
  }

  private String mimeOf(long fileId) {
    return dsl.select(FILE.MIME_TYPE).from(FILE).where(FILE.ID.eq(fileId)).fetchOne(FILE.MIME_TYPE);
  }

  private long createUser(String prefix) {
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    Long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, prefix + "-" + suffix)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, prefix)
            .set(USER.EMAIL, prefix + "-" + suffix + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    Long roleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("USER")).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE).set(USER_ROLE.USER_ID, id).set(USER_ROLE.ROLE_ID, roleId).execute();
    dsl.insertInto(MEMBERSHIP)
        .set(MEMBERSHIP.USER_ID, id)
        .set(MEMBERSHIP.TENANT_ID, 1L)
        .set(MEMBERSHIP.STATUS, "ACTIVE")
        .execute();
    return id;
  }
}
