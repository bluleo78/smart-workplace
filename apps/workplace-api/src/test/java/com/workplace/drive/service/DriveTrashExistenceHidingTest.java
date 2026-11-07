package com.workplace.drive.service;

import static com.workplace.jooq.Tables.DRIVE_FILE;
import static com.workplace.jooq.Tables.DRIVE_FOLDER;
import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowable;

import com.workplace.drive.exception.DriveForbiddenException;
import com.workplace.drive.exception.DriveNotInTrashException;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.assertj.core.api.SoftAssertions;
import org.assertj.core.api.ThrowableAssert.ThrowingCallable;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.transaction.annotation.Transactional;

/** 휴지통 항목 id 만으로 비멤버에게 존재 여부가 새지 않고, 멤버의 기존 권한은 유지되는지 검증한다. */
@Transactional
class DriveTrashExistenceHidingTest extends IntegrationTestBase {
  @Autowired DSLContext dsl;
  @Autowired DriveSpaceService spaceService;
  @Autowired DriveFileService fileService;
  @Autowired DriveFolderService folderService;
  @Autowired DriveTrashService trashService;

  private long owner;
  private long nonMember;
  private long viewer;
  private long spaceId;
  private long fileId;
  private long blobId;
  private long folderId;

  /** 같은 테넌트의 비멤버·VIEWER 와 실제 휴지통 파일·폴더를 준비한다. */
  @BeforeEach
  void setUp() throws Exception {
    TenantContext.set(1L);
    owner = seedUser();
    nonMember = seedUser();
    viewer = seedUser();
    spaceId = spaceService.createTeamSpace(owner, "휴지통 권한 테스트").id();
    spaceService.addMember(owner, spaceId, viewer, "VIEWER");
    var file =
        fileService.upload(
            owner,
            spaceId,
            null,
            new MockMultipartFile("file", "memo.txt", "text/plain", "hello".getBytes()));
    fileId = file.id();
    blobId = file.fileId();
    folderId = folderService.create(owner, spaceId, null, "보고서").id();
    fileService.delete(owner, fileId);
    folderService.delete(owner, folderId);
  }

  /** 테스트 스레드에 테넌트가 남지 않도록 정리한다. */
  @AfterEach
  void clearTenantContext() {
    TenantContext.clear();
  }

  /** 파일 복원·영구삭제의 실제 id 와 없는 id 는 비멤버에게 같은 예외·문구를 반환한다. */
  @Test
  void nonMember_fileMutationsMatchMissingTrashResponse() {
    SoftAssertions.assertSoftly(
        soft -> {
          assertHiddenAsMissing(
              soft,
              () -> trashService.restoreFile(nonMember, fileId),
              () -> trashService.restoreFile(nonMember, Long.MAX_VALUE));
          assertHiddenAsMissing(
              soft,
              () -> trashService.purgeFile(nonMember, fileId),
              () -> trashService.purgeFile(nonMember, Long.MAX_VALUE));
        });
    assertThat(trashService.listTrash(owner, spaceId).items()).hasSize(2);
  }

  /** 폴더 복원·영구삭제도 파일과 동일하게 비멤버에게 존재 여부를 숨긴다. */
  @Test
  void nonMember_folderMutationsMatchMissingTrashResponse() {
    SoftAssertions.assertSoftly(
        soft -> {
          assertHiddenAsMissing(
              soft,
              () -> trashService.restoreFolder(nonMember, folderId),
              () -> trashService.restoreFolder(nonMember, Long.MAX_VALUE));
          assertHiddenAsMissing(
              soft,
              () -> trashService.purgeFolder(nonMember, folderId),
              () -> trashService.purgeFolder(nonMember, Long.MAX_VALUE));
        });
    assertThat(trashService.listTrash(owner, spaceId).items()).hasSize(2);
  }

  /** 멤버인 VIEWER 의 네 변경 경로는 존재 은닉으로 바뀌지 않고 권한 부족으로 거부된다. */
  @Test
  void viewerTrashMutationsRemainForbidden() {
    SoftAssertions.assertSoftly(
        soft -> {
          soft.assertThatThrownBy(() -> trashService.restoreFile(viewer, fileId))
              .isExactlyInstanceOf(DriveForbiddenException.class);
          soft.assertThatThrownBy(() -> trashService.purgeFile(viewer, fileId))
              .isExactlyInstanceOf(DriveForbiddenException.class);
          soft.assertThatThrownBy(() -> trashService.restoreFolder(viewer, folderId))
              .isExactlyInstanceOf(DriveForbiddenException.class);
          soft.assertThatThrownBy(() -> trashService.purgeFolder(viewer, folderId))
              .isExactlyInstanceOf(DriveForbiddenException.class);
        });
    assertThat(trashService.listTrash(owner, spaceId).items()).hasSize(2);
  }

  /** OWNER 는 파일·폴더를 복원한 뒤 다시 휴지통에 보내 영구삭제할 수 있다. */
  @Test
  void ownerCanRestoreAndPurgeTrashItems() {
    trashService.restoreFile(owner, fileId);
    trashService.restoreFolder(owner, folderId);

    var restored = folderService.listItems(owner, spaceId, null);
    assertThat(restored.files()).anyMatch(file -> file.id() == fileId);
    assertThat(restored.folders()).anyMatch(folder -> folder.id() == folderId);
    assertThat(trashService.listTrash(owner, spaceId).items()).isEmpty();

    fileService.delete(owner, fileId);
    folderService.delete(owner, folderId);
    trashService.purgeFile(owner, fileId);
    trashService.purgeFolder(owner, folderId);

    assertThat(dsl.fetchExists(DRIVE_FILE, DRIVE_FILE.ID.eq(fileId))).isFalse();
    assertThat(dsl.fetchExists(DRIVE_FOLDER, DRIVE_FOLDER.ID.eq(folderId))).isFalse();
    assertThat(
            dsl.select(FILE.EXPIRES_AT)
                .from(FILE)
                .where(FILE.ID.eq(blobId))
                .fetchOne(FILE.EXPIRES_AT))
        .isNotNull();
    assertThat(trashService.listTrash(owner, spaceId).items()).isEmpty();
  }

  /** 없는 id 의 응답과 실제 id 의 응답을 모두 독립적인 계약 값으로 검증한다. */
  private void assertHiddenAsMissing(
      SoftAssertions soft, ThrowingCallable actualMutation, ThrowingCallable missingMutation) {
    Throwable missing = catchThrowable(missingMutation);
    Throwable actual = catchThrowable(actualMutation);
    soft.assertThat(missing)
        .isExactlyInstanceOf(DriveNotInTrashException.class)
        .hasMessage("휴지통에 없는 항목입니다");
    soft.assertThat(actual)
        .isExactlyInstanceOf(DriveNotInTrashException.class)
        .hasMessage("휴지통에 없는 항목입니다");
  }

  /** 공간 멤버 초대 검증에 필요한 테넌트#1 ACTIVE 멤버십까지 함께 만든다. */
  private long seedUser() {
    String suffix = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "trash_hide_" + suffix)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, "휴지통 " + suffix)
            .set(USER.EMAIL, "trash_hide_" + suffix + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    dsl.insertInto(MEMBERSHIP)
        .set(MEMBERSHIP.USER_ID, id)
        .set(MEMBERSHIP.TENANT_ID, 1L)
        .set(MEMBERSHIP.STATUS, "ACTIVE")
        .execute();
    return id;
  }
}
