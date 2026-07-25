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

import com.workplace.drive.dto.FileSummaryResponse;
import com.workplace.drive.exception.DriveSpaceNotFoundException;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 요약 읽기 접근 게이트 통합 테스트.
 *
 * <p>linchpin = 같은 테넌트라도 스페이스 비멤버면 거부(테넌트 RLS만으로는 불충분).
 *
 * <p><b>RLS 치아 보장</b>: 클래스 레벨 {@code @Transactional} 을 두지 않고 세션 기본 테넌트(1)와 다른 fixture 테넌트(tid2) 에
 * 데이터를 커밋해, {@link DriveFileService#fileSummary} 의 {@code @Transactional(readOnly = true)} 이 없어지면
 * {@code 멤버는_저장된_요약을_받는다} 가 red 가 되도록 한다. 자세한 원리는 {@code NonTransactionalRlsReadGuardTest} Javadoc
 * 참조(#444/#492/#517/#525 패턴 동일).
 */
class DriveFileSummaryServiceTest extends IntegrationTestBase {

  /** 세션 기본 GUC(1)와 다른 고정-슬러그 fixture 테넌트. */
  private static final String FIXTURE_TENANT_SLUG = "drive-summary-rls-fixture-tenant";

  @Autowired DSLContext dsl;
  @Autowired DriveFileService fileService;
  @Autowired PlatformTransactionManager txManager;

  // @AfterEach 정리용 — 시드에서 채운다.
  private Long tid2;
  private Long memberId;
  private Long outsiderId;
  private Long spaceId;
  private Long fileIdCore; // FILE.ID (core)
  private Long driveFileId;
  private Long extractionFileId; // FILE_EXTRACTION 정리용 (fileIdCore 와 동일할 수 있음)

  // ---------------------------------------------------------------- 테스트

  @Test
  void 멤버는_저장된_요약을_받는다() {
    seedFixture("보고서.docx", "DONE", "이 문서의 요약입니다.", true);

    TenantContext.set(tid2);
    FileSummaryResponse res = fileService.fileSummary(memberId, driveFileId);

    assertThat(res.summary()).isEqualTo("이 문서의 요약입니다.");
    assertThat(res.status()).isEqualTo("DONE");
  }

  @Test
  void 비멤버는_거부된다() {
    seedFixture("보고서.docx", "DONE", "비밀 요약", true);

    TenantContext.set(tid2);
    // 비멤버는 스페이스 존재 자체를 은닉(existence hiding) — DriveSpaceNotFoundException 반환.
    assertThatThrownBy(() -> fileService.fileSummary(outsiderId, driveFileId))
        .isInstanceOf(DriveSpaceNotFoundException.class);
  }

  @Test
  void 추출중이면_요약은_null_상태는_진행중() {
    seedFixture("큰파일.pdf", "EXTRACTING", null, true);

    TenantContext.set(tid2);
    FileSummaryResponse res = fileService.fileSummary(memberId, driveFileId);

    assertThat(res.summary()).isNull();
    assertThat(res.status()).isEqualTo("EXTRACTING");
  }

  /**
   * file_extraction 행이 없는 drive_file — findSummary 의 r==null 분기 계약을 확인한다. 요약/상태 모두 null 을 반환해야 한다.
   */
  @Test
  void 추출행이_없으면_요약과_상태가_null() {
    // extraction = false 로 file_extraction 행 없이 시드
    seedFixture("텍스트.txt", null, null, false);

    TenantContext.set(tid2);
    FileSummaryResponse res = fileService.fileSummary(memberId, driveFileId);

    assertThat(res.summary()).isNull();
    assertThat(res.status()).isNull();
  }

  @Test
  void SKIPPED_unsupported_mime은_사용자문구로_매핑되고_raw_error를_노출하지_않는다() {
    // #735: toReason 이 raw error(unsupported-mime:...)를 사용자 문구로 바꿔야 한다.
    seedFixtureWithError("압축.zip", "SKIPPED", "unsupported-mime:application/zip");

    TenantContext.set(tid2);
    FileSummaryResponse res = fileService.fileSummary(memberId, driveFileId);

    assertThat(res.reason()).isEqualTo("이 형식은 텍스트 추출을 지원하지 않습니다.");
    assertThat(res.reason()).doesNotContain("unsupported-mime");
  }

  @Test
  void SKIPPED_image는_이미지_전용_문구로_매핑된다() {
    seedFixtureWithError("사진.png", "SKIPPED", "image:image/png");

    TenantContext.set(tid2);
    FileSummaryResponse res = fileService.fileSummary(memberId, driveFileId);

    assertThat(res.reason()).isEqualTo("이미지 파일은 요약하지 않습니다.");
  }

  // ---------------------------------------------------------------- @AfterEach

  /** 커밋된 도메인/USER 행을 GUC=tid2 컨텍스트에서 캡처 id 로 삭제(공유 DB 무오염). fixture 테넌트만 영구 잔존. */
  @AfterEach
  void cleanup() {
    TenantContext.clear();
    if (tid2 == null) {
      return;
    }
    new TransactionTemplate(txManager)
        .execute(
            status -> {
              // 스코프 테이블은 RLS — GUC=tid2 에서만 보이고 삭제된다.
              setGuc(tid2);
              // FK 순서: FILE_EXTRACTION → DRIVE_FILE → DRIVE_SPACE_MEMBER → DRIVE_SPACE → FILE →
              // USER
              if (extractionFileId != null) {
                dsl.deleteFrom(FILE_EXTRACTION)
                    .where(FILE_EXTRACTION.FILE_ID.eq(extractionFileId))
                    .execute();
              }
              if (driveFileId != null) {
                dsl.deleteFrom(DRIVE_FILE).where(DRIVE_FILE.ID.eq(driveFileId)).execute();
              }
              if (spaceId != null) {
                dsl.deleteFrom(DRIVE_SPACE_MEMBER)
                    .where(DRIVE_SPACE_MEMBER.SPACE_ID.eq(spaceId))
                    .execute();
                dsl.deleteFrom(DRIVE_SPACE).where(DRIVE_SPACE.ID.eq(spaceId)).execute();
              }
              if (fileIdCore != null) {
                dsl.deleteFrom(FILE).where(FILE.ID.eq(fileIdCore)).execute();
              }
              // USER 는 RLS 비대상 — GUC 없이도 삭제 가능하나 GUC 안에서 일괄 처리.
              if (memberId != null) {
                dsl.deleteFrom(USER).where(USER.ID.eq(memberId)).execute();
              }
              if (outsiderId != null) {
                dsl.deleteFrom(USER).where(USER.ID.eq(outsiderId)).execute();
              }
              return null;
            });
    // 필드 초기화
    tid2 = null;
    memberId = null;
    outsiderId = null;
    spaceId = null;
    fileIdCore = null;
    driveFileId = null;
    extractionFileId = null;
  }

  // ---------------------------------------------------------------- 시드 헬퍼

  /**
   * fixture 테넌트 + 멤버/아웃사이더 USER + DRIVE_SPACE + DRIVE_FILE(+ 선택적 FILE_EXTRACTION)을
   * TransactionTemplate 안에서 GUC=tid2 로 커밋한다.
   *
   * @param fileName 파일명
   * @param status FILE_EXTRACTION.status (null 허용)
   * @param summary FILE_EXTRACTION.summary (null 허용)
   * @param withExtraction true 이면 file_extraction 행 생성, false 이면 생략
   */
  private void seedFixture(String fileName, String status, String summary, boolean withExtraction) {
    new TransactionTemplate(txManager)
        .execute(
            txStatus -> {
              // fixture 테넌트 확보(find-or-create, 누적 방지)
              tid2 = ensureFixtureTenant();

              // GUC=tid2 설정: 이 트랜잭션 안의 RLS 스코프 INSERT 에 적용된다.
              setGuc(tid2);

              // USER 는 RLS 비대상이므로 tenant_id 없이 생성.
              String suffix = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
              memberId =
                  dsl.insertInto(USER)
                      .set(USER.USERNAME, "sum_m_" + suffix)
                      .set(USER.PASSWORD, "pw")
                      .set(USER.NAME, "멤버_" + suffix)
                      .set(USER.EMAIL, "sum_m_" + suffix + "@example.com")
                      .returning(USER.ID)
                      .fetchOne()
                      .getId();
              outsiderId =
                  dsl.insertInto(USER)
                      .set(USER.USERNAME, "sum_o_" + suffix)
                      .set(USER.PASSWORD, "pw")
                      .set(USER.NAME, "아웃사이더_" + suffix)
                      .set(USER.EMAIL, "sum_o_" + suffix + "@example.com")
                      .returning(USER.ID)
                      .fetchOne()
                      .getId();

              // DRIVE_SPACE — tenant_id 컬럼 DEFAULT 가 GUC=tid2 를 채운다.
              spaceId =
                  dsl.insertInto(DRIVE_SPACE)
                      .set(DRIVE_SPACE.TYPE, "TEAM")
                      .set(DRIVE_SPACE.NAME, "공간S_" + suffix)
                      .set(DRIVE_SPACE.OWNER_ID, memberId)
                      .returning(DRIVE_SPACE.ID)
                      .fetchOne()
                      .getId();
              dsl.insertInto(DRIVE_SPACE_MEMBER)
                  .set(DRIVE_SPACE_MEMBER.SPACE_ID, spaceId)
                  .set(DRIVE_SPACE_MEMBER.USER_ID, memberId)
                  .set(DRIVE_SPACE_MEMBER.ROLE, "OWNER")
                  .execute();

              // FILE (core) — tenant_id 컬럼 DEFAULT 가 GUC=tid2 를 채운다.
              String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
              fileIdCore =
                  dsl.insertInto(FILE)
                      .set(FILE.ORIGINAL_NAME, fileName)
                      .set(FILE.STORED_NAME, "stored_" + s)
                      .set(FILE.MIME_TYPE, "application/octet-stream")
                      .set(FILE.SIZE_BYTES, 100L)
                      .set(FILE.STORAGE_PATH, "/data/uploads/" + s)
                      .set(FILE.UPLOADED_BY, memberId)
                      .returning(FILE.ID)
                      .fetchOne()
                      .getId();

              // DRIVE_FILE — tenant_id 컬럼 DEFAULT 가 GUC=tid2 를 채운다.
              dsl.insertInto(DRIVE_FILE)
                  .set(DRIVE_FILE.SPACE_ID, spaceId)
                  .set(DRIVE_FILE.FILE_ID, fileIdCore)
                  .set(DRIVE_FILE.NAME, fileName)
                  .execute();
              driveFileId =
                  dsl.select(DRIVE_FILE.ID)
                      .from(DRIVE_FILE)
                      .where(DRIVE_FILE.FILE_ID.eq(fileIdCore))
                      .fetchOne(DRIVE_FILE.ID);

              // FILE_EXTRACTION — tenant_id 는 명시 set(RLS 스코프 컬럼, tid2).
              if (withExtraction) {
                dsl.insertInto(FILE_EXTRACTION)
                    .set(FILE_EXTRACTION.FILE_ID, fileIdCore)
                    .set(FILE_EXTRACTION.STATUS, status)
                    .set(FILE_EXTRACTION.SUMMARY, summary)
                    .set(FILE_EXTRACTION.TENANT_ID, tid2)
                    .execute();
                extractionFileId = fileIdCore;
              }

              return null; // 커밋(롤백 안 함) — 서비스가 자기 트랜잭션으로 열어 읽으므로 커밋 필요.
            });
  }

  /** error 컬럼까지 채우는 SKIPPED/FAILED 전용 시드(#735 reason 매핑 검증용). seedFixture 의 error 파라미터 확장판. */
  private void seedFixtureWithError(String fileName, String status, String error) {
    new TransactionTemplate(txManager)
        .execute(
            txStatus -> {
              tid2 = ensureFixtureTenant();
              setGuc(tid2);

              String suffix = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
              memberId =
                  dsl.insertInto(USER)
                      .set(USER.USERNAME, "sum_m_" + suffix)
                      .set(USER.PASSWORD, "pw")
                      .set(USER.NAME, "멤버_" + suffix)
                      .set(USER.EMAIL, "sum_m_" + suffix + "@example.com")
                      .returning(USER.ID)
                      .fetchOne()
                      .getId();
              outsiderId =
                  dsl.insertInto(USER)
                      .set(USER.USERNAME, "sum_o_" + suffix)
                      .set(USER.PASSWORD, "pw")
                      .set(USER.NAME, "아웃사이더_" + suffix)
                      .set(USER.EMAIL, "sum_o_" + suffix + "@example.com")
                      .returning(USER.ID)
                      .fetchOne()
                      .getId();

              spaceId =
                  dsl.insertInto(DRIVE_SPACE)
                      .set(DRIVE_SPACE.TYPE, "TEAM")
                      .set(DRIVE_SPACE.NAME, "공간S_" + suffix)
                      .set(DRIVE_SPACE.OWNER_ID, memberId)
                      .returning(DRIVE_SPACE.ID)
                      .fetchOne()
                      .getId();
              dsl.insertInto(DRIVE_SPACE_MEMBER)
                  .set(DRIVE_SPACE_MEMBER.SPACE_ID, spaceId)
                  .set(DRIVE_SPACE_MEMBER.USER_ID, memberId)
                  .set(DRIVE_SPACE_MEMBER.ROLE, "OWNER")
                  .execute();

              String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
              fileIdCore =
                  dsl.insertInto(FILE)
                      .set(FILE.ORIGINAL_NAME, fileName)
                      .set(FILE.STORED_NAME, "stored_" + s)
                      .set(FILE.MIME_TYPE, "application/octet-stream")
                      .set(FILE.SIZE_BYTES, 100L)
                      .set(FILE.STORAGE_PATH, "/data/uploads/" + s)
                      .set(FILE.UPLOADED_BY, memberId)
                      .returning(FILE.ID)
                      .fetchOne()
                      .getId();

              dsl.insertInto(DRIVE_FILE)
                  .set(DRIVE_FILE.SPACE_ID, spaceId)
                  .set(DRIVE_FILE.FILE_ID, fileIdCore)
                  .set(DRIVE_FILE.NAME, fileName)
                  .execute();
              driveFileId =
                  dsl.select(DRIVE_FILE.ID)
                      .from(DRIVE_FILE)
                      .where(DRIVE_FILE.FILE_ID.eq(fileIdCore))
                      .fetchOne(DRIVE_FILE.ID);

              dsl.insertInto(FILE_EXTRACTION)
                  .set(FILE_EXTRACTION.FILE_ID, fileIdCore)
                  .set(FILE_EXTRACTION.STATUS, status)
                  .set(FILE_EXTRACTION.ERROR, error)
                  .set(FILE_EXTRACTION.TENANT_ID, tid2)
                  .execute();
              extractionFileId = fileIdCore;

              return null;
            });
  }

  /** 고정 슬러그로 fixture 테넌트를 find-or-create(커밋). app_tenant 는 tenant DELETE 불가(V46) → 1행 누적 방지. */
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
        .set(TENANT.NAME, "Drive Summary RLS Fixture Tenant")
        .set(TENANT.STATUS, "ACTIVE")
        .returning(TENANT.ID)
        .fetchOne()
        .getId();
  }

  /** 트랜잭션-로컬 GUC 직접 설정 헬퍼. */
  private void setGuc(Long tenantId) {
    dsl.execute("SELECT set_config('app.tenant_id', '" + tenantId + "', true)");
  }
}
