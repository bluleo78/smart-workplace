package com.workplace.drive.outbound;

import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.DRIVE_SPACE;
import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.clearInvocations;

import com.workplace.drive.dto.DriveSpaceResponse;
import com.workplace.drive.service.DriveFileService;
import com.workplace.drive.service.DriveFolderService;
import com.workplace.drive.service.DriveSpaceService;
import com.workplace.global.realtime.SseRegistry;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.ResourceChangedCapture;
import com.workplace.support.ResourceChangedCapture.Captured;
import com.workplace.support.TestFixtures;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/**
 * WP-63 통합 — 드라이브 파일·폴더·스페이스 변경 → AFTER_COMMIT resource.changed 수신자 검증. AFTER_COMMIT 발화를 위해
 * 클래스에 @Transactional 을 붙이지 않는다.
 */
@DisplayName("드라이브 변경 → resource.changed fan-out 통합")
class DriveResourceChangedIntegrationTest extends IntegrationTestBase {

  @MockitoBean SseRegistry registry;

  @Autowired DSLContext dsl;
  @Autowired DriveSpaceService spaceService;
  @Autowired DriveFolderService folderService;
  @Autowired DriveFileService fileService;

  private final List<Long> userIds = new ArrayList<>();
  private final List<Long> spaceIds = new ArrayList<>();
  private long owner;
  private long member;
  private long outsider;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    owner = seedUser();
    member = seedUser();
    outsider = seedUser();
  }

  @AfterEach
  void cleanup() {
    // 스페이스 삭제 시 멤버·폴더·파일 행은 FK CASCADE 로 정리된다.
    dsl.deleteFrom(DRIVE_SPACE).where(DRIVE_SPACE.ID.in(spaceIds)).execute();
    // 업로드가 남긴 감사 로그·파일 행이 user FK 를 잡으므로 먼저 지운다.
    dsl.deleteFrom(AUDIT_LOG).where(AUDIT_LOG.USER_ID.in(userIds)).execute();
    dsl.deleteFrom(FILE).where(FILE.UPLOADED_BY.in(userIds)).execute();
    dsl.deleteFrom(USER).where(USER.ID.in(userIds)).execute();
    spaceIds.clear();
    userIds.clear();
    TenantContext.clear();
  }

  /** resource/op 조합의 resource.changed 를 캡처해 (수신자, payload) 를 돌려준다 — 공용 헬퍼 위임. */
  private Captured capture(String resource, String op) {
    return ResourceChangedCapture.capture(registry, resource, op);
  }

  private DriveSpaceResponse newTeamSpace() {
    DriveSpaceResponse sp = spaceService.createTeamSpace(owner, "rc-" + UUID.randomUUID());
    spaceIds.add(sp.id());
    return sp;
  }

  @Test
  @DisplayName("폴더 생성은 스페이스 멤버에게만, attrs 는 spaceId")
  void folderCreate_reachesSpaceMembers() {
    var sp = newTeamSpace();
    spaceService.addMember(owner, sp.id(), member, "EDITOR");
    clearInvocations(registry);

    folderService.create(owner, sp.id(), null, "f-" + UUID.randomUUID());

    var c = capture("drive", "created");
    assertThat(c.recipients()).contains(owner, member).doesNotContain(outsider);
    assertThat(c.payload()).containsEntry("spaceId", sp.id());
  }

  @Test
  @DisplayName("멤버 제거 알림은 제거된 사용자도 받는다")
  void removeMember_reachesRemovedUser() {
    var sp = newTeamSpace();
    spaceService.addMember(owner, sp.id(), member, "EDITOR");
    clearInvocations(registry);

    spaceService.removeMember(owner, sp.id(), member);

    assertThat(capture("drive-space", "updated").recipients()).contains(owner, member);
  }

  @Test
  @DisplayName("팀 스페이스 삭제는 삭제 전 멤버에게")
  void deleteTeamSpace_reachesMembersCollectedBefore() {
    var sp = newTeamSpace();
    spaceService.addMember(owner, sp.id(), member, "VIEWER");
    clearInvocations(registry);

    spaceService.deleteTeamSpace(owner, sp.id());

    var rec = capture("drive-space", "deleted").recipients();
    assertThat(rec).contains(owner, member).doesNotContain(outsider);
  }

  @Test
  @DisplayName("개인 스페이스 업로드는 소유자에게")
  void personalSpaceUpload_reachesOwner() throws Exception {
    var personal = spaceService.ensurePersonalSpace(owner);
    spaceIds.add(personal.id());
    clearInvocations(registry);

    fileService.upload(
        owner,
        personal.id(),
        null,
        new MockMultipartFile("file", "memo.txt", "text/plain", "hello".getBytes()));

    var c = capture("drive", "created");
    assertThat(c.recipients()).contains(owner).doesNotContain(outsider);
    assertThat(c.payload()).containsEntry("spaceId", personal.id());
  }

  /** 테넌트#1 ACTIVE 멤버 HUMAN 1명 — addMember 의 MembershipGuard 검증 통과용. 공용 픽스처로 만들고 정리 목록에 넣는다. */
  private long seedUser() {
    long id = withMembership(TestFixtures.createHuman(dsl));
    userIds.add(id);
    return id;
  }
}
