package com.workplace.file.service;

import static com.workplace.jooq.Tables.FILE;

import com.workplace.file.api.ExpiredFileRetentionPolicy;
import com.workplace.file.storage.FileStore;
import com.workplace.global.tenant.TenantScopedRunner;
import jakarta.annotation.PostConstruct;
import java.io.IOException;
import java.nio.file.Files;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
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
  // 상대경로(신규) 및 절대경로(레거시) 모두 올바른 디스크 경로로 복원하기 위해 FileStore 경유.
  private final FileStore fileStore;
  // #759 만료 파일 삭제 직전 도메인에 되묻는 훅(현재 구현체: WikiAttachmentRetentionPolicy).
  private final List<ExpiredFileRetentionPolicy> retentionPolicies;

  /**
   * 한 사이클(테넌트 1회)에 처리할 최대 건수.
   *
   * <p>SELECT ... FOR UPDATE 가 잡은 FILE 행 잠금은 디스크 삭제 루프가 끝날 때까지 유지된다. 상한이 없으면 만료가 대량으로 쌓였을 때 분 단위로
   * 잠금을 들고 있게 되고, 그 사이 같은 파일을 승격하려는 페이지 저장이 줄을 선다. 남은 것은 다음 사이클(1시간)에 처리된다.
   */
  private static final int MAX_PER_CYCLE = 500;

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

    // 만료 행의 id + 원본/썸네일 경로를 함께 조회 (id 는 #759 보존 정책 조회용).
    // FOR UPDATE SKIP LOCKED: #759 이후 만료 집합에는 "참조가 빠져 유예 중인, 사용자에게 보이던 페이지 이미지"
    // 가 들어온다. 락이 없으면 SELECT 와 DELETE 사이에 사용자가 그 이미지를 다시 붙여넣고 저장(승격)해도
    // 스윕이 그대로 지워 살아 있는 데이터가 사라진다. SKIP LOCKED 라 승격 중인 행은 이번 사이클을 건너뛴다
    // (사용자 저장을 블록하지 않는다 — 다음 사이클에 다시 판정된다).
    var expired =
        dsl.select(FILE.ID, FILE.STORAGE_PATH, FILE.THUMBNAIL_PATH)
            .from(FILE)
            .where(FILE.EXPIRES_AT.lt(now))
            .orderBy(FILE.EXPIRES_AT)
            .limit(MAX_PER_CYCLE)
            .forUpdate()
            .skipLocked()
            .fetch();

    if (expired.isEmpty()) {
      return;
    }

    // #759 도메인에 되묻는다 — 만료됐지만 아직 참조가 살아 있는 파일은 지우지 않는다.
    // 노트 첨부는 "참조 해제 = 만료 재무장" 이라, 판정 시점과 이 삭제 시점 사이(유예 기간)에 참조가
    // 되살아났을 수 있다. 여기서 걸러내지 않으면 살아 있는 이미지가 사라진다.
    // 위 SELECT 가 행 잠금을 잡은 뒤이므로, 이 판정과 아래 삭제 사이에 승격이 끼어들 수 없다.
    Set<Long> retained = new HashSet<>();
    for (var policy : retentionPolicies) {
      retained.addAll(policy.retain(expired.map(r -> r.get(FILE.ID))));
    }
    if (!retained.isEmpty()) {
      log.info("만료 파일 중 참조가 살아 있어 보존: {}건", retained.size());
    }

    // 디스크 삭제 성공한 파일 id 만 추적 — 실패한 것은 DB 레코드를 유지하여 재시도 가능하게 함.
    // 썸네일은 원본 삭제에 성공할 때 best-effort 로 함께 삭제(실패해도 무시 — 고아 썸네일은 경미).
    List<Long> successfullyDeletedIds = new ArrayList<>();
    for (var row : expired) {
      if (retained.contains(row.get(FILE.ID))) continue;
      String storagePath = row.get(FILE.STORAGE_PATH);
      String thumbnailPath = row.get(FILE.THUMBNAIL_PATH);
      try {
        Files.deleteIfExists(fileStore.resolve(storagePath));
        successfullyDeletedIds.add(row.get(FILE.ID));
        if (thumbnailPath != null) {
          try {
            Files.deleteIfExists(fileStore.resolve(thumbnailPath));
          } catch (IOException te) {
            log.warn("썸네일 삭제 실패(무시): {}: {}", thumbnailPath, te.getMessage());
          }
        }
      } catch (IOException e) {
        log.warn(
            "디스크 파일 삭제 실패 — DB 레코드를 유지하여 다음 정리 사이클에서 재시도 가능: {}: {}", storagePath, e.getMessage());
      }
    }

    // 디스크 삭제에 성공한 행만 id 로 삭제한다. 경로 기준 삭제는 같은 경로를 공유하는 다른 행까지
    // 지울 위험이 있고, 만료 여부 재확인도 못 한다. EXPIRES_AT 재확인은 위 행 잠금과 함께 이중 방어다.
    int dbDeleted = 0;
    if (!successfullyDeletedIds.isEmpty()) {
      dbDeleted =
          dsl.deleteFrom(FILE)
              .where(FILE.ID.in(successfullyDeletedIds))
              .and(FILE.EXPIRES_AT.lt(now))
              .execute();
    }

    int failedCount = expired.size() - retained.size() - successfullyDeletedIds.size();
    log.info(
        "만료 업로드 파일 정리 완료 (전체: {}, 파일 삭제 성공: {}, DB 레코드 삭제: {}, 실패(DB 유지): {})",
        expired.size(),
        successfullyDeletedIds.size(),
        dbDeleted,
        failedCount);
  }
}
