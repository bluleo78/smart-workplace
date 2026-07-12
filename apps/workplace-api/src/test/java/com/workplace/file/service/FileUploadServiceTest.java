package com.workplace.file.service;

import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.file.dto.FileUploadResponse;
import com.workplace.file.exception.FileNotFoundException;
import com.workplace.file.exception.FileSizeLimitExceededException;
import com.workplace.file.service.FileUploadService.FileContentResult;
import com.workplace.file.storage.FileStore;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Path;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.transaction.annotation.Transactional;

@Transactional
class FileUploadServiceTest extends IntegrationTestBase {

  @Autowired private FileUploadService fileUploadService;

  @Autowired private DSLContext dsl;
  @Autowired private FileStore fileStore;

  private Long testUserId;
  private Long otherUserId;

  @BeforeEach
  void setUp() {
    // 업로드 경로는 TenantContext(요청 스레드 테넌트)를 요구한다 — 테스트에선 tenant#1 로 고정.
    TenantContext.set(1L);
    testUserId =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "filetest_user")
            .set(USER.PASSWORD, "password")
            .set(USER.NAME, "File Test User")
            .set(USER.EMAIL, "filetest@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();

    otherUserId =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "other_user")
            .set(USER.PASSWORD, "password")
            .set(USER.NAME, "Other User")
            .set(USER.EMAIL, "other@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
  }

  @Test
  void uploadFiles_imageFile_success() throws IOException {
    MockMultipartFile file =
        new MockMultipartFile("files", "test.png", "image/png", "fake-png-content".getBytes());

    List<FileUploadResponse> responses = fileUploadService.uploadFiles(List.of(file), testUserId);

    assertThat(responses).hasSize(1);
    FileUploadResponse response = responses.get(0);
    assertThat(response.id()).isNotNull();
    assertThat(response.originalName()).isEqualTo("test.png");
    assertThat(response.mimeType()).isEqualTo("image/png");
    assertThat(response.fileCategory()).isEqualTo("IMAGE");
    assertThat(response.fileSize()).isEqualTo("fake-png-content".length());

    // storage_path 가 상대경로로 저장되는지 검증(절대경로 금지).
    String storagePath =
        dsl.select(FILE.STORAGE_PATH)
            .from(FILE)
            .where(FILE.ID.eq(response.id()))
            .fetchOne(FILE.STORAGE_PATH);
    assertThat(Path.of(storagePath).isAbsolute()).isFalse();
    assertThat(storagePath).contains("tenant-1/files/");
  }

  @Test
  void uploadFiles_svgFile_success() throws IOException {
    MockMultipartFile file =
        new MockMultipartFile("files", "icon.svg", "image/svg+xml", "<svg></svg>".getBytes());

    List<FileUploadResponse> responses = fileUploadService.uploadFiles(List.of(file), testUserId);

    assertThat(responses).hasSize(1);
    FileUploadResponse response = responses.get(0);
    assertThat(response.originalName()).isEqualTo("icon.svg");
    assertThat(response.mimeType()).isEqualTo("image/svg+xml");
    assertThat(response.fileCategory()).isEqualTo("IMAGE");
  }

  @Test
  void uploadFiles_pdfFile_success() throws IOException {
    MockMultipartFile file =
        new MockMultipartFile("files", "doc.pdf", "application/pdf", "fake-pdf-content".getBytes());

    List<FileUploadResponse> responses = fileUploadService.uploadFiles(List.of(file), testUserId);

    assertThat(responses).hasSize(1);
    assertThat(responses.get(0).fileCategory()).isEqualTo("PDF");
  }

  @Test
  void uploadFiles_csvFile_success() throws IOException {
    MockMultipartFile file =
        new MockMultipartFile("files", "data.csv", "text/csv", "a,b,c\n1,2,3".getBytes());

    List<FileUploadResponse> responses = fileUploadService.uploadFiles(List.of(file), testUserId);

    assertThat(responses).hasSize(1);
    assertThat(responses.get(0).fileCategory()).isEqualTo("DATA");
  }

  @Test
  void uploadFiles_textFile_success() throws IOException {
    MockMultipartFile file =
        new MockMultipartFile("files", "note.txt", "text/plain", "hello world".getBytes());

    List<FileUploadResponse> responses = fileUploadService.uploadFiles(List.of(file), testUserId);

    assertThat(responses).hasSize(1);
    assertThat(responses.get(0).fileCategory()).isEqualTo("TEXT");
  }

  // #732: Content-Type 유실(octet-stream) 업로드도 .html 확장자 폴백으로 text/html 로 저장돼
  // 프론트 미리보기가 HTML 렌더 분기를 타게 한다(과거엔 octet-stream 으로 남아 미리보기 실패).
  @Test
  void uploadFiles_htmlFile_octetStreamFallsBackToTextHtml() throws IOException {
    MockMultipartFile file =
        new MockMultipartFile(
            "files",
            "page.html",
            "application/octet-stream",
            "<!doctype html><h1>hi</h1>".getBytes());

    List<FileUploadResponse> responses = fileUploadService.uploadFiles(List.of(file), testUserId);

    assertThat(responses).hasSize(1);
    assertThat(responses.get(0).mimeType()).isEqualTo("text/html");
  }

  @Test
  void uploadFiles_previouslyBlockedType_storedAsOther() throws IOException {
    // 과거 화이트리스트에서 차단되던 유형(.exe)도 이제 저장 허용 — 미분류는 OTHER 카테고리로 저장된다.
    MockMultipartFile file =
        new MockMultipartFile(
            "files", "app.exe", "application/x-msdownload", "fake-exe".getBytes());

    List<FileUploadResponse> responses = fileUploadService.uploadFiles(List.of(file), testUserId);

    assertThat(responses).hasSize(1);
    assertThat(responses.get(0).originalName()).isEqualTo("app.exe");
    assertThat(responses.get(0).fileCategory()).isEqualTo("OTHER");
  }

  @Test
  void uploadFiles_otherTypeTooLarge_throwsException() {
    // OTHER 한도 25MB 초과 → 크기 예외.
    byte[] bigContent = new byte[26 * 1024 * 1024];
    MockMultipartFile file =
        new MockMultipartFile("files", "big.bin", "application/octet-stream", bigContent);

    assertThatThrownBy(() -> fileUploadService.uploadFiles(List.of(file), testUserId))
        .isInstanceOf(FileSizeLimitExceededException.class)
        .hasMessageContaining("OTHER");
  }

  @Test
  void uploadFiles_imageTooLarge_throwsException() {
    // IMAGE 한도 10MB 초과 케이스로 11MB 사용
    byte[] bigContent = new byte[11 * 1024 * 1024];
    MockMultipartFile file = new MockMultipartFile("files", "big.png", "image/png", bigContent);

    assertThatThrownBy(() -> fileUploadService.uploadFiles(List.of(file), testUserId))
        .isInstanceOf(FileSizeLimitExceededException.class)
        .hasMessageContaining("IMAGE");
  }

  @Test
  void uploadFiles_textTooLarge_throwsException() {
    // TEXT 한도 10MB 초과 케이스로 11MB 사용
    byte[] bigContent = new byte[11 * 1024 * 1024];
    MockMultipartFile file = new MockMultipartFile("files", "big.txt", "text/plain", bigContent);

    assertThatThrownBy(() -> fileUploadService.uploadFiles(List.of(file), testUserId))
        .isInstanceOf(FileSizeLimitExceededException.class)
        .hasMessageContaining("TEXT");
  }

  @Test
  void uploadFiles_tooManyFiles_throwsException() {
    MockMultipartFile f1 = new MockMultipartFile("files", "a.txt", "text/plain", "a".getBytes());
    MockMultipartFile f2 = new MockMultipartFile("files", "b.txt", "text/plain", "b".getBytes());
    MockMultipartFile f3 = new MockMultipartFile("files", "c.txt", "text/plain", "c".getBytes());
    MockMultipartFile f4 = new MockMultipartFile("files", "d.txt", "text/plain", "d".getBytes());

    assertThatThrownBy(() -> fileUploadService.uploadFiles(List.of(f1, f2, f3, f4), testUserId))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("Too many files");
  }

  @Test
  void getFileInfo_ownFile_success() throws IOException {
    MockMultipartFile file =
        new MockMultipartFile("files", "info.txt", "text/plain", "content".getBytes());
    List<FileUploadResponse> uploaded = fileUploadService.uploadFiles(List.of(file), testUserId);
    Long fileId = uploaded.get(0).id();

    FileUploadResponse info = fileUploadService.getFileInfo(fileId, testUserId);

    assertThat(info.id()).isEqualTo(fileId);
    assertThat(info.originalName()).isEqualTo("info.txt");
  }

  @Test
  void getFileInfo_otherUsersFile_throwsNotFound() throws IOException {
    MockMultipartFile file =
        new MockMultipartFile("files", "secret.txt", "text/plain", "secret".getBytes());
    List<FileUploadResponse> uploaded = fileUploadService.uploadFiles(List.of(file), testUserId);
    Long fileId = uploaded.get(0).id();

    assertThatThrownBy(() -> fileUploadService.getFileInfo(fileId, otherUserId))
        .isInstanceOf(FileNotFoundException.class);
  }

  /**
   * getFileContent()가 byte[] 대신 Resource를 반환하는지 검증. OOM 방지를 위해 스트리밍 방식(FileSystemResource)으로 파일을
   * 제공하므로 resource.getInputStream()으로 읽어 내용을 확인한다.
   */
  @Test
  void getFileContent_ownFile_returnsStreamableResource() throws IOException {
    byte[] fileBytes = "hello file content".getBytes();
    MockMultipartFile file = new MockMultipartFile("files", "content.txt", "text/plain", fileBytes);
    List<FileUploadResponse> uploaded = fileUploadService.uploadFiles(List.of(file), testUserId);
    Long fileId = uploaded.get(0).id();

    FileContentResult result = fileUploadService.getFileContent(fileId, testUserId);

    // byte[] 필드가 없고 Resource 필드로 스트리밍됨을 확인
    assertThat(result.resource()).isNotNull();
    assertThat(result.mimeType()).isEqualTo("text/plain");
    assertThat(result.originalName()).isEqualTo("content.txt");
    assertThat(result.size()).isEqualTo(fileBytes.length);

    // InputStream으로 읽어 실제 내용 동일성 검증
    try (InputStream is = result.resource().getInputStream()) {
      byte[] actual = is.readAllBytes();
      assertThat(actual).isEqualTo(fileBytes);
    }
  }

  /** 대용량 파일(스트리밍 대상)에서도 Resource가 올바르게 반환되는지 검증. 실제 OOM은 재현 불가이므로 구조적 검증(byte[] 미사용)으로 대체한다. */
  @Test
  void getFileContent_largeFile_returnsResourceWithCorrectSize() throws IOException {
    // 5MB 파일로 size 필드 정확성 검증
    byte[] largeBytes = new byte[5 * 1024 * 1024];
    new java.util.Random().nextBytes(largeBytes);
    MockMultipartFile file = new MockMultipartFile("files", "large.csv", "text/csv", largeBytes);
    List<FileUploadResponse> uploaded = fileUploadService.uploadFiles(List.of(file), testUserId);
    Long fileId = uploaded.get(0).id();

    FileContentResult result = fileUploadService.getFileContent(fileId, testUserId);

    assertThat(result.resource()).isNotNull();
    assertThat(result.size()).isEqualTo(largeBytes.length);
    assertThat(result.mimeType()).isEqualTo("text/csv");
  }

  @Test
  void getFileContent_otherUsersFile_throwsNotFound() throws IOException {
    MockMultipartFile file =
        new MockMultipartFile("files", "mine.txt", "text/plain", "content".getBytes());
    List<FileUploadResponse> uploaded = fileUploadService.uploadFiles(List.of(file), testUserId);
    Long fileId = uploaded.get(0).id();

    assertThatThrownBy(() -> fileUploadService.getFileContent(fileId, otherUserId))
        .isInstanceOf(FileNotFoundException.class);
  }

  @Test
  void copyFile_duplicatesBlob_withNewStoragePath_permanent() throws IOException {
    MockMultipartFile file =
        new MockMultipartFile("files", "doc.txt", "text/plain", "payload".getBytes());
    FileUploadResponse src = fileUploadService.uploadFiles(List.of(file), testUserId).get(0);
    String srcPath =
        dsl.select(FILE.STORAGE_PATH)
            .from(FILE)
            .where(FILE.ID.eq(src.id()))
            .fetchOne(FILE.STORAGE_PATH);

    long copyId = fileUploadService.copyFile(src.id(), otherUserId);

    // 새 FILE row, 다른 storage_path(= 물리적으로 분리된 디스크 파일)
    assertThat(copyId).isNotEqualTo(src.id());
    String copyPath =
        dsl.select(FILE.STORAGE_PATH)
            .from(FILE)
            .where(FILE.ID.eq(copyId))
            .fetchOne(FILE.STORAGE_PATH);
    assertThat(copyPath).isNotEqualTo(srcPath);
    // 영구(expires_at=null) — drive 복사는 단일 txn 이라 promote 단계 없이 바로 영구
    var exp =
        dsl.select(FILE.EXPIRES_AT).from(FILE).where(FILE.ID.eq(copyId)).fetchOne(FILE.EXPIRES_AT);
    assertThat(exp).isNull();
    // 콘텐츠 동일
    FileContentResult c = fileUploadService.getFileContentTrusted(copyId);
    try (InputStream in = c.resource().getInputStream()) {
      assertThat(new String(in.readAllBytes())).isEqualTo("payload");
    }
    assertThat(c.originalName()).isEqualTo("doc.txt");
  }

  @AfterEach
  void cleanupUploadedFilesFromDisk() {
    // 상대경로로 저장된 파일을 fileStore.deleteIfExists() 로 정리(Path.of() 직접 사용 시 CWD 기준으로 해석되어 오류).
    List<String> paths =
        dsl.select(FILE.STORAGE_PATH)
            .from(FILE)
            .where(FILE.UPLOADED_BY.eq(testUserId).or(FILE.UPLOADED_BY.eq(otherUserId)))
            .fetchInto(String.class);
    for (String p : paths) {
      try {
        fileStore.deleteIfExists(p);
      } catch (Exception ignored) {
      }
    }
    TenantContext.clear();
  }
}
