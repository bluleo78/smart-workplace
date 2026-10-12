package com.workplace.platform.purge;

import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.MAIL_ATTACHMENT_BLOB;
import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.TENANT;
import static com.workplace.jooq.Tables.USER;

import com.workplace.file.storage.FileStore;
import com.workplace.global.tenant.TenantScopedRunner;
import com.workplace.platform.repository.PlatformTenantRepository;
import com.workplace.user.dto.UserKind;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.InvalidPathException;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.concurrent.atomic.AtomicReference;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.jooq.DSLContext;
import org.jooq.Table;
import org.jooq.impl.DSL;
import org.jooq.impl.SQLDataType;
import org.springframework.core.NestedExceptionUtils;
import org.springframework.stereotype.Service;
import org.springframework.util.FileSystemUtils;

/**
 * 테넌트 영구 삭제 3단계 오케스트레이션.
 *
 * <ol>
 *   <li>대상 테넌트 GUC 아래 한 트랜잭션: 디스크 경로·AGENT 수집 → {@link TenantPurgePlan#ORDER} 순서 DELETE → 잔여 0행
 *       확인(아니면 예외로 전체 롤백)
 *   <li>커밋 후 디스크 정리(best-effort): {@code tenant-{id}/} 재귀 삭제 + 레거시 절대경로 파일
 *   <li>{@code purge_tenant()} 로 전용 AGENT·tenant 행 제거(membership·user_api_token 은 tenant FK
 *       CASCADE)
 * </ol>
 *
 * <p>단계 1 실패(롤백)만 DELETED + purge_error 로 되돌린다 — 데이터가 그대로라 복원 가능하다. 단계 3 실패는 데이터가 이미 지워졌으므로 PURGING
 * 을 유지하고 사유만 남겨 잡이 재시도한다. 모든 단계가 멱등(재실행 시 단계 1 은 0행 삭제로 통과)이라 중단 후 재실행해도 이어서 끝난다.
 *
 * <p>메일 첨부 캐시({@code MailAttachmentBlobStore})는 FileStore 와 같은 {@code workplace.storage.root-dir}
 * 루트를 쓰고 파일을 {@code tenant-{id}/mail/} 아래에 두므로, 같은 테넌트 디렉터리 삭제로 함께 정리된다(별도 루트 처리 불필요).
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class TenantPurgeService {

  private final DSLContext dsl;
  private final TenantScopedRunner runner;
  private final FileStore fileStore;
  private final PlatformTenantRepository tenantRepository;

  /** 단계 1 결과 — 커밋 후 단계 2·3 에 넘긴다. */
  private record Collected(List<String> legacyPaths, Long[] agentIds) {}

  /** 테넌트 하나를 영구 삭제한다. 실패는 상태/사유로 기록하고 예외를 삼킨다(잡이 다음 테넌트로 계속 진행하도록). */
  public void purge(long tenantId) {
    purge(tenantId, Set.of());
  }

  /** 테스트 훅: skipTables 의 테이블은 지우지 않는다(잔여 확인 실패 재현용). 운영 코드는 빈 집합으로만 호출. */
  void purge(long tenantId, Set<String> skipTables) {
    log.info("테넌트 {} 영구 삭제 시작", tenantId);
    // 단계 1 — 실패하면 트랜잭션 전체가 롤백되므로 DELETED 로 되돌려 복원 가능 상태로 둔다.
    Collected collected;
    try {
      collected = deleteData(tenantId, skipTables);
    } catch (RuntimeException e) {
      log.warn("테넌트 {} 영구 삭제 실패(데이터 단계) — DELETED 로 되돌림", tenantId, e);
      tenantRepository.markPurgeFailed(tenantId, reasonOf(e));
      return;
    }
    // 단계 1 진입 시 PURGING 이 아니었다(복원·중복 실행 등) — 아무것도 지우지 않았으므로 단계 2·3 도 건너뛴다.
    if (collected == null) return;
    // 단계 2 — 디스크는 best-effort(내부에서 예외를 삼킨다).
    cleanDisk(tenantId, collected.legacyPaths());
    // 단계 3 — 전용 AGENT 와 tenant 행 제거. 실패해도 데이터는 이미 지워졌으므로 PURGING 유지 + 사유 기록.
    try {
      Boolean done =
          dsl.select(
                  DSL.field(
                      "purge_tenant({0}, {1})",
                      Boolean.class,
                      DSL.val(tenantId),
                      DSL.val(collected.agentIds(), SQLDataType.BIGINT.array())))
              .fetchOne(0, Boolean.class);
      log.info("테넌트 {} 영구 삭제 완료(행 제거={})", tenantId, done);
    } catch (RuntimeException e) {
      log.warn("테넌트 {} 영구 삭제 실패(행 제거 단계) — PURGING 유지, 다음 주기에 재시도", tenantId, e);
      tenantRepository.recordPurgeError(tenantId, reasonOf(e));
    }
  }

  /**
   * 단계 1 — 대상 테넌트 GUC 아래 한 트랜잭션(RLS 로 다른 테넌트 행에 닿지 않음). 잔여가 있으면 예외로 전체 롤백.
   *
   * @return 수집 결과. 테넌트가 PURGING 이 아니면 아무것도 지우지 않고 null.
   */
  private Collected deleteData(long tenantId, Set<String> skipTables) {
    AtomicReference<Collected> holder = new AtomicReference<>();
    runner.runForTenant(
        tenantId,
        tid -> {
          // 되돌릴 수 없는 삭제 전에 상태를 행 잠금과 함께 재확인한다. 잡이 들고 있던 id 목록이 오래됐을 수 있다(락 만료 후 다른
          // 파드가 동시 실행, 그 사이 단계 1 실패 → DELETED → 운영자 복원 → ACTIVE). FOR UPDATE 로 이 트랜잭션 동안 복원 전환도
          // 막는다.
          String status =
              dsl.select(TENANT.STATUS)
                  .from(TENANT)
                  .where(TENANT.ID.eq(tid))
                  .forUpdate()
                  .fetchOne(TENANT.STATUS);
          if (!"PURGING".equals(status)) {
            log.warn("테넌트 {} 상태가 PURGING 이 아님({}) — 영구 삭제 건너뜀", tid, status);
            return;
          }
          // 레거시 절대경로만 수집 — 상대경로는 tenant-{id}/ 아래라 디렉터리 삭제로 처리된다. 행을 지우기 전에 모아 둔다.
          List<String> legacy = new ArrayList<>();
          dsl.select(FILE.STORAGE_PATH, FILE.THUMBNAIL_PATH)
              .from(FILE)
              .where(FILE.TENANT_ID.eq(tid))
              .forEach(
                  r -> {
                    addIfAbsolute(legacy, r.value1());
                    addIfAbsolute(legacy, r.value2());
                  });
          dsl.select(MAIL_ATTACHMENT_BLOB.FILE_REF)
              .from(MAIL_ATTACHMENT_BLOB)
              .where(MAIL_ATTACHMENT_BLOB.TENANT_ID.eq(tid))
              .forEach(r -> addIfAbsolute(legacy, r.value1()));
          // 이 테넌트 멤버 중 AGENT 후보 — 다른 테넌트에도 소속된 AGENT·다른 테넌트에도 소속된 사람의 개인 비서는 purge_tenant() 가 다시 걸러
          // 남긴다.
          Long[] agents =
              dsl.select(USER.ID)
                  .from(USER)
                  .join(MEMBERSHIP)
                  .on(MEMBERSHIP.USER_ID.eq(USER.ID))
                  .where(MEMBERSHIP.TENANT_ID.eq(tid))
                  .and(USER.KIND.eq(UserKind.AGENT))
                  .fetchArray(USER.ID);

          // 자식 → 부모 순서로 테이블별 DELETE. RLS 와 WHERE 가 이중으로 대상 테넌트만 지운다.
          for (Table<?> t : TenantPurgePlan.ORDER) {
            if (skipTables.contains(t.getName())) continue;
            int n =
                dsl.deleteFrom(t)
                    .where(DSL.field(DSL.name("tenant_id"), Long.class).eq(tid))
                    .execute();
            if (n > 0) log.info("테넌트 {} 영구 삭제: {} {}행", tid, t.getName(), n);
          }
          assertNoLeftovers(tid);
          holder.set(new Collected(legacy, agents));
        });
    return holder.get();
  }

  /**
   * 잔여 확인 — 카탈로그상 tenant_id 를 가진 모든 BASE TABLE(제외 목록 빼고)이 이 테넌트 기준 0행이어야 한다. ORDER 에서 빠진 테이블(특히 FK
   * 가 없어 tenant 삭제가 막히지 않는 테이블)을 커밋 전에 잡는다. 카탈로그는 pg_class 로 읽는다(information_schema 는 권한 있는 테이블만 보여
   * 누락을 숨길 수 있다).
   */
  private void assertNoLeftovers(long tenantId) {
    List<String> tables =
        TenantPurgePlan.tenantTableNames(dsl).stream()
            .filter(name -> !TenantPurgePlan.EXCLUDED.contains(name))
            .sorted()
            .toList();
    List<String> leftovers = new ArrayList<>();
    for (String name : tables) {
      int n =
          dsl.fetchCount(
              DSL.table(DSL.name(name)), DSL.field(DSL.name("tenant_id"), Long.class).eq(tenantId));
      if (n > 0) leftovers.add(name + " " + n + "행");
    }
    if (!leftovers.isEmpty()) {
      throw new IllegalStateException("잔여 데이터 확인 실패: " + String.join(", ", leftovers));
    }
  }

  /** 단계 2 — 디스크 best-effort. 실패는 경고만 남긴다(tenant id 는 재사용되지 않아 남은 파일이 다른 테넌트와 섞이지 않는다). */
  private void cleanDisk(long tenantId, List<String> legacyPaths) {
    Path dir = fileStore.rootDir().resolve("tenant-" + tenantId);
    try {
      FileSystemUtils.deleteRecursively(dir);
      if (Files.exists(dir)) {
        log.warn("테넌트 {} 디렉터리가 일부 남았습니다: {}", tenantId, dir);
      }
    } catch (IOException e) {
      log.warn("테넌트 {} 디렉터리 삭제 실패: {}", tenantId, dir, e);
    }
    for (String p : legacyPaths) {
      try {
        fileStore.deleteIfExists(p);
      } catch (RuntimeException e) {
        log.warn("테넌트 {} 레거시 파일 삭제 실패: {}", tenantId, p, e);
      }
    }
  }

  /** 콘솔에 보일 실패 사유 — 가장 안쪽 원인 메시지(잔여 확인 예외는 자기 자신). jOOQ/Spring 래퍼의 SQL 문자열 대신 실제 DB 오류가 남는다. */
  private static String reasonOf(Throwable e) {
    Throwable cause = NestedExceptionUtils.getMostSpecificCause(e);
    String msg = cause.getMessage();
    return msg != null ? msg : cause.getClass().getSimpleName();
  }

  /** 절대경로(레거시 저장 형식)만 목록에 담는다. 잘못된 경로 문자열은 건너뛴다. */
  private static void addIfAbsolute(List<String> out, String path) {
    if (path == null) return;
    try {
      if (Path.of(path).isAbsolute()) out.add(path);
    } catch (InvalidPathException e) {
      // 디스크에 존재할 수 없는 경로 — 지울 대상이 없다.
    }
  }
}
