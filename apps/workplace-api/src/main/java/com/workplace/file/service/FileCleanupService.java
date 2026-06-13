package com.workplace.file.service;

import static com.workplace.jooq.Tables.FILE;

import com.workplace.global.tenant.TenantScopedRunner;
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
  // FILE 은 RLS 적용 테이블 — 스케줄러/부팅 잡은 요청 스레드가 아니어서 GUC 가 비어 있다.
  // 활성 테넌트마다 컨텍스트+트랜잭션을 열어 GUC 를 주입(미주입 시 RLS fail-closed → 0행 삭제 버그)한다.
  private final TenantScopedRunner tenantScopedRunner;

  @PostConstruct
  public void cleanupOnStartup() {
    log.info("Running file cleanup on startup...");
    cleanupExpiredFiles();
  }

  /**
   * 만료된 업로드 파일을 정리한다 — 활성 테넌트별로 순회하며 각 테넌트의 만료 파일을 삭제한다. 스케줄러 본체는 비-트랜잭션이며, 테넌트별 트랜잭션 경계는
   * TenantScopedRunner 가 제공한다(자기-호출 프록시 우회 방지).
   */
  @Scheduled(fixedRate = 3_600_000)
  public void cleanupExpiredFiles() {
    tenantScopedRunner.forEachActiveTenant(tid -> cleanupExpiredForCurrentTenant());
  }

  /**
   * 현재 테넌트(GUC 설정됨)의 만료 업로드 파일을 정리한다.
   *
   * <p>디스크 파일 삭제에 성공한 경로만 추적하여 해당 경로에 해당하는 DB 레코드만 삭제한다. 디스크 삭제 실패 시 경고 로그만 남기고 DB 레코드는 유지하여 이후
   * 재시도가 가능하도록 한다. 이렇게 함으로써 디스크에 파일이 남아있지만 DB 추적이 사라지는 고아 파일(orphan) 문제를 방지한다. FILE 조회/삭제는 RLS
   * 대상이므로 반드시 TenantScopedRunner 가 연 트랜잭션(GUC 주입) 안에서 호출돼야 한다.
   *
   * <p>가시성: package-private — 단일 테넌트의 디스크 삭제 회귀(#152)를 검증하는 단위 테스트가 per-tenant 순회를 거치지 않고 직접 호출하기
   * 위함.
   */
  void cleanupExpiredForCurrentTenant() {
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
