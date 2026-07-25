package com.workplace.drive.service;

import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.drive.dto.DriveFileResponse;
import com.workplace.drive.dto.DriveSpaceResponse;
import com.workplace.drive.repository.DriveFileRepository;
import com.workplace.file.exception.FileBlobMissingException;
import com.workplace.file.exception.FileNotFoundException;
import com.workplace.file.service.FileUploadService;
import com.workplace.file.storage.FileStore;
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
 * 드라이브 원본 blob 유실 가시화(#739) 통합 테스트 — 읽기 시점 판정({@code DriveFileResponse.available})과
 * 다운로드 404 구분(FileBlobMissingException vs FileNotFoundException)을 검증한다.
 */
@Transactional
class DriveFileAvailabilityTest extends IntegrationTestBase {
  @Autowired DSLContext dsl;
  @Autowired DriveSpaceService spaceService;
  @Autowired DriveFileService fileService;
  @Autowired DriveFileRepository fileRepository;
  @Autowired FileUploadService fileUploadService;
  @Autowired FileStore fileStore;

  @BeforeEach
  void setTenantContext() {
    TenantContext.set(1L);
  }

  @AfterEach
  void clearTenantContext() {
    TenantContext.clear();
  }

  private long seedUser() {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "av_" + s)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "Av" + s)
        .set(USER.EMAIL, "av_" + s + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  private MockMultipartFile txt() {
    return new MockMultipartFile("file", "memo.txt", "text/plain", "hello".getBytes());
  }

  /** 디스크 blob 을 직접 지워 "유실"을 재현한다(DB 행은 그대로 둔다). */
  private void deleteBlobOnDisk(long fileId) {
    String storagePath =
        dsl.select(FILE.STORAGE_PATH).from(FILE).where(FILE.ID.eq(fileId)).fetchOne(FILE.STORAGE_PATH);
    boolean deleted = fileStore.deleteIfExists(storagePath);
    assertThat(deleted).as("테스트 셋업: 실제로 디스크에서 지워졌어야 한다").isTrue();
  }

  /** 1. 업로드 후 목록 조회 → available == true. */
  @Test
  void listInFolder_returnsAvailableTrue_forFreshUpload() throws Exception {
    long u = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(u, "팀");
    DriveFileResponse uploaded = fileService.upload(u, sp.id(), null, txt());

    var listed =
        fileRepository.listInFolder(sp.id(), null).stream()
            .filter(f -> f.id() == uploaded.id())
            .findFirst()
            .orElseThrow();
    assertThat(listed.available()).isTrue();
  }

  /** 2. 디스크 blob 을 직접 삭제 후 목록 조회 → available == false (DB 행은 그대로). */
  @Test
  void listInFolder_returnsAvailableFalse_afterBlobDeletedOnDisk() throws Exception {
    long u = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(u, "팀");
    DriveFileResponse uploaded = fileService.upload(u, sp.id(), null, txt());

    deleteBlobOnDisk(uploaded.fileId());

    var listed =
        fileRepository.listInFolder(sp.id(), null).stream()
            .filter(f -> f.id() == uploaded.id())
            .findFirst()
            .orElseThrow();
    assertThat(listed.available()).isFalse();
    // DB 행 자체는 그대로 남아있다.
    var row = dsl.selectFrom(FILE).where(FILE.ID.eq(uploaded.fileId())).fetchOne();
    assertThat(row).isNotNull();
  }

  /** 3. blob 유실 파일 다운로드 → FileBlobMissingException(핸들러에서 404 + 유실 메시지로 매핑됨, GlobalExceptionHandlerTest 참조). */
  @Test
  void download_blobMissing_throwsFileBlobMissingException() throws Exception {
    long u = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(u, "팀");
    DriveFileResponse uploaded = fileService.upload(u, sp.id(), null, txt());

    deleteBlobOnDisk(uploaded.fileId());

    assertThatThrownBy(() -> fileService.download(u, uploaded.id()))
        .isInstanceOf(FileBlobMissingException.class);
  }

  /** 4. file 행 자체가 없는 fileId → 기존 FileNotFoundException 404(회귀 방지). */
  @Test
  void getFileContentTrusted_rowMissing_throwsFileNotFoundException() {
    long nonExistentFileId = -1L;
    assertThatThrownBy(() -> fileUploadService.getFileContentTrusted(nonExistentFileId))
        .isInstanceOf(FileNotFoundException.class);
  }

  /** 5. searchByName · findResponse 경로도 available 을 채우는지(3개 매퍼 전부). */
  @Test
  void searchByNameAndFindResponse_fillAvailable() throws Exception {
    long u = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(u, "팀");
    DriveFileResponse uploaded = fileService.upload(u, sp.id(), null, txt());

    // 정상 상태 — 둘 다 true
    var found = fileRepository.searchByName(sp.id(), "memo").stream().findFirst().orElseThrow();
    assertThat(found.available()).isTrue();
    assertThat(fileRepository.findResponse(uploaded.id()).orElseThrow().available()).isTrue();

    // blob 삭제 후 — 둘 다 false
    deleteBlobOnDisk(uploaded.fileId());
    var foundAfter =
        fileRepository.searchByName(sp.id(), "memo").stream().findFirst().orElseThrow();
    assertThat(foundAfter.available()).isFalse();
    assertThat(fileRepository.findResponse(uploaded.id()).orElseThrow().available()).isFalse();
  }
}
