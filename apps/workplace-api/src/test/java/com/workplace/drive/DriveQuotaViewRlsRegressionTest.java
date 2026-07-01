package com.workplace.drive;

import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.DRIVE_FILE;
import static com.workplace.jooq.Tables.DRIVE_FILE_VERSION;
import static com.workplace.jooq.Tables.DRIVE_SPACE;
import static com.workplace.jooq.Tables.DRIVE_SPACE_MEMBER;
import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.drive.dto.DriveFileResponse;
import com.workplace.drive.dto.DriveSpaceResponse;
import com.workplace.drive.service.DriveFileService;
import com.workplace.drive.service.DriveQuotaService;
import com.workplace.drive.service.DriveSpaceService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockMultipartFile;

/**
 * 드라이브 쿼터 조회 경로의 RLS fail-closed 회귀 테스트.
 *
 * <p>이빨(teeth)의 핵심: 이 클래스는 <b>절대 {@code @Transactional} 이면 안 된다</b>. @Transactional 테스트는 스프링 트랜잭션
 * 매니저가 스스로 app.tenant_id GUC 를 주입해 버그를 은폐한다(기존 {@link DriveQuotaServiceTest} 의 {@code usedBytes >=
 * 0} 단언이 vacuous 한 이유). 여기서는 컨트롤러와 동일하게 <b>비-@Transactional 문맥에서 프록시된 {@code view()}</b> 를 호출한다.
 * {@code DriveQuotaService.view()} 에 {@code @Transactional} 이 없으면 {@code
 * TenantAwareTransactionManager} 가 GUC 를 주입하지 못해 RLS(FORCE) 가 drive_file_version/ drive_file/file 의
 * 자기 테넌트 행을 가려 SUM 이 0 → 사용량 0 오표시(RED). 수정 후에는 트랜잭션 안에서 GUC 가 주입돼 실제 사용량이 반환된다(GREEN).
 *
 * <p>시드 데이터는 실제 서비스({@code driveFileService.upload} 는 @Transactional 이라 COMMIT 됨)로 만들며, 공유 테스트 DB
 * 오염을 막기 위해 {@code @AfterEach} 에서 {@code cleanupInTenant}(테넌트 GUC 트랜잭션)로 FK 안전 순서로 전량 삭제한다(#512).
 */
class DriveQuotaViewRlsRegressionTest extends IntegrationTestBase {

  @Autowired DriveQuotaService quotaService;
  @Autowired DriveSpaceService spaceService;
  @Autowired DriveFileService driveFileService;
  @Autowired DSLContext dsl;

  // 정리 대상 id — 커밋된 시드 행 회수용.
  private Long seededUserId;
  private Long seededSpaceId;
  private Long seededDriveFileId;
  private List<Long> seededFileIds = List.of();

  /** 테스트용 사용자 생성(DriveQuotaRepositoryTest 의 private helper 복사). */
  private long seedUser() {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "qv_" + s)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "Qv" + s)
        .set(USER.EMAIL, "qv_" + s + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  /**
   * 비-@Transactional 문맥에서 프록시된 view() 로 사용량을 읽어, 미수정(RLS fail-closed)일 때 0, 수정 후 시드 크기(>=11)를 포함함을
   * 검증한다. usedBytes() 를 직접 호출하지 않고 반드시 view() 를 거친다(self-invocation 이므로 진입점 트랜잭션이 걸려야만 GUC 가 주입됨 —
   * 이것이 이빨).
   */
  @Test
  void view_usedBytes_reflects_committed_files_when_non_transactional() throws Exception {
    TenantContext.set(1L);
    try {
      // given: 커밋되는 시드 — 팀 공간 + 파일 업로드(11바이트).
      seededUserId = seedUser();
      DriveSpaceResponse sp =
          spaceService.createTeamSpace(seededUserId, "쿼터RLS회귀-" + UUID.randomUUID());
      seededSpaceId = sp.id();
      byte[] content = "hello world".getBytes(); // 11바이트
      MockMultipartFile f = new MockMultipartFile("file", "test.txt", "text/plain", content);
      DriveFileResponse uploaded = driveFileService.upload(seededUserId, seededSpaceId, null, f);
      seededDriveFileId = uploaded.id();
      // 정리용 file(blob) id 확보 — drive_file_version 삭제 전에 캡처.
      seededFileIds =
          dsl.select(DRIVE_FILE_VERSION.FILE_ID)
              .from(DRIVE_FILE_VERSION)
              .where(DRIVE_FILE_VERSION.DRIVE_FILE_ID.eq(seededDriveFileId))
              .fetch(DRIVE_FILE_VERSION.FILE_ID);

      // 세션 GUC 잔여 제거 — 공유 테스트 DB 는 대부분 테넌트#1 로 돌아 풀 커넥션에 app.tenant_id 잔여가 남을 수
      // 있고, 그러면 미수정 코드도 우연히 통과(GREEN)해 이빨이 무뎌진다. 프로덕션의 "잔여 GUC 없는" 커넥션을
      // 재현하기 위해 읽기 직전 세션 GUC 를 비운다(Hikari 는 같은 스레드에 직전 커넥션을 재할당하므로,
      // 미수정 view() 는 바로 이 비워진 커넥션에서 SUM → NULLIF→NULL → RLS fail-closed → 0).
      dsl.execute("select set_config('app.tenant_id', '', false)");

      // when: 컨트롤러와 동일 경로 — 프록시된 view() 를 비-@Transactional 로 호출.
      long used = quotaService.view().usedBytes();

      // then: 미수정이면 RLS fail-closed → 0(RED), 수정 후엔 시드 11바이트 이상(GREEN).
      assertThat(used).isGreaterThanOrEqualTo(11L);
    } finally {
      // 세션 GUC 를 기본값(1) 로 복원 — 위에서 심은 ''(빈 문자열)이 풀 커넥션에 남으면 다음 비-tx 테스트의 시드/정리가
      // RLS 로 깨진다(#512). IntegrationTestBase 의 자가치유와 겹치는 안전망이지만, 오염을 만든 테스트가 스스로 치운다.
      dsl.execute("SELECT set_config('app.tenant_id', '1', false)");
      TenantContext.clear();
    }
  }

  /**
   * 커밋된 시드 전량 회수(FK 안전 순서). 비-@Transactional 테스트라 시드가 실제 커밋되므로, 남기면 {@code
   * DriveQuotaRepositoryTest.빈_공간은_사용량_0}(sum==0) 등 형제 테스트를 깨뜨린다(#512).
   */
  @AfterEach
  void cleanup() {
    cleanupInTenant(
        1L,
        () -> {
          if (seededDriveFileId != null) {
            // 버전 → drive_file 순(FK). drive_file 삭제는 drive_space CASCADE 로도 정리되지만 명시 삭제.
            dsl.deleteFrom(DRIVE_FILE_VERSION)
                .where(DRIVE_FILE_VERSION.DRIVE_FILE_ID.eq(seededDriveFileId))
                .execute();
            dsl.deleteFrom(DRIVE_FILE).where(DRIVE_FILE.ID.eq(seededDriveFileId)).execute();
          }
          // file(blob) — drive_space CASCADE 에 안 걸리므로 명시 삭제(file_extraction 은 ON DELETE CASCADE).
          if (!seededFileIds.isEmpty()) {
            dsl.deleteFrom(FILE).where(FILE.ID.in(seededFileIds)).execute();
          }
          if (seededSpaceId != null) {
            dsl.deleteFrom(DRIVE_SPACE_MEMBER)
                .where(DRIVE_SPACE_MEMBER.SPACE_ID.eq(seededSpaceId))
                .execute();
            dsl.deleteFrom(DRIVE_SPACE).where(DRIVE_SPACE.ID.eq(seededSpaceId)).execute();
          }
          if (seededUserId != null) {
            // 업로드가 커밋한 감사 로그도 회수(비-@Transactional 이라 롤백 안 됨).
            dsl.deleteFrom(AUDIT_LOG).where(AUDIT_LOG.USER_ID.eq(seededUserId)).execute();
            dsl.deleteFrom(USER_ROLE).where(USER_ROLE.USER_ID.eq(seededUserId)).execute();
            dsl.deleteFrom(USER).where(USER.ID.eq(seededUserId)).execute();
          }
        });
    // ThreadLocal 누수 방지(예외 경로 대비).
    TenantContext.clear();
  }
}
