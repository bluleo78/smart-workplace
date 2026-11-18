package com.workplace.file.controller;

import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.file.dto.StagedFileResponse;
import com.workplace.file.exception.FileBlobMissingException;
import com.workplace.file.exception.FileSizeLimitExceededException;
import com.workplace.file.service.StagedUploadService;
import com.workplace.file.storage.FileStore;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.global.util.SafeFileNames;
import com.workplace.jooq.tables.records.FileRecord;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.nio.file.Files;
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
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 스테이징 복사 경로(WP-1705) 통합 테스트 — {@code createFromCopy} 의 행·바이트·상한·유실 처리와 {@code POST
 * /staged-files/copy} 의 입력 검증. 출처 도메인 리졸버 구현은 후속 작업이라 여기서는 서비스 직접 호출과 400 경로만 본다.
 *
 * <p>{@code StagedUploadIntegrationTest} 처럼 {@code @Transactional} 을 달지 않고 시드를 커밋한 뒤 {@link
 * #cleanup} 이 정리한다.
 */
class StagedFileCopyIntegrationTest extends IntegrationTestBase {
  @Autowired MockMvc mockMvc;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwtTokenProvider;
  @Autowired StagedUploadService service;
  @Autowired FileStore fileStore;

  private static final byte[] PNG = {(byte) 0x89, 'P', 'N', 'G', 1, 2, 3, 4};

  private final List<Long> userIds = new ArrayList<>();
  private long callerId;
  private long otherId;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    try {
      new TransactionTemplate(txManager)
          .executeWithoutResult(
              st -> {
                callerId = withMembership(TestFixtures.createHuman(dsl));
                otherId = withMembership(TestFixtures.createHuman(dsl));
              });
      userIds.add(callerId);
      userIds.add(otherId);
    } finally {
      TenantContext.clear();
    }
  }

  @AfterEach
  void cleanup() {
    cleanupInTenant(
        1L,
        () -> {
          dsl.deleteFrom(AUDIT_LOG).where(AUDIT_LOG.USER_ID.in(userIds)).execute();
          dsl.deleteFrom(FILE).where(FILE.UPLOADED_BY.in(userIds)).execute();
          dsl.deleteFrom(USER).where(USER.ID.in(userIds)).execute();
        });
    userIds.clear();
  }

  private String bearer(long userId) {
    return "Bearer " + jwtTokenProvider.generateAccessToken(userId, "user-" + userId, 1L);
  }

  /** 원본 FILE 행(다른 사용자 소유, 만료 없음 — 이슈 첨부처럼 이미 클레임된 모양)과 blob 을 시드한다. */
  private long seedFile(
      long uploader, String name, byte[] bytes, String mime, long sizeBytes, boolean withBlob) {
    String storedName = UUID.randomUUID() + name.substring(name.lastIndexOf('.'));
    String path = "tenant-1/issues/" + storedName;
    if (withBlob) {
      fileStore.storeBytes(path, bytes);
    }
    return callInTenant(
        1L,
        () ->
            dsl.insertInto(FILE)
                .set(FILE.ORIGINAL_NAME, name)
                .set(FILE.STORED_NAME, storedName)
                .set(FILE.STORAGE_PATH, path)
                .set(FILE.MIME_TYPE, mime)
                .set(FILE.SIZE_BYTES, sizeBytes)
                .set(FILE.CATEGORY, "ATTACHMENT")
                .set(FILE.UPLOADED_BY, uploader)
                .returning(FILE.ID)
                .fetchOne()
                .getId());
  }

  private long seedFile(long uploader, String name, byte[] bytes, String mime) {
    return seedFile(uploader, name, bytes, mime, bytes.length, true);
  }

  private FileRecord fileRow(long fileId) {
    return callInTenant(1L, () -> dsl.selectFrom(FILE).where(FILE.ID.eq(fileId)).fetchOne());
  }

  private int filesUploadedBy(long userId) {
    return callInTenant(1L, () -> dsl.fetchCount(FILE, FILE.UPLOADED_BY.eq(userId)));
  }

  private StagedFileResponse copyAs(long caller, long src, String name) {
    return callInTenant(1L, () -> service.createFromCopy(caller, src, name, "drive"));
  }

  @Test
  void createFromCopy_는_호출자_소유_임시_ATTACHMENT_새_행을_만들고_바이트가_같다() throws Exception {
    long src = seedFile(otherId, "화면.png", PNG, "image/png");

    StagedFileResponse r = copyAs(callerId, src, null);

    FileRecord row = fileRow(r.fileId());
    assertThat(r.fileId()).isNotEqualTo(src);
    assertThat(row.getUploadedBy()).isEqualTo(callerId);
    assertThat(row.getCategory()).isEqualTo("ATTACHMENT");
    assertThat(row.getExpiresAt()).isNotNull();
    assertThat(row.getExpiresAt()).isAfter(OffsetDateTime.now().plusHours(23));
    assertThat(row.getOriginalName()).isEqualTo("화면.png");
    assertThat(row.getMimeType()).isEqualTo("image/png");
    assertThat(row.getStoragePath())
        .contains("/staged/")
        .endsWith(".png")
        .isNotEqualTo(fileRow(src).getStoragePath());
    assertThat(Files.readAllBytes(fileStore.resolve(row.getStoragePath()))).isEqualTo(PNG);
    // 원본은 그대로
    assertThat(fileRow(src).getUploadedBy()).isEqualTo(otherId);
    assertThat(fileRow(src).getExpiresAt()).isNull();
  }

  @Test
  void createFromCopy_name_을_주면_정리한_그_이름으로_저장한다() {
    long src = seedFile(otherId, "원본.png", PNG, "image/png");

    StagedFileResponse r = copyAs(callerId, src, "a/b.png");

    FileRecord row = fileRow(r.fileId());
    assertThat(row.getOriginalName()).isEqualTo(SafeFileNames.sanitize("a/b.png", "file"));
    assertThat(row.getOriginalName()).doesNotContain("/");
    // 경로 확장자는 원본 stored_name 기준
    assertThat(row.getStoragePath()).endsWith(".png");
  }

  /**
   * 원본 MIME 이 html·xml 계열(svg 포함)이면 복사본은 text/plain — 스테이징 파일이 붙는 첨부 원본 경로에는 CSP sandbox 가 없어 문서로
   * 렌더링되지 않게(텍스트 스테이징과 같은 규칙). 그 밖의 값은 파라미터를 뗀 원본 MIME 그대로.
   */
  @Test
  void createFromCopy_html_svg_xml_계열_MIME_은_text_plain_으로_복사한다() {
    String[][] cases = {
      {"page.html", "text/html", "text/plain"},
      {"pic.svg", "image/svg+xml", "text/plain"},
      {"doc.xhtml", "application/xhtml+xml", "text/plain"},
      {"data.xml", "text/xml; charset=utf-8", "text/plain"},
      {"shot.png", "image/png", "image/png"},
      {"memo.txt", "text/plain; charset=utf-8", "text/plain"},
      {"odd.bin", "*/*", "application/octet-stream"},
    };
    for (String[] c : cases) {
      long src = seedFile(otherId, c[0], PNG, c[1]);
      StagedFileResponse res = copyAs(callerId, src, null);
      assertThat(res.mimeType()).as(c[1]).isEqualTo(c[2]);
      assertThat(fileRow(res.fileId()).getMimeType()).as(c[1]).isEqualTo(c[2]);
    }
  }

  /** 링크 PUT 완료처럼 복사도 감사 로그를 남긴다 — 누가(호출자) 어느 출처의 어느 원본 FILE 을 복사했는지. */
  @Test
  void createFromCopy_는_호출자_출처_원본_id_를_감사_로그에_남긴다() {
    long src = seedFile(otherId, "shot.png", PNG, "image/png");

    StagedFileResponse res = copyAs(callerId, src, null);

    var rows =
        callInTenant(
            1L,
            () ->
                dsl.selectFrom(AUDIT_LOG)
                    .where(AUDIT_LOG.ACTION_TYPE.eq(StagedUploadService.AUDIT_COPY))
                    .and(AUDIT_LOG.RESOURCE_ID.eq(String.valueOf(res.fileId())))
                    .fetch());
    assertThat(rows).hasSize(1);
    assertThat(rows.get(0).getUserId()).isEqualTo(callerId);
    assertThat(rows.get(0).getResult()).isEqualTo("SUCCESS");
    String metadata = rows.get(0).getMetadata().data();
    assertThat(metadata).contains("\"source\": \"drive\"").contains("\"sourceFileId\": " + src);
  }

  @Test
  void createFromCopy_25MB_초과면_400_행이_남지_않는다() {
    long src = seedFile(otherId, "big.bin", PNG, "application/octet-stream", 26214401L, true);

    assertThatThrownBy(() -> copyAs(callerId, src, null))
        .isInstanceOf(FileSizeLimitExceededException.class);
    assertThat(filesUploadedBy(callerId)).isZero();
  }

  @Test
  void createFromCopy_원본_blob_이_없으면_FileBlobMissingException_행이_남지_않는다() {
    long src = seedFile(otherId, "lost.png", PNG, "image/png", PNG.length, false);

    assertThatThrownBy(() -> copyAs(callerId, src, null))
        .isInstanceOf(FileBlobMissingException.class);
    assertThat(filesUploadedBy(callerId)).isZero();
  }

  @Test
  void copy_모르는_source_는_400() throws Exception {
    mockMvc
        .perform(
            post("/api/v1/staged-files/copy")
                .header("Authorization", bearer(callerId))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"source\":\"wiki\",\"attachmentId\":1}"))
        .andExpect(status().isBadRequest());
    assertThat(filesUploadedBy(callerId)).isZero();
  }

  @Test
  void copy_source_없으면_400() throws Exception {
    mockMvc
        .perform(
            post("/api/v1/staged-files/copy")
                .header("Authorization", bearer(callerId))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{}"))
        .andExpect(status().isBadRequest());
  }
}
