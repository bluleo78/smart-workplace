package com.workplace.drive.service;

import static com.workplace.jooq.Tables.DRIVE_FILE;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.drive.dto.DriveFileResponse;
import com.workplace.drive.dto.DriveFolderResponse;
import com.workplace.drive.dto.DriveSpaceResponse;
import com.workplace.drive.exception.DriveInvalidTargetException;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import java.util.Collections;
import java.util.List;
import java.util.UUID;
import java.util.stream.LongStream;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockMultipartFile;

/**
 * 드라이브 일괄 작업(ZIP·이동·삭제)의 선택 목록 정리(WP-795) — 같은 id 를 반복해 보내도 한 번만 처리하고, 한 요청에 고를 수 있는 항목 수에 상한을 둔다.
 * 191바이트 요청에 같은 5MB 파일 id 40개를 넣으면 ZIP 이 210MB 로 불어나고, 이동은 같은 id 2만 개로 16초가 걸렸다.
 */
@org.springframework.transaction.annotation.Transactional
class DriveBulkSelectionTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired DriveBulkService bulkService;
  @Autowired DriveZipService zipService;
  @Autowired DriveFileService fileService;
  @Autowired DriveFolderService folderService;
  @Autowired DriveSpaceService spaceService;

  private long owner;

  @BeforeEach
  void setTenant() {
    TenantContext.set(1L);
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  private DriveSpaceResponse createSpace() {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    owner =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "bs_" + s)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, "Bs" + s)
            .set(USER.EMAIL, "bs_" + s + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    return spaceService.createTeamSpace(owner, "팀_" + s.substring(0, 4));
  }

  private DriveFileResponse upload(long spaceId, Long folderId, String name) throws Exception {
    return fileService.upload(
        owner,
        spaceId,
        folderId,
        new MockMultipartFile("file", name, "text/plain", "x".getBytes()));
  }

  /** 1부터 n 까지 서로 다른 id — 상한 판정이 존재 여부 조회보다 먼저인지 보려고 없는 id 를 쓴다. */
  private static List<Long> distinctIds(int n) {
    return LongStream.rangeClosed(1, n).map(i -> 900_000_000L + i).boxed().toList();
  }

  @Test
  void ZIP_같은_파일과_폴더_id를_반복해도_항목은_한_번씩만_든다() throws Exception {
    DriveSpaceResponse space = createSpace();
    DriveFileResponse file = upload(space.id(), null, "report.txt");
    DriveFolderResponse docs = folderService.create(owner, space.id(), null, "docs");
    upload(space.id(), docs.id(), "a.txt");

    List<DriveZipService.ZipEntrySource> entries =
        zipService.collectEntries(
            owner,
            space.id(),
            Collections.nCopies(40, file.id()),
            Collections.nCopies(3, docs.id()));

    assertThat(entries.stream().map(DriveZipService.ZipEntrySource::path).toList())
        .containsExactly("report.txt", "docs/a.txt");
  }

  @Test
  void ZIP_고른_항목이_상한을_넘으면_조회_전에_400() {
    DriveSpaceResponse space = createSpace();
    assertThatThrownBy(
            () ->
                zipService.collectEntries(
                    owner, space.id(), distinctIds(DriveBulkSelection.MAX_ITEMS + 1), List.of()))
        .isInstanceOf(DriveInvalidTargetException.class)
        .hasMessageContaining("1,000개");
  }

  @Test
  void 이동_같은_id를_반복해도_한_번_옮기고_상한을_넘으면_400() throws Exception {
    DriveSpaceResponse space = createSpace();
    DriveFileResponse file = upload(space.id(), null, "move.txt");
    DriveFolderResponse target = folderService.create(owner, space.id(), null, "target");

    bulkService.bulkMove(
        owner, space.id(), Collections.nCopies(500, file.id()), List.of(), target.id());
    assertThat(
            dsl.select(DRIVE_FILE.FOLDER_ID)
                .from(DRIVE_FILE)
                .where(DRIVE_FILE.ID.eq(file.id()))
                .fetchOne(DRIVE_FILE.FOLDER_ID))
        .isEqualTo(target.id());

    // 파일·폴더를 합쳐 센다.
    assertThatThrownBy(
            () ->
                bulkService.bulkMove(
                    owner,
                    space.id(),
                    distinctIds(DriveBulkSelection.MAX_ITEMS),
                    List.of(1L),
                    target.id()))
        .isInstanceOf(DriveInvalidTargetException.class)
        .hasMessageContaining("1,000개");
  }

  @Test
  void 삭제_같은_id를_두_번_넣어도_404가_아니라_한_번_휴지통으로_가고_상한을_넘으면_400() throws Exception {
    DriveSpaceResponse space = createSpace();
    DriveFileResponse file = upload(space.id(), null, "del.txt");

    bulkService.bulkDelete(owner, space.id(), List.of(file.id(), file.id()), List.of());
    assertThat(
            dsl.select(DRIVE_FILE.TRASHED_AT)
                .from(DRIVE_FILE)
                .where(DRIVE_FILE.ID.eq(file.id()))
                .fetchOne(DRIVE_FILE.TRASHED_AT))
        .isNotNull();

    assertThatThrownBy(
            () ->
                bulkService.bulkDelete(
                    owner, space.id(), distinctIds(DriveBulkSelection.MAX_ITEMS + 1), List.of()))
        .isInstanceOf(DriveInvalidTargetException.class)
        .hasMessageContaining("1,000개");
  }
}
