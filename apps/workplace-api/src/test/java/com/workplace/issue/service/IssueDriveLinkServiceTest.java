package com.workplace.issue.service;

import static com.workplace.jooq.Tables.*;
import static org.assertj.core.api.Assertions.*;

import com.workplace.drive.dto.DriveLinkResponse;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.jooq.tables.File;
import com.workplace.project.dto.AddMemberRequest;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.exception.ProjectAccessDeniedException;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** 이슈 드라이브 링크 서비스 통합 테스트. */
@Transactional
class IssueDriveLinkServiceTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired IssueDriveLinkService service;
  @Autowired IssueRepository issueRepository;
  @Autowired ProjectService projectService;

  @BeforeEach
  void setTenant() {
    TenantContext.set(1L);
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  // ── 픽스처 헬퍼 ──────────────────────────────────────────────────────────

  /** 테스트용 사용자 생성 후 id 반환. */
  private Long createUser(String prefix) {
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
    return id;
  }

  /** 프로젝트 생성. */
  private ProjectResponse newProject(Long ownerId, String prefix) {
    String key =
        prefix + UUID.randomUUID().toString().replace("-", "").substring(0, 4).toUpperCase();
    return projectService.create(ownerId, new CreateProjectRequest(key, "P-" + prefix, "x"));
  }

  /** 프로젝트에 멤버 추가. */
  private void addMember(ProjectResponse project, Long userId, String role) {
    projectService.addMember(project.ownerId(), project.key(), new AddMemberRequest(userId, role));
  }

  /** 이슈 생성. */
  private void issue(ProjectResponse project, int number, Long owner) {
    issueRepository.insert(project.id(), number, "t", null, "MID", null, owner);
  }

  /**
   * 드라이브 파일 생성(스페이스+파일 row 포함). owner 만 스페이스 멤버로 추가. 크로스 링크 테스트를 위해 viewer 는 의도적으로 스페이스에 추가하지 않는다.
   */
  private long seedDriveFileOwnedBy(long owner) {
    long space =
        dsl.insertInto(DRIVE_SPACE)
            .set(DRIVE_SPACE.TYPE, "TEAM")
            .set(DRIVE_SPACE.NAME, "S-" + UUID.randomUUID().toString().substring(0, 6))
            .set(DRIVE_SPACE.OWNER_ID, owner)
            .returning(DRIVE_SPACE.ID)
            .fetchOne()
            .getId();
    dsl.insertInto(DRIVE_SPACE_MEMBER)
        .set(DRIVE_SPACE_MEMBER.SPACE_ID, space)
        .set(DRIVE_SPACE_MEMBER.USER_ID, owner)
        .set(DRIVE_SPACE_MEMBER.ROLE, "OWNER")
        .execute();

    Path tmp;
    try {
      tmp = Files.createTempFile("drivelink-issue-test-", ".txt");
      Files.writeString(tmp, "hello");
    } catch (IOException e) {
      throw new RuntimeException(e);
    }

    var F = File.FILE;
    long fileId =
        dsl.insertInto(F)
            .set(F.ORIGINAL_NAME, "a.txt")
            .set(F.STORED_NAME, "x-" + UUID.randomUUID())
            .set(F.MIME_TYPE, "text/plain")
            .set(F.SIZE_BYTES, 5L)
            .set(F.STORAGE_PATH, tmp.toString())
            .set(F.UPLOADED_BY, owner)
            .set(F.CREATED_AT, OffsetDateTime.now())
            .returning(F.ID)
            .fetchOne()
            .getId();

    return dsl.insertInto(DRIVE_FILE)
        .set(DRIVE_FILE.SPACE_ID, space)
        .set(DRIVE_FILE.FILE_ID, fileId)
        .set(DRIVE_FILE.NAME, "a.txt")
        .returning(DRIVE_FILE.ID)
        .fetchOne()
        .getId();
  }

  // ── 테스트 ────────────────────────────────────────────────────────────────

  @Test
  void member_links_driveFile_andLists() {
    // given
    long owner = createUser("owner");
    ProjectResponse p = newProject(owner, "DL");
    issue(p, 1, owner);
    long df = seedDriveFileOwnedBy(owner);

    // when
    service.add(owner, p.key(), 1, df);
    List<DriveLinkResponse> links = service.list(owner, p.key(), 1);

    // then: 링크가 정확히 1건, driveFileId 일치
    assertThat(links).extracting(DriveLinkResponse::driveFileId).containsExactly(df);
  }

  @Test
  void nonMember_cannotLink() {
    // given: stranger 는 프로젝트 멤버가 아님
    long owner = createUser("owner");
    long stranger = createUser("stranger");
    ProjectResponse p = newProject(owner, "DL");
    issue(p, 1, owner);
    long df = seedDriveFileOwnedBy(owner);

    // then: ProjectAccessDeniedException (RuntimeException 하위)
    assertThatThrownBy(() -> service.add(stranger, p.key(), 1, df))
        .isInstanceOf(ProjectAccessDeniedException.class);
  }

  @Test
  void download_authorizedByIssueMembership_notDriveMembership() throws IOException {
    // given: member 는 프로젝트 멤버지만 드라이브 스페이스 비멤버
    long owner = createUser("owner");
    long member = createUser("member");
    ProjectResponse p = newProject(owner, "DL");
    addMember(p, member, "MEMBER");
    issue(p, 1, owner);
    long df = seedDriveFileOwnedBy(owner); // owner 만 스페이스 멤버

    service.add(owner, p.key(), 1, df);

    // when: 드라이브 비멤버인 member 가 이슈 링크로 다운로드
    var content = service.content(member, p.key(), 1, df);

    // then: 성공 — originalName 반환
    assertThat(content.originalName()).isNotBlank();
  }
}
