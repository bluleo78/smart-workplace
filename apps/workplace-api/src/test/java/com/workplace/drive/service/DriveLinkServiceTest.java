package com.workplace.drive.service;

import static com.workplace.jooq.Tables.*;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.drive.dto.DriveLinkResponse;
import com.workplace.drive.exception.DriveFileNotFoundException;
import com.workplace.drive.exception.DriveForbiddenException;
import com.workplace.drive.exception.DriveSpaceNotFoundException;
import com.workplace.file.service.FileUploadService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.jooq.tables.File;
import com.workplace.support.IntegrationTestBase;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.OffsetDateTime;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

@Transactional
class DriveLinkServiceTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired DriveLinkService service;

  @BeforeEach
  void t() {
    TenantContext.set(1L);
  }

  @AfterEach
  void c() {
    TenantContext.clear();
  }

  private long user(String p) {
    String s = UUID.randomUUID().toString().substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, p + s)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, p)
        .set(USER.EMAIL, p + s + "@x.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  // owner=OWNER 멤버, 옵션으로 viewer 를 VIEWER 로 추가하고 driveFileId 반환
  private long driveFile(long owner, Long viewer) {
    long space =
        dsl.insertInto(DRIVE_SPACE)
            .set(DRIVE_SPACE.TYPE, "TEAM")
            .set(DRIVE_SPACE.NAME, "S")
            .set(DRIVE_SPACE.OWNER_ID, owner)
            .returning(DRIVE_SPACE.ID)
            .fetchOne()
            .getId();
    dsl.insertInto(DRIVE_SPACE_MEMBER)
        .set(DRIVE_SPACE_MEMBER.SPACE_ID, space)
        .set(DRIVE_SPACE_MEMBER.USER_ID, owner)
        .set(DRIVE_SPACE_MEMBER.ROLE, "OWNER")
        .execute();
    if (viewer != null) {
      dsl.insertInto(DRIVE_SPACE_MEMBER)
          .set(DRIVE_SPACE_MEMBER.SPACE_ID, space)
          .set(DRIVE_SPACE_MEMBER.USER_ID, viewer)
          .set(DRIVE_SPACE_MEMBER.ROLE, "VIEWER")
          .execute();
    }
    // getLinkContent가 실제 파일을 읽으므로 실존하는 임시파일 경로 사용
    Path tmp;
    try {
      tmp = Files.createTempFile("drivelink-test-", ".txt");
      Files.writeString(tmp, "hi");
    } catch (IOException e) {
      throw new RuntimeException(e);
    }
    // AssertJ 와 충돌 방지: com.workplace.jooq.tables.File 명시 사용
    var F = File.FILE;
    long file =
        dsl.insertInto(F)
            .set(F.ORIGINAL_NAME, "a.txt")
            .set(F.STORED_NAME, "x")
            .set(F.MIME_TYPE, "text/plain")
            .set(F.SIZE_BYTES, 2L)
            .set(F.STORAGE_PATH, tmp.toString())
            .set(F.UPLOADED_BY, owner)
            .set(F.CREATED_AT, OffsetDateTime.now())
            .returning(F.ID)
            .fetchOne()
            .getId();
    return dsl.insertInto(DRIVE_FILE)
        .set(DRIVE_FILE.SPACE_ID, space)
        .set(DRIVE_FILE.FILE_ID, file)
        .set(DRIVE_FILE.NAME, "a.txt")
        .returning(DRIVE_FILE.ID)
        .fetchOne()
        .getId();
  }

  @Test
  void createLink_requiresViewer_thenListsActive() {
    long owner = user("owner");
    long df = driveFile(owner, null);

    service.createLink(owner, df, "ISSUE", 100L);
    service.createLink(owner, df, "ISSUE", 100L); // 멱등

    var links = service.listLinks("ISSUE", 100L);
    assertThat(links).hasSize(1);
    DriveLinkResponse l = links.get(0);
    assertThat(l.driveFileId()).isEqualTo(df);
    assertThat(l.availability()).isEqualTo("ACTIVE");
  }

  @Test
  void createLink_nonMember_forbidden() {
    long owner = user("owner");
    long stranger = user("stranger");
    long df = driveFile(owner, null);
    assertThatThrownBy(() -> service.createLink(stranger, df, "ISSUE", 100L))
        .isInstanceOfAny(DriveSpaceNotFoundException.class, DriveForbiddenException.class);
  }

  @Test
  void getLinkContent_requiresRefExists() throws Exception {
    long owner = user("owner");
    long df = driveFile(owner, null);
    // ref 없음 → 404 계열
    assertThatThrownBy(() -> service.getLinkContent("ISSUE", 100L, df))
        .isInstanceOf(DriveFileNotFoundException.class);
    // ref 생성 후엔 콘텐츠 반환
    service.createLink(owner, df, "ISSUE", 100L);
    FileUploadService.FileContentResult content = service.getLinkContent("ISSUE", 100L, df);
    assertThat(content.originalName()).isEqualTo("a.txt");
  }

  @Test
  void removeLink_onlyCreatorOrManager() {
    long owner = user("owner");
    long viewer = user("viewer");
    long df = driveFile(owner, viewer);
    service.createLink(viewer, df, "ISSUE", 100L); // viewer 가 생성

    // 타인이면서 컨텍스트 관리권 없음 → 거부
    assertThatThrownBy(() -> service.removeLink(owner, df, "ISSUE", 100L, false))
        .isInstanceOf(DriveForbiddenException.class);
    // 컨텍스트 관리권 있으면 허용
    service.removeLink(owner, df, "ISSUE", 100L, true);
    assertThat(service.listLinks("ISSUE", 100L)).isEmpty();
  }
}
