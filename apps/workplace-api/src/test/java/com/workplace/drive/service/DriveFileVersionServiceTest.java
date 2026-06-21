package com.workplace.drive.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.drive.dto.DriveSpaceResponse;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

/**
 * 동명 업로드 자동 버전화 테스트 (#79).
 *
 * <p>클래스-레벨 {@code @Transactional}: 테스트 종료 후 자동 롤백으로 공유 test DB 오염을 방지한다(쿼터 합산 오염 차단). upload 서비스는
 * 독립 {@code @Transactional} 이 없으면 같은 TX 에 합류하고, advisory lock 도 xact 스코프라 TX 안에서 정상 동작한다.
 */
@Transactional
class DriveFileVersionServiceTest extends IntegrationTestBase {
  @Autowired DriveFileService fileService;
  @Autowired DriveSpaceService spaceService;
  @Autowired DriveFolderService folderService;
  @Autowired com.workplace.drive.repository.DriveFileVersionRepository versions;
  @Autowired org.jooq.DSLContext dsl;

  /** 쿼터 합산 검증용 — 필드명 충돌 방지를 위해 quotaService 로 명명. */
  @Autowired com.workplace.drive.service.DriveQuotaService quotaService;

  @BeforeEach
  void setTenant() {
    TenantContext.set(1L);
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  private long seedUser() {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(com.workplace.jooq.Tables.USER)
        .set(com.workplace.jooq.Tables.USER.USERNAME, "vs_" + s)
        .set(com.workplace.jooq.Tables.USER.PASSWORD, "pw")
        .set(com.workplace.jooq.Tables.USER.NAME, "Vs" + s)
        .set(com.workplace.jooq.Tables.USER.EMAIL, "vs_" + s + "@example.com")
        .returning(com.workplace.jooq.Tables.USER.ID)
        .fetchOne()
        .getId();
  }

  private MultipartFile txt(String content) {
    return new MockMultipartFile("file", "doc.txt", "text/plain", content.getBytes());
  }

  @Test
  void 같은이름_재업로드_버전추가() throws Exception {
    long u = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(u, "팀");

    var first = fileService.upload(u, sp.id(), null, txt("v1"));
    var second = fileService.upload(u, sp.id(), null, txt("v2"));

    // 같은 drive_file 로 흡수 → 동일 id, version_count=2
    assertThat(second.id()).isEqualTo(first.id());
    assertThat(second.versionCount()).isEqualTo(2);
    // 목록에 중복 행이 생기지 않는다
    assertThat(folderService.listItems(u, sp.id(), null).files()).hasSize(1);
    // 버전 2개
    assertThat(versions.listForDriveFile(first.id())).hasSize(2);
  }

  @Test
  void 버전목록_current표시() throws Exception {
    long u = seedUser();
    var sp = spaceService.createTeamSpace(u, "팀");
    fileService.upload(u, sp.id(), null, txt("v1"));
    var second = fileService.upload(u, sp.id(), null, txt("v2"));

    var list = fileService.listVersions(u, second.id());
    assertThat(list).hasSize(2);
    assertThat(list.get(0).versionNo()).isEqualTo(2);
    assertThat(list.get(0).current()).isTrue(); // 최신이 현재
    assertThat(list.get(1).current()).isFalse();
  }

  @Test
  void 특정버전_다운로드() throws Exception {
    long u = seedUser();
    var sp = spaceService.createTeamSpace(u, "팀");
    var first = fileService.upload(u, sp.id(), null, txt("hello-v1"));
    fileService.upload(u, sp.id(), null, txt("hello-v2-longer"));

    var c = fileService.downloadVersion(u, first.id(), 1);
    assertThat(c.size()).isEqualTo("hello-v1".length());
  }

  @Test
  void 롤백_비파괴_새버전생성() throws Exception {
    long u = seedUser();
    var sp = spaceService.createTeamSpace(u, "팀");
    var first = fileService.upload(u, sp.id(), null, txt("v1-content"));
    fileService.upload(u, sp.id(), null, txt("v2-content-x"));

    // v1 로 롤백 → v3 생성(비파괴), 현재 내용은 v1 과 동일
    var after = fileService.rollback(u, first.id(), 1);
    assertThat(after.versionCount()).isEqualTo(3);

    var list = fileService.listVersions(u, first.id());
    assertThat(list).hasSize(3);
    assertThat(list.get(0).versionNo()).isEqualTo(3);
    assertThat(list.get(0).current()).isTrue();
    assertThat(list.get(0).comment()).contains("v1");

    // 새 버전 blob 은 v1 과 다른 file_id(물리 클론)
    assertThat(list.get(0).fileId()).isNotEqualTo(list.get(2).fileId());
    // 현재 다운로드 내용 = v1
    var c = fileService.download(u, first.id());
    assertThat(c.size()).isEqualTo("v1-content".length());
  }

  @Test
  void 쿼터_모든버전_산입() throws Exception {
    long u = seedUser();
    var sp = spaceService.createTeamSpace(u, "팀");
    long before = quotaService.usedBytes();
    fileService.upload(u, sp.id(), null, txt("12345")); // v1: 5 bytes
    fileService.upload(u, sp.id(), null, txt("1234567890")); // v2: 10 bytes (같은 이름)
    long after = quotaService.usedBytes();
    // 두 버전 blob 이 모두 산입되어 +15
    assertThat(after - before).isEqualTo(15L);
  }

  @Test
  void 다른이름_신규파일() throws Exception {
    long u = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(u, "팀");
    var a =
        fileService.upload(
            u, sp.id(), null, new MockMultipartFile("file", "a.txt", "text/plain", "a".getBytes()));
    var b =
        fileService.upload(
            u, sp.id(), null, new MockMultipartFile("file", "b.txt", "text/plain", "b".getBytes()));
    assertThat(b.id()).isNotEqualTo(a.id());
    assertThat(a.versionCount()).isEqualTo(1);
  }
}
