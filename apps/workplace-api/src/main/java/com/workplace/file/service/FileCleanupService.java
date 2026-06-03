package com.workplace.file.service;

import static com.workplace.jooq.Tables.FILE;

import jakarta.annotation.PostConstruct;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.jooq.DSLContext;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
@Slf4j
public class FileCleanupService {

  private final DSLContext dsl;

  @PostConstruct
  public void cleanupOnStartup() {
    log.info("Running file cleanup on startup...");
    cleanupExpiredFiles();
  }

  /**
   * 만료된 업로드 파일을 정리한다.
   *
   * <p>디스크 파일 삭제에 성공한 경로만 추적하여 해당 경로에 해당하는 DB 레코드만 삭제한다. 디스크 삭제 실패 시 경고 로그만 남기고 DB 레코드는 유지하여 이후
   * 재시도가 가능하도록 한다. 이렇게 함으로써 디스크에 파일이 남아있지만 DB 추적이 사라지는 고아 파일(orphan) 문제를 방지한다.
   */
  @Scheduled(fixedRate = 3_600_000)
  public void cleanupExpiredFiles() {
    OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);

    // 만료 행의 원본+썸네일 경로를 함께 조회
    var expired =
        dsl.select(FILE.STORAGE_PATH, FILE.THUMBNAIL_PATH)
            .from(FILE)
            .where(FILE.EXPIRES_AT.lt(now))
            .fetch();

    if (expired.isEmpty()) {
      return;
    }

    // 디스크 삭제 성공한 원본 경로만 추적 — 실패한 경로는 DB 레코드를 유지하여 재시도 가능하게 함.
    // 썸네일은 원본 삭제에 성공할 때 best-effort 로 함께 삭제(실패해도 무시 — 고아 썸네일은 경미).
    List<String> successfullyDeletedPaths = new ArrayList<>();
    for (var row : expired) {
      String storagePath = row.get(FILE.STORAGE_PATH);
      String thumbnailPath = row.get(FILE.THUMBNAIL_PATH);
      try {
        Files.deleteIfExists(Path.of(storagePath));
        successfullyDeletedPaths.add(storagePath);
        if (thumbnailPath != null) {
          try {
            Files.deleteIfExists(Path.of(thumbnailPath));
          } catch (IOException te) {
            log.warn("썸네일 삭제 실패(무시): {}: {}", thumbnailPath, te.getMessage());
          }
        }
      } catch (IOException e) {
        log.warn(
            "디스크 파일 삭제 실패 — DB 레코드를 유지하여 다음 정리 사이클에서 재시도 가능: {}: {}", storagePath, e.getMessage());
      }
    }

    // 디스크 삭제 성공한 경로에 해당하는 DB 레코드만 삭제
    int dbDeleted = 0;
    if (!successfullyDeletedPaths.isEmpty()) {
      dbDeleted =
          dsl.deleteFrom(FILE).where(FILE.STORAGE_PATH.in(successfullyDeletedPaths)).execute();
    }

    int failedCount = expired.size() - successfullyDeletedPaths.size();
    log.info(
        "만료 업로드 파일 정리 완료 (전체: {}, 파일 삭제 성공: {}, DB 레코드 삭제: {}, 실패(DB 유지): {})",
        expired.size(),
        successfullyDeletedPaths.size(),
        dbDeleted,
        failedCount);
  }
}
