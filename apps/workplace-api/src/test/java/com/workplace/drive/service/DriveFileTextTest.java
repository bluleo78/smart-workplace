package com.workplace.drive.service;

import static com.workplace.jooq.Tables.DRIVE_FILE;
import static com.workplace.jooq.Tables.DRIVE_SPACE;
import static com.workplace.jooq.Tables.DRIVE_SPACE_MEMBER;
import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.FILE_EXTRACTION;
import static com.workplace.jooq.Tables.TENANT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.drive.exception.DriveFileNotFoundException;
import com.workplace.drive.exception.DriveSpaceNotFoundException;
import com.workplace.fileai.dto.ExtractedTextSlice;
import com.workplace.fileai.dto.ViewImage;
import com.workplace.fileai.exception.InvalidTextRangeException;
import com.workplace.fileai.outbound.WorkerRenderClient;
import com.workplace.fileai.service.ExtractedTextService;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 드라이브 파일 추출 텍스트 구간 읽기(WP-346) 통합 테스트 — 권한(비멤버 존재 은닉)·추출 상태별 응답·구간 읽기·limit 클램프.
 *
 * <p>요약 읽기 테스트({@link DriveFileSummaryServiceTest})와 같은 이유로 클래스 레벨 {@code @Transactional} 을 두지 않고
 * 세션 기본 테넌트(1)와 다른 fixture 테넌트에 커밋해, {@link DriveFileService#readText} 의
 * {@code @Transactional(readOnly = true)} 가 빠지면 RLS 로 red 가 되게 한다.
 */
class DriveFileTextTest extends IntegrationTestBase {

  private static final String FIXTURE_TENANT_SLUG = "drive-text-rls-fixture-tenant";

  @Autowired DSLContext dsl;
  @Autowired DriveFileService fileService;
  @Autowired PlatformTransactionManager txManager;
  @Autowired MockMvc mvc;
  @Autowired JwtTokenProvider jwtTokenProvider;

  /** WP-250: /view 의 워커 렌더 호출 목 — 실제 워커 없이 권한·헤더·쪽수 보충을 검증한다. */
  @MockitoBean WorkerRenderClient worker;

  // @AfterEach 정리용 — 시드에서 채운다.
  private Long tid2;
  private Long memberId;
  private Long outsiderId;
  private Long spaceId;
  private Long fileIdCore;
  private Long driveFileId;
  private boolean hasExtraction;

  @Test
  void 비멤버는_존재_은닉으로_거부된다() {
    seedFixture("DONE", null, "비밀 본문");

    TenantContext.set(tid2);
    assertThatThrownBy(() -> fileService.readText(outsiderId, driveFileId, 0, 100))
        .isInstanceOf(DriveSpaceNotFoundException.class);
  }

  @Test
  void 없는_드라이브_파일은_404() {
    seedFixture("DONE", null, "본문");

    TenantContext.set(tid2);
    assertThatThrownBy(() -> fileService.readText(memberId, driveFileId + 100_000, 0, 100))
        .isInstanceOf(DriveFileNotFoundException.class);
  }

  @Test
  void 추출_대기_중이면_상태만_있고_본문은_없다() {
    seedFixture("PENDING", null, null);

    TenantContext.set(tid2);
    ExtractedTextSlice res = fileService.readText(memberId, driveFileId, 0, 100);

    assertThat(res.fileId()).isEqualTo(fileIdCore);
    assertThat(res.status()).isEqualTo("PENDING");
    assertThat(res.offset()).isEqualTo(0);
    assertThat(res.text()).isNull();
    assertThat(res.totalChars()).isNull();
    assertThat(res.nextOffset()).isNull();
    assertThat(res.reasonCode()).isNull();
  }

  @Test
  void 추출_중도_외부_상태는_PENDING_으로_묶인다() {
    seedFixture("EXTRACTING", null, null);

    TenantContext.set(tid2);
    ExtractedTextSlice res = fileService.readText(memberId, driveFileId, 0, 100);

    // 내부 EXTRACTING 은 외부 계약에서 PENDING(기다리면 됨)으로 합쳐진다 — ExtractionInfo.of.
    assertThat(res.status()).isEqualTo("PENDING");
    assertThat(res.text()).isNull();
  }

  @Test
  void 건너뜀이면_SKIPPED_와_사용자_사유() {
    seedFixture("SKIPPED", "unsupported-mime:application/zip", null);

    TenantContext.set(tid2);
    ExtractedTextSlice res = fileService.readText(memberId, driveFileId, 0, 100);

    assertThat(res.status()).isEqualTo("SKIPPED");
    assertThat(res.text()).isNull();
    assertThat(res.reasonCode()).isNotBlank();
    assertThat(res.reason()).isEqualTo("이 형식은 텍스트 추출을 지원하지 않습니다.");
  }

  @Test
  void 실패면_FAILED_와_사유_raw_error_는_노출하지_않는다() {
    seedFixture("FAILED", "boom: 내부 스택", null);

    TenantContext.set(tid2);
    ExtractedTextSlice res = fileService.readText(memberId, driveFileId, 0, 100);

    assertThat(res.status()).isEqualTo("FAILED");
    assertThat(res.text()).isNull();
    assertThat(res.reason()).isNotBlank().doesNotContain("boom");
  }

  @Test
  void 추출_행이_없으면_본문_없이_NONE_상태() {
    seedFixture(null, null, null);

    TenantContext.set(tid2);
    ExtractedTextSlice res = fileService.readText(memberId, driveFileId, 0, 100);

    assertThat(res.text()).isNull();
    assertThat(res.status()).isEqualTo("NONE");
  }

  @Test
  void 완료면_구간으로_나눠_읽고_nextOffset_으로_이어_읽는다() {
    // 이모지(서로게이트 쌍)를 섞어 코드포인트 기준 offset 을 확인한다.
    seedFixture("DONE", null, "가나다라마😀바사아자차");

    TenantContext.set(tid2);
    ExtractedTextSlice first = fileService.readText(memberId, driveFileId, 0, 6);

    assertThat(first.status()).isEqualTo("READY");
    assertThat(first.offset()).isEqualTo(0);
    assertThat(first.text()).isEqualTo("가나다라마😀");
    assertThat(first.totalChars()).isEqualTo(11);
    assertThat(first.nextOffset()).isEqualTo(6);

    ExtractedTextSlice second = fileService.readText(memberId, driveFileId, 6, 100);
    assertThat(second.text()).isEqualTo("바사아자차");
    assertThat(second.offset()).isEqualTo(6);
    assertThat(second.nextOffset()).isNull();
  }

  @Test
  void limit_이_상한을_넘으면_32000자로_클램프한다() {
    seedFixture("DONE", null, "가".repeat(40_000));

    TenantContext.set(tid2);
    ExtractedTextSlice res = fileService.readText(memberId, driveFileId, 0, 1_000_000);

    assertThat(res.text()).hasSize(ExtractedTextService.MAX_LIMIT);
    assertThat(res.totalChars()).isEqualTo(40_000);
    assertThat(res.nextOffset()).isEqualTo(ExtractedTextService.MAX_LIMIT);
  }

  @Test
  void 범위가_잘못되면_InvalidTextRangeException() {
    seedFixture("DONE", null, "본문");

    TenantContext.set(tid2);
    assertThatThrownBy(() -> fileService.readText(memberId, driveFileId, -1, 10))
        .isInstanceOf(InvalidTextRangeException.class);
    assertThatThrownBy(() -> fileService.readText(memberId, driveFileId, 0, 0))
        .isInstanceOf(InvalidTextRangeException.class);
  }

  // ---------------------------------------------------------------- 정리

  /** 커밋된 도메인 행을 fixture 테넌트 GUC 에서 캡처 id 로 삭제한다(공유 DB 무오염). */
  @AfterEach
  void cleanup() {
    TenantContext.clear();
    if (tid2 == null) {
      return;
    }
    new TransactionTemplate(txManager)
        .execute(
            status -> {
              setGuc(tid2);
              // FK 순서: FILE_EXTRACTION → DRIVE_FILE → DRIVE_SPACE_MEMBER → DRIVE_SPACE → FILE →
              // USER
              if (hasExtraction) {
                dsl.deleteFrom(FILE_EXTRACTION)
                    .where(FILE_EXTRACTION.FILE_ID.eq(fileIdCore))
                    .execute();
              }
              dsl.deleteFrom(DRIVE_FILE).where(DRIVE_FILE.ID.eq(driveFileId)).execute();
              dsl.deleteFrom(DRIVE_SPACE_MEMBER)
                  .where(DRIVE_SPACE_MEMBER.SPACE_ID.eq(spaceId))
                  .execute();
              dsl.deleteFrom(DRIVE_SPACE).where(DRIVE_SPACE.ID.eq(spaceId)).execute();
              dsl.deleteFrom(FILE).where(FILE.ID.eq(fileIdCore)).execute();
              dsl.deleteFrom(USER).where(USER.ID.in(memberId, outsiderId)).execute();
              return null;
            });
    tid2 = null;
  }

  // ---- WP-250: GET /api/v1/drive/files/{id}/view — 테넌트 #2 에 시드해 R5(트랜잭션 경계)까지 종단 검증 ----

  private static final byte[] VIEW_PNG = {(byte) 0x89, 'P', 'N', 'G', 9, 9, 9};

  private String tokenFor(long userId) {
    // WP-420: tenant 토큰은 그 테넌트 ACTIVE 멤버일 때만 인증된다 — 실제 워크스페이스 선택과 같은 전제를 맞춘다.
    TestFixtures.ensureActiveMember(dsl, userId, tid2);
    return "Bearer " + jwtTokenProvider.generateAccessToken(userId, "u" + userId, tid2);
  }

  private Integer pageCountOfCore() {
    return new TransactionTemplate(txManager)
        .execute(
            st -> {
              setGuc(tid2);
              return dsl.select(FILE_EXTRACTION.PAGE_COUNT)
                  .from(FILE_EXTRACTION)
                  .where(FILE_EXTRACTION.FILE_ID.eq(fileIdCore))
                  .fetchOne(FILE_EXTRACTION.PAGE_COUNT);
            });
  }

  @Test
  void view_는_스페이스_멤버에게_이미지와_쪽수를_주고_page_count_를_채운다() throws Exception {
    seedFixture("DONE", null, "본문");
    assertThat(pageCountOfCore()).isNull();
    when(worker.render(anyString(), eq("application/pdf"), eq(1), anyInt()))
        .thenReturn(new ViewImage(VIEW_PNG, "image/png", 8));

    try {
      mvc.perform(
              get("/api/v1/drive/files/{id}/view", driveFileId)
                  .param("page", "1")
                  .header("Authorization", tokenFor(memberId)))
          .andExpect(status().isOk())
          .andExpect(header().string("Content-Type", "image/png"))
          .andExpect(header().string("X-Page-Count", "8"))
          .andExpect(header().string("Cache-Control", "max-age=300, private"))
          .andExpect(content().bytes(VIEW_PNG));
    } finally {
      TenantContext.set(tid2); // 필터가 요청 뒤 비운 테스트 스레드 컨텍스트를 되돌린다
    }
    assertThat(pageCountOfCore()).isEqualTo(8);
  }

  @Test
  void view_는_비멤버를_404_로_막고_워커를_부르지_않는다() throws Exception {
    seedFixture("DONE", null, "본문");
    try {
      mvc.perform(
              get("/api/v1/drive/files/{id}/view", driveFileId)
                  .param("page", "1")
                  .header("Authorization", tokenFor(outsiderId)))
          .andExpect(status().isNotFound());
    } finally {
      TenantContext.set(tid2);
    }
    verifyNoInteractions(worker);
  }

  @Test
  void view_는_없는_드라이브_파일을_404_로_막는다() throws Exception {
    seedFixture("DONE", null, "본문");
    try {
      mvc.perform(
              get("/api/v1/drive/files/{id}/view", driveFileId + 100_000)
                  .param("page", "1")
                  .header("Authorization", tokenFor(memberId)))
          .andExpect(status().isNotFound());
    } finally {
      TenantContext.set(tid2);
    }
    verifyNoInteractions(worker);
  }

  // ---------------------------------------------------------------- 시드

  /**
   * fixture 테넌트 + 멤버/비멤버 + 팀 스페이스 + 드라이브 파일(+ 추출 행)을 커밋한다.
   *
   * @param status 추출 상태 — null 이면 추출 행을 만들지 않는다
   * @param error 추출 error 컬럼(SKIPPED·FAILED 사유 원문)
   * @param text 추출 본문 — null 이면 비워 둔다(DONE 이면 char_count 도 채운다)
   */
  private void seedFixture(String status, String error, String text) {
    new TransactionTemplate(txManager)
        .execute(
            txStatus -> {
              tid2 = ensureFixtureTenant();
              setGuc(tid2);

              String suffix = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
              memberId = insertUser("txt_m_" + suffix);
              outsiderId = insertUser("txt_o_" + suffix);

              spaceId =
                  dsl.insertInto(DRIVE_SPACE)
                      .set(DRIVE_SPACE.TYPE, "TEAM")
                      .set(DRIVE_SPACE.NAME, "공간T_" + suffix)
                      .set(DRIVE_SPACE.OWNER_ID, memberId)
                      .returning(DRIVE_SPACE.ID)
                      .fetchOne()
                      .getId();
              dsl.insertInto(DRIVE_SPACE_MEMBER)
                  .set(DRIVE_SPACE_MEMBER.SPACE_ID, spaceId)
                  .set(DRIVE_SPACE_MEMBER.USER_ID, memberId)
                  .set(DRIVE_SPACE_MEMBER.ROLE, "OWNER")
                  .execute();

              fileIdCore =
                  dsl.insertInto(FILE)
                      .set(FILE.ORIGINAL_NAME, "보고서.pdf")
                      .set(FILE.STORED_NAME, "stored_" + suffix)
                      .set(FILE.MIME_TYPE, "application/pdf")
                      .set(FILE.SIZE_BYTES, 100L)
                      // 상대 경로 — /view 가 "{path}.view/" 캐시를 파일 저장소 아래에 쓴다(경로마다 고유해 이전 실행 캐시와 섞이지 않음)
                      .set(FILE.STORAGE_PATH, "wp250-drive-view/" + suffix + "/report.pdf")
                      .set(FILE.UPLOADED_BY, memberId)
                      .returning(FILE.ID)
                      .fetchOne()
                      .getId();
              dsl.insertInto(DRIVE_FILE)
                  .set(DRIVE_FILE.SPACE_ID, spaceId)
                  .set(DRIVE_FILE.FILE_ID, fileIdCore)
                  .set(DRIVE_FILE.NAME, "보고서.pdf")
                  .execute();
              driveFileId =
                  dsl.select(DRIVE_FILE.ID)
                      .from(DRIVE_FILE)
                      .where(DRIVE_FILE.FILE_ID.eq(fileIdCore))
                      .fetchOne(DRIVE_FILE.ID);

              hasExtraction = status != null;
              if (hasExtraction) {
                var ins =
                    dsl.insertInto(FILE_EXTRACTION)
                        .set(FILE_EXTRACTION.FILE_ID, fileIdCore)
                        .set(FILE_EXTRACTION.STATUS, status)
                        .set(FILE_EXTRACTION.ERROR, error)
                        .set(FILE_EXTRACTION.TENANT_ID, tid2);
                if (text != null) {
                  ins =
                      ins.set(FILE_EXTRACTION.EXTRACTED_TEXT, text)
                          .set(FILE_EXTRACTION.CHAR_COUNT, text.codePointCount(0, text.length()));
                }
                ins.execute();
              }
              return null;
            });
  }

  private Long insertUser(String username) {
    return dsl.insertInto(USER)
        .set(USER.USERNAME, username)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, username)
        .set(USER.EMAIL, username + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  /** 고정 슬러그로 fixture 테넌트를 find-or-create(커밋) — tenant 행은 삭제 불가라 누적을 막는다. */
  private long ensureFixtureTenant() {
    Long existing =
        dsl.select(TENANT.ID)
            .from(TENANT)
            .where(TENANT.SLUG.eq(FIXTURE_TENANT_SLUG))
            .fetchOne(TENANT.ID);
    if (existing != null) {
      return existing;
    }
    return dsl.insertInto(TENANT)
        .set(TENANT.SLUG, FIXTURE_TENANT_SLUG)
        .set(TENANT.NAME, "Drive Text RLS Fixture Tenant")
        .set(TENANT.STATUS, "ACTIVE")
        .returning(TENANT.ID)
        .fetchOne()
        .getId();
  }

  private void setGuc(Long tenantId) {
    dsl.execute("SELECT set_config('app.tenant_id', '" + tenantId + "', true)");
  }
}
