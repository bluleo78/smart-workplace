package com.workplace.drive;

import static com.workplace.jooq.Tables.TENANT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.drive.dto.DriveFileResponse;
import com.workplace.drive.dto.DriveSpaceResponse;
import com.workplace.drive.exception.DriveQuotaExceededException;
import com.workplace.drive.service.DriveFileService;
import com.workplace.drive.service.DriveFolderService;
import com.workplace.drive.service.DriveQuotaService;
import com.workplace.drive.service.DriveSpaceService;
import com.workplace.drive.service.DriveTrashService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.transaction.annotation.Transactional;

/**
 * 업로드·복사 시 쿼터 강제 — 한도 초과면 거부. 휴지통도 사용량에 들어가므로 복원은 한도와 무관하게 허용한다(WP-1391).
 *
 * <p>사용량은 테넌트 file 전체라 공유 테스트 DB 에 다른 테스트가 남긴 행이 있을 수 있다 — 한도는 테스트 시작 시점 사용량(base)에 더해 정한다.
 */
@Transactional
class DriveFileQuotaEnforceTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired DriveFileService driveFileService;
  @Autowired DriveSpaceService spaceService;
  @Autowired DriveFolderService folderService;
  @Autowired DriveTrashService trashService;
  @Autowired DriveQuotaService quotaService;

  /** 테스트 시작 시점 사용량 — 한도를 이 위에 얹어 다른 테스트의 잔여 행과 무관하게 만든다. */
  private long base;

  /** 테넌트 #1 RLS 컨텍스트 설정. */
  @BeforeEach
  void setTenant() {
    TenantContext.set(1L);
    base = quotaService.usedBytes();
  }

  /** ThreadLocal 누수 방지. */
  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  /** 현재 테넌트(#1)의 quota_bytes 를 「시작 시점 사용량 + quotaBytes」로 변경 — 이 테스트가 더하는 바이트만 한도를 다툰다. */
  private void setTenantQuota(long quotaBytes) {
    dsl.update(TENANT).set(TENANT.QUOTA_BYTES, base + quotaBytes).where(TENANT.ID.eq(1L)).execute();
  }

  /** 테스트용 공간 생성. */
  private DriveSpaceResponse createSpace() {
    long u = seedUser();
    return spaceService.createTeamSpace(u, "팀_" + UUID.randomUUID().toString().substring(0, 4));
  }

  /** 파일 업로드 헬퍼 — text/plain(허용 타입)으로 업로드. */
  private DriveFileResponse uploadFile(long spaceId, byte[] content) throws Exception {
    return uploadFile(spaceId, null, content);
  }

  /** 폴더 안 업로드 헬퍼 — folderId null 이면 공간 루트. */
  private DriveFileResponse uploadFile(long spaceId, Long folderId, byte[] content)
      throws Exception {
    long u = ownerOfSpace(spaceId);
    MockMultipartFile f = new MockMultipartFile("file", "data.txt", "text/plain", content);
    return driveFileService.upload(u, spaceId, folderId, f);
  }

  /** 공간 소유자 사용자 ID(seedUser 로 생성 후 공간에 연결). 동일 tx 이라 공간 소유자를 직접 얻기 위해 별도 생성. */
  private long seedUser() {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "qe_" + s)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "Qe" + s)
        .set(USER.EMAIL, "qe_" + s + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  /** space 소유자(OWNER)를 DB 에서 직접 조회. */
  private long ownerOfSpace(long spaceId) {
    return dsl.select(com.workplace.jooq.Tables.DRIVE_SPACE_MEMBER.USER_ID)
        .from(com.workplace.jooq.Tables.DRIVE_SPACE_MEMBER)
        .where(
            com.workplace.jooq.Tables.DRIVE_SPACE_MEMBER
                .SPACE_ID
                .eq(spaceId)
                .and(com.workplace.jooq.Tables.DRIVE_SPACE_MEMBER.ROLE.eq("OWNER")))
        .limit(1)
        .fetchOne(com.workplace.jooq.Tables.DRIVE_SPACE_MEMBER.USER_ID);
  }

  @Test
  void 한도_초과_업로드는_거부() throws Exception {
    // given: 한도 0으로 설정
    setTenantQuota(0L);
    DriveSpaceResponse space = createSpace();
    // when/then: 어떤 바이트든 업로드 거부
    assertThatThrownBy(() -> uploadFile(space.id(), "x".getBytes()))
        .isInstanceOf(DriveQuotaExceededException.class);
  }

  @Test
  void 한도_정확히_일치하면_허용() throws Exception {
    byte[] data = "hello".getBytes(); // 5바이트
    DriveSpaceResponse space = createSpace();
    setTenantQuota(5L);
    DriveFileResponse resp = uploadFile(space.id(), data); // 예외 없음
    assertThat(resp).isNotNull();
  }

  @Test
  void 누적_사용량이_한도를_막는다() throws Exception {
    // given: 한도 10바이트
    DriveSpaceResponse space = createSpace();
    setTenantQuota(10L);
    // 첫 번째 6바이트 — 통과
    uploadFile(space.id(), "aaaaaa".getBytes());
    // 두 번째 6바이트는 누적 12 > 10 → 거부되어야 한다
    assertThatThrownBy(() -> uploadFile(space.id(), "bbbbbb".getBytes()))
        .isInstanceOf(DriveQuotaExceededException.class);
  }

  @Test
  void 한도_초과_복사는_거부() throws Exception {
    // given: 먼저 파일을 업로드할 충분한 한도를 설정한다
    DriveSpaceResponse space = createSpace();
    setTenantQuota(5L);
    DriveFileResponse original = uploadFile(space.id(), "hello".getBytes()); // 5바이트 — 정확히 한도
    // when: 한도를 1바이트로 낮춰 복사 시 초과 발생 유도
    setTenantQuota(1L);
    long owner = ownerOfSpace(space.id());
    // then: 복사도 쿼터를 강제하므로 DriveQuotaExceededException 발생해야 한다
    assertThatThrownBy(() -> driveFileService.copy(owner, original.id(), null))
        .isInstanceOf(DriveQuotaExceededException.class);
  }

  @Test
  void 한도_초과_폴더_복사는_서브트리_합계로_거부() throws Exception {
    // given: 원본/ 에 4바이트, 원본/하위/ 에 3바이트 — 서브트리 합계 7바이트, 사용량 7
    DriveSpaceResponse space = createSpace();
    long owner = ownerOfSpace(space.id());
    long src = folderService.create(owner, space.id(), null, "원본").id();
    long child = folderService.create(owner, space.id(), src, "하위").id();
    long dest = folderService.create(owner, space.id(), null, "대상").id();
    uploadFile(space.id(), src, "aaaa".getBytes());
    uploadFile(space.id(), child, "bbb".getBytes());
    // when: 한도 13 — 파일 하나(4·3)씩은 들어가지만 합계 7 은 7+7=14 > 13 이라 넘친다(WP-697)
    setTenantQuota(13L);
    // then: 폴더 복사도 파일 복사처럼 거부되고 대상 폴더에 아무것도 생기지 않는다
    assertThatThrownBy(() -> folderService.copy(owner, src, dest))
        .isInstanceOf(DriveQuotaExceededException.class);
    assertThat(folderService.listItems(owner, space.id(), dest).folders()).isEmpty();
  }

  @Test
  void 한도_안의_폴더_복사는_허용() throws Exception {
    DriveSpaceResponse space = createSpace();
    long owner = ownerOfSpace(space.id());
    long src = folderService.create(owner, space.id(), null, "원본").id();
    long dest = folderService.create(owner, space.id(), null, "대상").id();
    uploadFile(space.id(), src, "aaaa".getBytes());
    // 한도 정확히 8 = 사용 4 + 복사 4
    setTenantQuota(8L);
    assertThat(folderService.copy(owner, src, dest).name()).isEqualTo("원본");
  }

  // --- 휴지통(WP-1391) — 휴지통 파일도 사용량에 들어가므로 빈 자리가 생기지 않고, 복원은 사용량을 늘리지 않아 막지 않는다 ---

  /** 휴지통에 있는지 — trashed_at 이 채워져 있으면 휴지통. */
  private boolean inTrash(long driveFileId) {
    return dsl.select(com.workplace.jooq.Tables.DRIVE_FILE.TRASHED_AT)
            .from(com.workplace.jooq.Tables.DRIVE_FILE)
            .where(com.workplace.jooq.Tables.DRIVE_FILE.ID.eq(driveFileId))
            .fetchOne(com.workplace.jooq.Tables.DRIVE_FILE.TRASHED_AT)
        != null;
  }

  @Test
  void 휴지통에_넣어도_사용량이_줄지_않아_그_자리에_업로드할_수_없다() throws Exception {
    // given: 한도 10 — A(6) 를 휴지통에 넣어도 A 는 여전히 사용량에 들어간다
    DriveSpaceResponse space = createSpace();
    long owner = ownerOfSpace(space.id());
    setTenantQuota(10L);
    DriveFileResponse a = uploadFile(space.id(), "aaaaaa".getBytes());
    driveFileService.delete(owner, a.id());
    // then: B(6) 는 6+6=12 > 10 이라 거부 — 예전(WP-696 이전)의 「휴지통 → 업로드 → 복원」 우회가 업로드 단계에서 막힌다
    assertThatThrownBy(() -> uploadFile(space.id(), "bbbbbb".getBytes()))
        .isInstanceOf(DriveQuotaExceededException.class)
        .hasMessageStartingWith("저장 용량을 초과했습니다");
  }

  @Test
  void 파일_복원은_한도를_넘긴_상태여도_허용() throws Exception {
    // given: A(6) 를 휴지통에 넣은 뒤 한도를 사용량 아래(1)로 낮춘다
    DriveSpaceResponse space = createSpace();
    long owner = ownerOfSpace(space.id());
    DriveFileResponse a = uploadFile(space.id(), "aaaaaa".getBytes());
    driveFileService.delete(owner, a.id());
    setTenantQuota(1L);
    // when: 복원 — 휴지통이 이미 사용량에 들어가 있어 복원해도 사용량이 늘지 않는다
    long usedBefore = quotaService.usedBytes();
    trashService.restoreFile(owner, a.id());
    // then: 거절 없이 되살아나고 사용량은 그대로
    assertThat(inTrash(a.id())).isFalse();
    assertThat(quotaService.usedBytes()).isEqualTo(usedBefore);
  }

  @Test
  void 폴더_복원은_한도를_넘긴_상태여도_허용() throws Exception {
    // given: 폴더/ 에 4, 폴더/하위/ 에 3 — 폴더째 휴지통에 넣고 한도를 사용량 아래로 낮춘다
    DriveSpaceResponse space = createSpace();
    long owner = ownerOfSpace(space.id());
    long folder = folderService.create(owner, space.id(), null, "폴더").id();
    long child = folderService.create(owner, space.id(), folder, "하위").id();
    DriveFileResponse x = uploadFile(space.id(), folder, "aaaa".getBytes());
    uploadFile(space.id(), child, "bbb".getBytes());
    folderService.delete(owner, folder);
    setTenantQuota(1L);
    // when/then: 함께 되살아나는 파일이 있어도 거절하지 않는다
    trashService.restoreFolder(owner, folder);
    assertThat(inTrash(x.id())).isFalse();
  }

  @Test
  void 폴더_복원은_먼저_따로_지운_파일을_되살리지_않는다() throws Exception {
    // given: 폴더/ 안의 y(5) 를 먼저 따로 휴지통에 넣고, 이어서 폴더(z 3 포함)를 휴지통에 넣는다
    DriveSpaceResponse space = createSpace();
    long owner = ownerOfSpace(space.id());
    long folder = folderService.create(owner, space.id(), null, "폴더").id();
    DriveFileResponse y = uploadFile(space.id(), folder, "yyyyy".getBytes());
    uploadFile(space.id(), folder, "zzz".getBytes());
    driveFileService.delete(owner, y.id());
    folderService.delete(owner, folder);
    // when: 폴더 복원으로 살아나는 것은 z(3) 뿐이다(y 는 다른 op 라 휴지통에 남는다)
    trashService.restoreFolder(owner, folder);
    assertThat(inTrash(y.id())).isTrue();
  }

  @Test
  void 빈_폴더_복원은_한도를_넘긴_상태여도_허용() throws Exception {
    DriveSpaceResponse space = createSpace();
    long owner = ownerOfSpace(space.id());
    long folder = folderService.create(owner, space.id(), null, "빈 폴더").id();
    folderService.delete(owner, folder);
    uploadFile(space.id(), "aaaa".getBytes());
    setTenantQuota(1L);
    trashService.restoreFolder(owner, folder);
    assertThat(folderService.listItems(owner, space.id(), null).folders())
        .anySatisfy(f -> assertThat(f.id()).isEqualTo(folder));
  }
}
