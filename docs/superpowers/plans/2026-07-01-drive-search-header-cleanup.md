# 드라이브 헤더/검색 정리 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 드라이브 페이지의 "드라이브" 타이틀 3중 노출을 제거(브레드크럼만 유지)하고, 파일명 검색+콘텐츠 검색 2개의 검색창을 헤더의 검색 입력 1개로 통합한다(현재 공간 스코프로 통일, embedded 모드도 동일 적용, AI Overview는 풀페이지만).

**Architecture:** 백엔드 콘텐츠 검색(`DriveContentSearchController/Service/Repository`)에 선택적 `spaceId` 필터를 추가해 스코프를 공간 단위로 좁힌다. 프론트 `DrivePage`는 기존 300ms debounce 검색 효과에서 파일명 검색(`driveApi.search`)과 콘텐츠 검색(`searchDriveContent`)을 동시 호출하고, 결과를 "파일명 일치"/"내용 일치" 두 그룹으로 렌더링한다. 본문에 독립적으로 있던 `DriveSearchBar` 컴포넌트는 삭제하고 그 로직을 `DrivePage`로 흡수한다. `PageHeader`는 `title`을 optional prop으로 바꿔 타이틀 없이 렌더 가능하게 한다.

**Tech Stack:** Spring Boot(jOOQ raw SQL), React 19 + TanStack Query 없이 useState/useEffect(기존 패턴 유지), Playwright E2E.

## Global Constraints

- 마이그레이션 없음 — 기존 컬럼(`drive_file.space_id`)만 사용.
- 백엔드 SQL 텍스트 블록 스타일(`"""..."""`, `dsl.fetch(sql, params...)`) 기존 패턴 유지.
- 프론트 검색 debounce 300ms, 최소 검색어 2자 — 기존 파일명 검색 조건 그대로 재사용.
- AI Overview 버튼은 `bg-ai-accent-subtle text-ai-accent` 토큰만 사용(신규 색 도입 금지).
- 모든 새 코드에 한국어 주석(클래스·메서드·주요 로직) — 루트 [코딩 컨벤션](../../docs/CODING_CONVENTION.md) 준수.
- 프론트 변경에는 반드시 E2E 회귀 테스트 동반(`apps/workplace-web/CLAUDE.md` 테스트 작성 의무).

---

## Task 1: 백엔드 — DriveContentSearchRepository 에 공간 스코프 필터 추가

**Files:**
- Modify: `apps/workplace-api/src/main/java/com/workplace/drive/repository/DriveContentSearchRepository.java`
- Test: `apps/workplace-api/src/test/java/com/workplace/drive/repository/DriveContentSearchRepositoryTest.java`

**Interfaces:**
- Consumes: 없음(리포지토리 최하단 레이어)
- Produces: `hybridSearch(long userId, String query, float[] queryVec, int limit, Long spaceId)` — `spaceId`가 `null`이면 기존과 동일(테넌트 전역), 값이 있으면 해당 공간으로 결과 제한. `ContentRow` 레코드 시그니처는 불변.

- [ ] **Step 1: 기존 테스트 호출부에 신규 파라미터 추가(컴파일 통과용, 동작 불변 확인)**

`DriveContentSearchRepositoryTest.java`의 두 기존 테스트 메서드 호출을 아래처럼 수정한다(5번째 인자로 `null` 추가 — 스코프 필터 없음, 기존 동작 그대로):

```java
  @Test
  void hybridSearch_returns_only_accessible_files_ranked_by_rrf() {
    long mine = seedDriveFileWithExtraction(spaceA, "분기 매출 보고서", "Q3 매출 성장");
    long notMine = seedDriveFileWithExtraction(spaceOther, "비밀 보고서", "Q3 매출 성장");

    var hits = repo.hybridSearch(userA, "매출", null /* 벡터 없음 = 키워드 전용 */, 10, null);
    var ids = hits.stream().map(DriveContentSearchRepository.ContentRow::driveFileId).toList();

    assertThat(ids).contains(mine).doesNotContain(notMine); // 멤버십 필터
  }

  @Test
  void hybridSearch_keyword_only_when_vector_null_still_returns_snippet() {
    long f = seedDriveFileWithExtraction(spaceA, "회의록", "프로젝트 일정 논의");

    var hits = repo.hybridSearch(userA, "일정", null, 10, null);

    assertThat(hits)
        .anySatisfy(
            h -> {
              assertThat(h.driveFileId()).isEqualTo(f);
              assertThat(h.snippet()).contains("일정"); // ts_headline 발췌
            });
  }
```

**신규 실패 테스트**: 같은 파일 아래 새 테스트 메서드를 추가한다. `userA`가 두 공간(`spaceA`, `spaceB`) 모두 멤버이고 두 공간에 동일 키워드로 매칭되는 파일이 있을 때, `spaceId=spaceA`로 호출하면 `spaceB` 파일이 제외되어야 한다.

```java
  /** userA 가 두 공간 모두 멤버라도, spaceId 를 지정하면 그 공간의 파일만 반환해야 한다(스코프 제한). */
  @Test
  void hybridSearch_withSpaceId_scopesToThatSpaceOnly() {
    long spaceB = seedSpaceWithMember("공간C", userA); // userA 가 멤버인 두 번째 공간
    long inA = seedDriveFileWithExtraction(spaceA, "A공간 보고서", "분기 실적 요약");
    long inB = seedDriveFileWithExtraction(spaceB, "B공간 보고서", "분기 실적 요약");

    var hits = repo.hybridSearch(userA, "실적", null, 10, spaceA);
    var ids = hits.stream().map(DriveContentSearchRepository.ContentRow::driveFileId).toList();

    assertThat(ids).contains(inA).doesNotContain(inB);
  }
```

- [ ] **Step 2: 테스트 실행 — 컴파일 에러 확인**

Run: `cd apps/workplace-api && ./gradlew test --tests "com.workplace.drive.repository.DriveContentSearchRepositoryTest"`
Expected: FAIL — `hybridSearch(long, String, float[], int, Long)` 시그니처가 없어 컴파일 에러.

- [ ] **Step 3: Repository 구현 — spaceId 파라미터 추가**

`DriveContentSearchRepository.java` 전체를 아래 내용으로 교체한다:

```java
package com.workplace.drive.repository;

import java.util.ArrayList;
import java.util.List;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.springframework.stereotype.Repository;

/**
 * Drive 콘텐츠 하이브리드 검색. 키워드(tsvector websearch) 랭크와 벡터(pgvector 코사인) 랭크를 RRF 로 병합. RLS 가 테넌트를,
 * drive_space_member 조인이 사용자 접근을 스코프한다. 벡터가 null 이면 키워드 전용. spaceId 가 있으면 해당 공간으로 결과를 추가 제한한다.
 */
@Repository
public class DriveContentSearchRepository {

  /** RRF 상수 k. */
  private static final int K = 60;

  /** 후보 풀(각 랭커가 가져올 상위 N). */
  private static final int CANDIDATES = 50;

  /** 미스 페널티 rank(후보 풀 밖 = 51). */
  private static final int MISS_RANK = CANDIDATES + 1;

  private final DSLContext dsl;

  public DriveContentSearchRepository(DSLContext dsl) {
    this.dsl = dsl;
  }

  /** 하이브리드 검색 결과 행. */
  public record ContentRow(
      long driveFileId,
      long fileId,
      long spaceId,
      String spaceName,
      String fileName,
      String mimeType,
      String snippet,
      double score) {}

  /**
   * 하이브리드(또는 키워드 전용) 검색 진입점.
   *
   * @param queryVec 쿼리 임베딩(null 이면 벡터 랭커 생략 → 키워드 전용 graceful degradation)
   * @param spaceId null 이면 테넌트 전역, 값이 있으면 해당 공간의 파일로만 결과를 제한
   */
  public List<ContentRow> hybridSearch(
      long userId, String query, float[] queryVec, int limit, Long spaceId) {
    if (queryVec != null) {
      return hybridSearchWithVector(userId, query, toVectorLiteral(queryVec), limit, spaceId);
    }
    return keywordOnlySearch(userId, query, limit, spaceId);
  }

  /**
   * 키워드 전용 검색(벡터 없음). vec CTE 를 제거해 null 바인딩 타입 추론 오류를 회피. RRF 점수 = 1/(K+rank_kw) + 1/(K+MISS_RANK)
   * — 벡터 랭커 부재 시 상수 페널티. spaceId 가 있으면 accessible CTE 에 공간 필터를 추가한다.
   */
  private List<ContentRow> keywordOnlySearch(long userId, String query, int limit, Long spaceId) {
    String spaceFilter = spaceId != null ? "AND df.space_id = ?" : "";
    String sql =
        """
        WITH accessible AS (
          SELECT df.id AS drive_file_id, df.file_id, df.space_id, ds.name AS space_name,
                 df.name AS file_name, f.mime_type, fe.search_tv, fe.extracted_text
          FROM file_extraction fe
          JOIN drive_file df ON df.file_id = fe.file_id
          JOIN drive_space_member m ON m.space_id = df.space_id AND m.user_id = ?
          JOIN drive_space ds ON ds.id = df.space_id
          JOIN file f ON f.id = fe.file_id
          WHERE fe.status = 'DONE'
          %s
        ),
        kw AS (
          SELECT drive_file_id,
                 row_number() OVER (ORDER BY ts_rank(search_tv, websearch_to_tsquery('simple', ?)) DESC) AS rnk
          FROM accessible
          WHERE search_tv @@ websearch_to_tsquery('simple', ?)
          ORDER BY ts_rank(search_tv, websearch_to_tsquery('simple', ?)) DESC
          LIMIT ?
        ),
        merged AS (
          SELECT a.drive_file_id, a.file_id, a.space_id, a.space_name, a.file_name, a.mime_type, a.extracted_text,
                 (1.0/(? + kw.rnk)) + (1.0/(? + ?)) AS score
          FROM accessible a
          JOIN kw ON kw.drive_file_id = a.drive_file_id
        )
        SELECT m.drive_file_id, m.file_id, m.space_id, m.space_name, m.file_name, m.mime_type, m.score,
               ts_headline('simple', m.extracted_text, websearch_to_tsquery('simple', ?),
                           'MaxFragments=2, MaxWords=18, MinWords=6') AS snippet
        FROM merged m
        ORDER BY m.score DESC
        LIMIT ?
        """
            .formatted(spaceFilter);
    List<Object> params = new ArrayList<>();
    params.add(userId);
    if (spaceId != null) params.add(spaceId);
    params.add(query);
    params.add(query);
    params.add(query);
    params.add(CANDIDATES);
    params.add(K);
    params.add(K);
    params.add(MISS_RANK);
    params.add(query);
    params.add(limit);
    return dsl.fetch(sql, params.toArray()).map(this::toRow);
  }

  /**
   * 키워드 + 벡터 하이브리드 검색. 두 랭커를 RRF 로 병합. 미접근 파일은 drive_space_member 조인으로 배제.
   * spaceId 가 있으면 accessible CTE 에 공간 필터를 추가한다.
   */
  private List<ContentRow> hybridSearchWithVector(
      long userId, String query, String vecLiteral, int limit, Long spaceId) {
    String spaceFilter = spaceId != null ? "AND df.space_id = ?" : "";
    String sql =
        """
        WITH accessible AS (
          SELECT df.id AS drive_file_id, df.file_id, df.space_id, ds.name AS space_name,
                 df.name AS file_name, f.mime_type, fe.search_tv, fe.embedding, fe.extracted_text
          FROM file_extraction fe
          JOIN drive_file df ON df.file_id = fe.file_id
          JOIN drive_space_member m ON m.space_id = df.space_id AND m.user_id = ?
          JOIN drive_space ds ON ds.id = df.space_id
          JOIN file f ON f.id = fe.file_id
          WHERE fe.status = 'DONE'
          %s
        ),
        kw AS (
          SELECT drive_file_id,
                 row_number() OVER (ORDER BY ts_rank(search_tv, websearch_to_tsquery('simple', ?)) DESC) AS rnk
          FROM accessible
          WHERE search_tv @@ websearch_to_tsquery('simple', ?)
          ORDER BY ts_rank(search_tv, websearch_to_tsquery('simple', ?)) DESC
          LIMIT ?
        ),
        vec AS (
          SELECT drive_file_id,
                 row_number() OVER (ORDER BY embedding <=> cast(? as vector)) AS rnk
          FROM accessible
          WHERE embedding IS NOT NULL
          ORDER BY embedding <=> cast(? as vector)
          LIMIT ?
        ),
        merged AS (
          SELECT a.drive_file_id, a.file_id, a.space_id, a.space_name, a.file_name, a.mime_type, a.extracted_text,
                 (1.0/(? + COALESCE(kw.rnk, ?))) + (1.0/(? + COALESCE(vec.rnk, ?))) AS score
          FROM accessible a
          LEFT JOIN kw  ON kw.drive_file_id  = a.drive_file_id
          LEFT JOIN vec ON vec.drive_file_id = a.drive_file_id
          WHERE kw.rnk IS NOT NULL OR vec.rnk IS NOT NULL
        )
        SELECT m.drive_file_id, m.file_id, m.space_id, m.space_name, m.file_name, m.mime_type, m.score,
               ts_headline('simple', m.extracted_text, websearch_to_tsquery('simple', ?),
                           'MaxFragments=2, MaxWords=18, MinWords=6') AS snippet
        FROM merged m
        ORDER BY m.score DESC
        LIMIT ?
        """
            .formatted(spaceFilter);
    List<Object> params = new ArrayList<>();
    params.add(userId);
    if (spaceId != null) params.add(spaceId);
    params.add(query);
    params.add(query);
    params.add(query);
    params.add(CANDIDATES);
    params.add(vecLiteral);
    params.add(vecLiteral);
    params.add(CANDIDATES);
    params.add(K);
    params.add(MISS_RANK);
    params.add(K);
    params.add(MISS_RANK);
    params.add(query);
    params.add(limit);
    return dsl.fetch(sql, params.toArray()).map(this::toRow);
  }

  private ContentRow toRow(Record r) {
    return new ContentRow(
        ((Number) r.get("drive_file_id")).longValue(),
        ((Number) r.get("file_id")).longValue(),
        ((Number) r.get("space_id")).longValue(),
        (String) r.get("space_name"),
        (String) r.get("file_name"),
        (String) r.get("mime_type"),
        (String) r.get("snippet"),
        ((Number) r.get("score")).doubleValue());
  }

  /** float[] → pgvector 리터럴. */
  static String toVectorLiteral(float[] v) {
    StringBuilder sb = new StringBuilder("[");
    for (int i = 0; i < v.length; i++) {
      if (i > 0) sb.append(',');
      sb.append(v[i]);
    }
    return sb.append(']').toString();
  }
}
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

Run: `cd apps/workplace-api && ./gradlew test --tests "com.workplace.drive.repository.DriveContentSearchRepositoryTest"`
Expected: PASS (3개 테스트 모두, 신규 `hybridSearch_withSpaceId_scopesToThatSpaceOnly` 포함)

- [ ] **Step 5: Commit**

```bash
git add apps/workplace-api/src/main/java/com/workplace/drive/repository/DriveContentSearchRepository.java \
        apps/workplace-api/src/test/java/com/workplace/drive/repository/DriveContentSearchRepositoryTest.java
git commit -m "feat(drive): 콘텐츠 검색 리포지토리에 공간 스코프 필터 추가"
```

---

## Task 2: 백엔드 — DriveContentSearchService 에 spaceId 전달

**Files:**
- Modify: `apps/workplace-api/src/main/java/com/workplace/drive/service/DriveContentSearchService.java`
- Test: `apps/workplace-api/src/test/java/com/workplace/drive/service/DriveContentSearchServiceTest.java`

**Interfaces:**
- Consumes: `DriveContentSearchRepository.hybridSearch(long, String, float[], int, Long)` (Task 1에서 생성)
- Produces: `DriveContentSearchService.search(long userId, String q, Integer limit, Long spaceId)` — Task 3(컨트롤러)이 이 시그니처로 호출.

- [ ] **Step 1: 기존 테스트 호출부 + verify 매처에 5번째 인자 추가**

`DriveContentSearchServiceTest.java` 전체를 아래 내용으로 교체한다(모든 `svc.search(...)` 호출에 4번째 인자 `null` 추가, 모든 `repo.hybridSearch(...)` 매처에 5번째 인자 `isNull()` 추가):

```java
package com.workplace.drive.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.drive.outbound.WorkerEmbedClient;
import com.workplace.drive.repository.DriveContentSearchRepository;
import com.workplace.drive.repository.DriveContentSearchRepository.ContentRow;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

/** DriveContentSearchService 단위 테스트. repo/embedClient 를 목킹해 매핑·강등·경계·스코프 로직을 검증한다. */
@ExtendWith(MockitoExtension.class)
class DriveContentSearchServiceTest {

  @Mock DriveContentSearchRepository repo;
  @Mock WorkerEmbedClient embedClient;

  DriveContentSearchService svc;

  @BeforeEach
  void setUp() {
    svc = new DriveContentSearchService(repo, embedClient);
  }

  /** 2자 미만 쿼리는 레포 호출 없이 빈 결과를 즉시 반환해야 한다. */
  @Test
  void search_shortQuery_returnsEmpty() {
    var result = svc.search(1L, "a", null, null);

    assertThat(result.hits()).isEmpty();
    assertThat(result.semantic()).isFalse();
    verify(repo, org.mockito.Mockito.never())
        .hybridSearch(anyLong(), anyString(), any(), anyInt(), any());
  }

  /** null 쿼리는 2자 미만으로 처리해 빈 결과를 반환해야 한다. */
  @Test
  void search_nullQuery_returnsEmpty() {
    var result = svc.search(1L, null, null, null);

    assertThat(result.hits()).isEmpty();
  }

  /**
   * 임베딩 성공 시 벡터가 레포로 전달되고, semantic=true 로 응답해야 한다. ContentRow 의 fileName 이 DriveContentHit.name
   * 으로, spaceName 이 그대로 매핑되는지 검증.
   */
  @Test
  void search_withVector_returnsSemantic_andMapsFields() {
    float[] vec = {0.1f, 0.2f};
    ContentRow row =
        new ContentRow(10L, 20L, 30L, "기획팀 공간", "예산안.docx", "application/vnd.docx", "예산 발췌", 0.85);
    when(embedClient.embedQuery("예산")).thenReturn(Optional.of(vec));
    when(repo.hybridSearch(eq(1L), eq("예산"), eq(vec), eq(10), isNull())).thenReturn(List.of(row));

    var result = svc.search(1L, "예산", null, null);

    assertThat(result.semantic()).isTrue();
    assertThat(result.hits()).hasSize(1);
    var hit = result.hits().get(0);
    assertThat(hit.driveFileId()).isEqualTo(10L);
    assertThat(hit.fileId()).isEqualTo(20L);
    assertThat(hit.spaceId()).isEqualTo(30L);
    assertThat(hit.spaceName()).isEqualTo("기획팀 공간"); // spaceName 매핑 검증
    assertThat(hit.name()).isEqualTo("예산안.docx"); // ContentRow.fileName → hit.name
    assertThat(hit.mimeType()).isEqualTo("application/vnd.docx");
    assertThat(hit.snippet()).isEqualTo("예산 발췌");
    assertThat(hit.score()).isEqualTo(0.85);
  }

  /** 임베딩 실패(empty) 시 벡터 null 로 레포를 호출하고 semantic=false 를 반환해야 한다(키워드 전용 강등). */
  @Test
  void search_embedFails_degradesToKeywordOnly() {
    ContentRow row = new ContentRow(1L, 2L, 3L, "공간", "파일.txt", "text/plain", "발췌", 0.5);
    when(embedClient.embedQuery("검색어")).thenReturn(Optional.empty());
    when(repo.hybridSearch(eq(1L), eq("검색어"), isNull(), eq(10), isNull())).thenReturn(List.of(row));

    var result = svc.search(1L, "검색어", null, null);

    assertThat(result.semantic()).isFalse();
    assertThat(result.hits()).hasSize(1);
  }

  /** limit 파라미터가 상한(50)·하한(1)으로 클램핑되는지 검증. */
  @Test
  void search_limitClamping() {
    when(embedClient.embedQuery(anyString())).thenReturn(Optional.empty());
    when(repo.hybridSearch(anyLong(), anyString(), isNull(), eq(50), any())).thenReturn(List.of());

    svc.search(1L, "쿼리", 999, null); // 상한 초과

    verify(repo).hybridSearch(anyLong(), anyString(), isNull(), eq(50), any());
  }

  /** limit 파라미터가 null 이면 기본값(10)으로 레포를 호출해야 한다. */
  @Test
  void search_uses_default_limit_when_null() {
    when(embedClient.embedQuery(anyString())).thenReturn(Optional.empty());
    when(repo.hybridSearch(anyLong(), anyString(), isNull(), eq(10), any())).thenReturn(List.of());

    svc.search(1L, "쿼리", null, null);

    verify(repo).hybridSearch(anyLong(), anyString(), isNull(), eq(10), any());
  }

  /** spaceId 가 지정되면 그대로 레포로 전달되어야 한다(공간 스코프 검색). */
  @Test
  void search_withSpaceId_passesThroughToRepo() {
    when(embedClient.embedQuery(anyString())).thenReturn(Optional.empty());
    when(repo.hybridSearch(anyLong(), anyString(), isNull(), eq(10), eq(42L))).thenReturn(List.of());

    svc.search(1L, "쿼리", null, 42L);

    verify(repo).hybridSearch(anyLong(), anyString(), isNull(), eq(10), eq(42L));
  }
}
```

- [ ] **Step 2: 테스트 실행 — 컴파일 에러 확인**

Run: `cd apps/workplace-api && ./gradlew test --tests "com.workplace.drive.service.DriveContentSearchServiceTest"`
Expected: FAIL — `svc.search(long, String, Integer, Long)` 시그니처가 없어 컴파일 에러.

- [ ] **Step 3: Service 구현 — spaceId 파라미터 추가**

`DriveContentSearchService.java`를 아래 내용으로 교체한다:

```java
package com.workplace.drive.service;

import com.workplace.drive.dto.DriveContentHit;
import com.workplace.drive.dto.DriveContentSearchResponse;
import com.workplace.drive.outbound.WorkerEmbedClient;
import com.workplace.drive.repository.DriveContentSearchRepository;
import com.workplace.global.util.UnicodeNames;
import java.util.List;
import java.util.Optional;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 콘텐츠 검색. 쿼리를 임베딩(실패 시 키워드 전용)하고 하이브리드 RRF 로 접근 가능 파일을 랭킹한다. spaceId 지정 시 해당 공간으로 제한. */
@Service
public class DriveContentSearchService {

  /** 최소 검색어 길이. */
  private static final int MIN_QUERY = 2;

  /** 기본 결과 수. */
  private static final int DEFAULT_LIMIT = 10;

  private static final int MAX_LIMIT = 50;

  private final DriveContentSearchRepository repo;
  private final WorkerEmbedClient embedClient;

  public DriveContentSearchService(
      DriveContentSearchRepository repo, WorkerEmbedClient embedClient) {
    this.repo = repo;
    this.embedClient = embedClient;
  }

  /**
   * 콘텐츠 하이브리드 검색. 쿼리 벡터 획득 실패 시 키워드 전용으로 우아하게 강등.
   *
   * @param userId 호출자 id (RLS + 멤버십 필터에 사용)
   * @param q 검색어 (null 또는 2자 미만이면 빈 결과 반환)
   * @param limit 최대 결과 수 (null 이면 기본값 10, 상한 50)
   * @param spaceId null 이면 테넌트 전역, 값이 있으면 해당 공간으로 결과 제한
   */
  @Transactional(readOnly = true)
  public DriveContentSearchResponse search(long userId, String q, Integer limit, Long spaceId) {
    // 검색어 NFC 정규화 — 본문 tsvector(추출 텍스트=NFC)와 일관되게 매칭(UnicodeNames 참조).
    String norm = q == null ? "" : UnicodeNames.toNfc(q).trim();
    if (norm.length() < MIN_QUERY) {
      return new DriveContentSearchResponse(List.of(), false);
    }
    int lim = limit == null ? DEFAULT_LIMIT : Math.min(Math.max(limit, 1), MAX_LIMIT);
    // 임베딩 실패 시 empty → 키워드 전용으로 강등(워커 장애가 검색을 죽이지 않는다)
    Optional<float[]> vec = embedClient.embedQuery(norm);
    List<DriveContentHit> hits =
        repo.hybridSearch(userId, norm, vec.orElse(null), lim, spaceId).stream()
            .map(
                r ->
                    new DriveContentHit(
                        r.driveFileId(),
                        r.fileId(),
                        r.spaceId(),
                        r.spaceName(),
                        r.fileName(),
                        r.mimeType(),
                        r.snippet(),
                        r.score()))
            .toList();
    return new DriveContentSearchResponse(hits, vec.isPresent());
  }
}
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

Run: `cd apps/workplace-api && ./gradlew test --tests "com.workplace.drive.service.DriveContentSearchServiceTest"`
Expected: PASS (7개 테스트 모두, 신규 `search_withSpaceId_passesThroughToRepo` 포함)

- [ ] **Step 5: Commit**

```bash
git add apps/workplace-api/src/main/java/com/workplace/drive/service/DriveContentSearchService.java \
        apps/workplace-api/src/test/java/com/workplace/drive/service/DriveContentSearchServiceTest.java
git commit -m "feat(drive): 콘텐츠 검색 서비스에 공간 스코프 spaceId 전달"
```

---

## Task 3: 백엔드 — DriveContentSearchController 에 spaceId 쿼리 파라미터 추가

**Files:**
- Modify: `apps/workplace-api/src/main/java/com/workplace/drive/controller/DriveContentSearchController.java`

**Interfaces:**
- Consumes: `DriveContentSearchService.search(long, String, Integer, Long)` (Task 2에서 생성)
- Produces: `GET /api/v1/drive/search?q=...&limit=...&spaceId=...` — 프론트 Task 5(`searchDriveContent`)가 이 파라미터로 호출.

이 컨트롤러에는 기존 단위/통합 테스트가 없다(확인됨). 컴파일 대상 변경이므로 별도 실패 테스트 없이 바로 구현하고, 전체 빌드로 컴파일 검증한다.

- [ ] **Step 1: 컨트롤러에 spaceId 파라미터 추가**

`DriveContentSearchController.java`를 아래 내용으로 교체한다:

```java
package com.workplace.drive.controller;

import com.workplace.drive.dto.DriveContentSearchResponse;
import com.workplace.drive.service.DriveContentSearchService;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Drive 콘텐츠 검색. spaceId 미지정 시 테넌트 전역, 지정 시 해당 공간으로 제한(기존 space-scoped 파일명 검색 /spaces/{id}/search 와 별개 API). */
@RestController
@RequestMapping("/api/v1/drive")
public class DriveContentSearchController {

  private final DriveContentSearchService svc;

  public DriveContentSearchController(DriveContentSearchService svc) {
    this.svc = svc;
  }

  /** 콘텐츠 하이브리드 검색. RLS+멤버십으로 접근 가능 파일만 반환. spaceId 지정 시 해당 공간으로 결과 제한. */
  @GetMapping("/search")
  public ResponseEntity<DriveContentSearchResponse> search(
      @AuthenticationPrincipal Long callerId,
      @RequestParam String q,
      @RequestParam(required = false) Integer limit,
      @RequestParam(required = false) Long spaceId) {
    return ResponseEntity.ok(svc.search(callerId, q, limit, spaceId));
  }
}
```

- [ ] **Step 2: 전체 백엔드 빌드로 컴파일/회귀 검증**

Run: `cd apps/workplace-api && ./gradlew build`
Expected: BUILD SUCCESSFUL (기존 drive 패키지 전체 테스트 포함 통과)

- [ ] **Step 3: Commit**

```bash
git add apps/workplace-api/src/main/java/com/workplace/drive/controller/DriveContentSearchController.java
git commit -m "feat(drive): 콘텐츠 검색 API에 spaceId 쿼리 파라미터 추가"
```

---

## Task 4: 프론트 — PageHeader title optional화 + 디자인 시스템 문서 갱신

**Files:**
- Modify: `apps/workplace-web/src/components/layout/PageHeader.tsx`
- Modify: `docs/design-system/04-components.md:75`

**Interfaces:**
- Consumes: 없음
- Produces: `PageHeader({ title?: ReactNode, icon?, meta?, actions?, className?, contained?, 'data-testid'? })` — `title`이 `undefined`면 제목 `<h1>`을 렌더링하지 않는다. Task 6(`DrivePage`)이 `title` 없이 호출.

이 컴포넌트에는 전용 단위 테스트가 없다(다른 페이지들의 기존 E2E로 간접 검증됨). 변경 후 `pnpm typecheck`로 optional 변경이 다른 페이지 호출부를 깨지 않는지 확인한다.

- [ ] **Step 1: PageHeader — title optional화**

`PageHeader.tsx` 전체를 아래 내용으로 교체한다:

```tsx
import type { ReactNode } from 'react'

import { appTitleTextClass } from '@/components/layout/sidebar-link'
import { cn } from '@/lib/utils'

interface PageHeaderProps {
  /** 좌측 제목 — 사이드바 타이틀과 동일한 무게(appTitleTextClass). 생략 시 제목 영역 미렌더(다른 위치 표시자로 대체 가능 — 예: 드라이브의 브레드크럼). */
  title?: ReactNode
  /** 선택: 제목 앞 아이콘/컨트롤(사이드바 타이틀 아이콘과 대칭). */
  icon?: ReactNode
  /** 선택: 제목 옆 보조 메타(키·멤버수·뱃지 등). */
  meta?: ReactNode
  /** 선택: 우측 액션 슬롯(버튼·검색 등). */
  actions?: ReactNode
  className?: string
  /**
   * 본문이 `container mx-auto p-6` 로 센터링되는 페이지(이슈/프로젝트 상세)에서 true.
   * 헤더 테두리(border-b)는 전체폭을 유지하되, 내부 제목·액션을 본문과 동일한
   * `container mx-auto px-6` 축에 정렬시켜 헤더-본문 좌/우 정렬을 맞춘다.
   * 기본 false(전체폭 px-4) — 메일/드라이브처럼 p-4 전체폭 본문 페이지와의 정렬을 보존한다.
   */
  contained?: boolean
  /** 기존 테스트 호환용 testid override(기본 'page-header'). */
  'data-testid'?: string
}

/**
 * 컨텐츠 영역 표준 헤더 바 — h-14·border-b 고정 바로 사이드바 헤더(sidebarTitleClass)와
 * 한 선 정렬. 페이지가 필요할 때만 둔다(옵션). 홈 canvas-header 패턴을 컴포넌트화한 것.
 */
export function PageHeader({
  title,
  icon,
  meta,
  actions,
  className,
  contained = false,
  ...rest
}: PageHeaderProps) {
  return (
    <header
      data-testid={rest['data-testid'] ?? 'page-header'}
      className={cn('flex h-14 shrink-0 items-center border-b', className)}
    >
      {/* 내부 정렬 래퍼 — contained 면 본문과 동일한 컨테이너 축(px-6), 아니면 기존 전체폭 px-4. */}
      <div
        className={cn(
          'flex w-full min-w-0 items-center justify-between gap-2',
          contained ? 'container mx-auto px-6' : 'px-4',
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          {icon}
          {title != null && <h1 className={cn(appTitleTextClass, 'truncate')}>{title}</h1>}
          {meta}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </header>
  )
}
```

- [ ] **Step 2: 타입체크로 다른 호출부 무영향 확인**

Run: `cd apps/workplace-web && pnpm typecheck`
Expected: 에러 없음 (기존에 `title`을 전달하던 모든 페이지는 그대로 동작 — optional화는 상위 호환)

- [ ] **Step 3: 디자인 시스템 문서 갱신**

`docs/design-system/04-components.md:75`의 다음 줄을:

```
> **PageHeader props**: `title`(필수, 좌측 제목 — `appTitleTextClass` 무게) · `icon`(선택, 제목 앞 아이콘) · `meta`(선택, 제목 옆 보조 메타) · `actions`(선택, 우측 액션 슬롯) · `className` · `data-testid`(기본 `'page-header'`). 컨테이너는 `flex h-14 shrink-0 items-center justify-between gap-2 border-b px-4` 로, 2차 사이드바 헤더(`sidebarTitleClass`)·홈 헤더와 한 선 정렬한다. 컨텐츠 헤더는 **옵션**이며, 두지 않는 문서/설정형 페이지는 인-플로우 제목 토큰 `pageTitleClass` 를 쓴다([05-page-patterns.md](./05-page-patterns.md) 참조).
```

아래로 교체한다:

```
> **PageHeader props**: `title`(선택, 좌측 제목 — `appTitleTextClass` 무게. 생략 시 제목 영역 미렌더 — 브레드크럼 등 다른 위치 표시자가 있는 페이지에 사용, 예: 드라이브) · `icon`(선택, 제목 앞 아이콘) · `meta`(선택, 제목 옆 보조 메타) · `actions`(선택, 우측 액션 슬롯) · `className` · `data-testid`(기본 `'page-header'`). 컨테이너는 `flex h-14 shrink-0 items-center justify-between gap-2 border-b px-4` 로, 2차 사이드바 헤더(`sidebarTitleClass`)·홈 헤더와 한 선 정렬한다. 컨텐츠 헤더는 **옵션**이며, 두지 않는 문서/설정형 페이지는 인-플로우 제목 토큰 `pageTitleClass` 를 쓴다([05-page-patterns.md](./05-page-patterns.md) 참조).
```

- [ ] **Step 4: Commit**

```bash
git add -f apps/workplace-web/src/components/layout/PageHeader.tsx docs/design-system/04-components.md
git commit -m "feat(web): PageHeader title을 optional prop으로 변경"
```

---

## Task 5: 프론트 — searchDriveContent API에 spaceId 파라미터 추가

**Files:**
- Modify: `apps/workplace-web/src/api/contentSearch.ts`

**Interfaces:**
- Consumes: `GET /api/v1/drive/search?q=...&spaceId=...&limit=...` (Task 3에서 생성)
- Produces: `searchDriveContent(q: string, spaceId: number, limit?: number): Promise<DriveContentSearchResponse>` — Task 6(`DrivePage`)이 이 시그니처로 호출. `DriveContentHit`/`DriveContentSearchResponse` 타입은 불변.

이 함수에는 전용 단위 테스트가 없다(E2E로 간접 검증). Task 6/8에서 최종 검증한다.

- [ ] **Step 1: API 함수에 spaceId 파라미터 추가**

`contentSearch.ts` 전체를 아래 내용으로 교체한다:

```ts
import { client } from './client'

/** 콘텐츠 검색 결과 1건 — 파일명·snippet·스페이스 정보. */
export interface DriveContentHit {
  driveFileId: number
  fileId: number
  spaceId: number
  spaceName: string
  name: string
  mimeType: string
  snippet: string
  score: number
}

/** GET /api/v1/drive/search 응답. semantic=true 면 벡터+키워드 하이브리드, false 면 키워드 전용. */
export interface DriveContentSearchResponse {
  hits: DriveContentHit[]
  semantic: boolean
}

/**
 * 콘텐츠 하이브리드 검색 — 키워드(tsvector) + 의미(pgvector) RRF 병합.
 * spaceId 로 결과를 해당 공간으로 제한한다(드라이브 헤더 통합 검색이 항상 현재 공간을 전달).
 */
export async function searchDriveContent(
  q: string,
  spaceId: number,
  limit?: number,
): Promise<DriveContentSearchResponse> {
  const res = await client.get('/drive/search', { params: { q, spaceId, limit } })
  return res.data as DriveContentSearchResponse
}
```

- [ ] **Step 2: Commit**

이 시점에서는 `DriveSearchBar.tsx`가 아직 옛 시그니처(`searchDriveContent(submitted)`)로 이 함수를 호출하므로 타입체크가 깨진 상태다 — Task 6에서 해당 파일을 삭제하며 즉시 해소되므로 여기서는 타입체크를 실행하지 않고 커밋만 한다.

```bash
git add -f apps/workplace-web/src/api/contentSearch.ts
git commit -m "feat(web): searchDriveContent API에 spaceId 파라미터 추가"
```

---

## Task 6: 프론트 — DrivePage 검색 통합 + 타이틀 제거 + DriveSearchBar 제거

**Files:**
- Modify: `apps/workplace-web/src/pages/drive/DrivePage.tsx`
- Delete: `apps/workplace-web/src/components/drive/DriveSearchBar.tsx`

**Interfaces:**
- Consumes: `PageHeader({ title?, ... })` (Task 4), `searchDriveContent(q, spaceId, limit?)` (Task 5), `DriveOverviewCard({ query })`(기존, 무변경), `driveApi.search(spaceId, q)`(기존, 무변경)
- Produces: `DrivePage({ spaceId? })` 렌더 결과 — data-testid `search-results`(파일명+콘텐츠 통합 결과 컨테이너), `drive-content-results`(콘텐츠 일치 그룹), `drive-content-hit`(콘텐츠 결과 행, 기존과 동일 testid 유지), `drive-overview-btn`(AI Overview 버튼, `!embedded`일 때만 렌더). Task 7~9(E2E)가 이 testid들을 사용.

- [ ] **Step 1: import 정리 — DriveSearchBar 제거, DriveOverviewCard·searchDriveContent·DriveContentHit 추가**

`DrivePage.tsx` 상단 import 블록에서:

```tsx
import { DriveSearchBar } from '../../components/drive/DriveSearchBar'
```

를 제거하고, 대신 아래 두 줄을 추가한다(기존 `import { driveApi } from '../../api/drive'` 아래 삽입):

```tsx
import { searchDriveContent, type DriveContentHit } from '../../api/contentSearch'
import { DriveOverviewCard } from '../../components/drive/DriveOverviewCard'
```

- [ ] **Step 2: 검색 상태에 콘텐츠 결과 추가**

`DrivePage.tsx`의 아래 블록(약 76~78행):

```tsx
  // 검색 상태 — query 길이 ≥2 면 results 로 목록을 대체.
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<DriveSearchResult | null>(null)
```

을 아래로 교체한다:

```tsx
  // 검색 상태 — query 길이 ≥2 면 results/contentResults 로 목록을 대체(파일명+콘텐츠 통합 검색).
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<DriveSearchResult | null>(null)
  const [contentResults, setContentResults] = useState<DriveContentHit[] | null>(null)
  // AI Overview 카드 노출 여부 — 풀페이지에서만 사용(embedded 는 버튼 자체를 렌더하지 않음).
  const [showOverview, setShowOverview] = useState(false)
```

- [ ] **Step 3: 검색 debounce 효과 — 파일명+콘텐츠 동시 호출로 확장**

아래 블록(약 172~183행):

```tsx
  // 검색 디바운스(300ms). 2자 미만이면 결과 해제(브라우즈 복귀).
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setResults(null)
      return
    }
    const t = setTimeout(() => {
      void driveApi.search(sid, q).then(({ data }) => setResults(data))
    }, 300)
    return () => clearTimeout(t)
  }, [query, sid])
```

을 아래로 교체한다:

```tsx
  // 검색 디바운스(300ms). 2자 미만이면 결과 해제(브라우즈 복귀).
  // 파일명 검색(driveApi.search)과 콘텐츠 검색(searchDriveContent)을 동시 호출 — 두 검색창을 하나로 통합.
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setResults(null)
      setContentResults(null)
      setShowOverview(false)
      return
    }
    const t = setTimeout(() => {
      void driveApi.search(sid, q).then(({ data }) => setResults(data))
      void searchDriveContent(q, sid).then((data) => setContentResults(data.hits))
    }, 300)
    return () => clearTimeout(t)
  }, [query, sid])
```

- [ ] **Step 4: 검색 상태 초기화 지점에 contentResults/showOverview 리셋 추가**

`openFolder` 함수(약 185~189행):

```tsx
  function openFolder(id: number) {
    setQuery('')
    setResults(null)
    folderNav.openFolder(id)
  }
```

을:

```tsx
  function openFolder(id: number) {
    setQuery('')
    setResults(null)
    setContentResults(null)
    setShowOverview(false)
    folderNav.openFolder(id)
  }
```

로, `openTrash` 함수(약 399~404행):

```tsx
  async function openTrash() {
    setQuery('')
    setResults(null)
    const { data } = await driveApi.listTrash(sid)
    setTrash(data.items)
  }
```

을:

```tsx
  async function openTrash() {
    setQuery('')
    setResults(null)
    setContentResults(null)
    setShowOverview(false)
    const { data } = await driveApi.listTrash(sid)
    setTrash(data.items)
  }
```

로 교체한다.

- [ ] **Step 5: PageHeader — title 제거, aria-label 갱신**

```tsx
      <PageHeader
        title="드라이브"
        actions={
          <>
            <SearchInput
              value={query}
              onChange={setQuery}
              placeholder="이 공간에서 검색..."
              aria-label="드라이브 검색"
            />
```

를:

```tsx
      <PageHeader
        actions={
          <>
            <SearchInput
              value={query}
              onChange={setQuery}
              placeholder="이 공간에서 검색..."
              aria-label="파일명 및 콘텐츠 검색"
            />
```

로 교체한다(`title` prop 자체를 삭제 — 브레드크럼이 유일한 위치 표시자가 된다).

- [ ] **Step 6: 본문의 독립 DriveSearchBar 블록 제거**

```tsx
        {/* 콘텐츠 시맨틱 검색 — 스페이스 범위 파일명 검색과 별도로 전체 콘텐츠 하이브리드 검색 제공. */}
        {!embedded && <div className="mb-4" data-testid="drive-content-search"><DriveSearchBar /></div>}
```

이 두 줄을 완전히 삭제한다(콘텐츠 검색은 이제 통합 검색 결과 영역에서 렌더됨 — Step 7).

- [ ] **Step 7: 검색 결과 렌더링 — 파일명 일치 / 내용 일치 두 그룹**

기존 검색 결과 블록(약 618~654행, `) : searching ? (` 부터 다음 `) : (` 직전까지):

```tsx
        ) : searching ? (
          <ul className="divide-y divide-border" data-testid="search-results">
            {results.folders.map((f) => (
              <li key={`s-folder-${f.id}`} className="flex items-center gap-2 py-2">
                {/* 폴더 아이콘 — lucide Folder SVG로 파일 아이콘(DriveThumbnail)과 일관성 유지 */}
                <Folder className="h-8 w-8 shrink-0 p-1 text-muted-foreground" aria-hidden />
                <button
                  type="button"
                  onClick={() => openFolder(f.id)}
                  className="flex-1 text-left text-sm hover:underline"
                >
                  {f.name}
                  {f.folderPath && (
                    <span className="ml-2 text-xs text-muted-foreground">{f.folderPath}</span>
                  )}
                </button>
              </li>
            ))}
            {results.files.map((f) => (
              <li key={`s-file-${f.id}`} className="flex items-center gap-2 py-2">
                <DriveThumbnail fileId={f.id} category={f.category} />
                <button
                  type="button"
                  onClick={() => setPreview(f)}
                  className="flex-1 truncate text-left text-sm hover:underline"
                >
                  {f.name}
                  {f.folderPath && (
                    <span className="ml-2 text-xs text-muted-foreground">{f.folderPath}</span>
                  )}
                </button>
              </li>
            ))}
            {results.folders.length === 0 && results.files.length === 0 && (
              <li className="py-8 text-center text-sm text-muted-foreground">검색 결과가 없습니다</li>
            )}
          </ul>
        ) : (
```

을 아래로 교체한다:

```tsx
        ) : searching ? (
          <div data-testid="search-results">
            {/* 파일명 일치 그룹 — 기존 space-scoped 파일명 검색 결과. */}
            {(results.folders.length > 0 || results.files.length > 0) && (
              <div className="mb-4">
                <p className="mb-1 text-xs font-semibold text-muted-foreground">
                  파일명 일치 ({results.folders.length + results.files.length})
                </p>
                <ul className="divide-y divide-border">
                  {results.folders.map((f) => (
                    <li key={`s-folder-${f.id}`} className="flex items-center gap-2 py-2">
                      {/* 폴더 아이콘 — lucide Folder SVG로 파일 아이콘(DriveThumbnail)과 일관성 유지 */}
                      <Folder className="h-8 w-8 shrink-0 p-1 text-muted-foreground" aria-hidden />
                      <button
                        type="button"
                        onClick={() => openFolder(f.id)}
                        className="flex-1 text-left text-sm hover:underline"
                      >
                        {f.name}
                        {f.folderPath && (
                          <span className="ml-2 text-xs text-muted-foreground">{f.folderPath}</span>
                        )}
                      </button>
                    </li>
                  ))}
                  {results.files.map((f) => (
                    <li key={`s-file-${f.id}`} className="flex items-center gap-2 py-2">
                      <DriveThumbnail fileId={f.id} category={f.category} />
                      <button
                        type="button"
                        onClick={() => setPreview(f)}
                        className="flex-1 truncate text-left text-sm hover:underline"
                      >
                        {f.name}
                        {f.folderPath && (
                          <span className="ml-2 text-xs text-muted-foreground">{f.folderPath}</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {/* 내용 일치 그룹 — 콘텐츠 하이브리드 검색(#527 인프라 재사용, 이번엔 현재 공간으로 스코프). */}
            {contentResults != null && contentResults.length > 0 && (
              <div className="mb-4" data-testid="drive-content-results">
                <p className="mb-1 text-xs font-semibold text-muted-foreground">
                  내용 일치 ({contentResults.length})
                </p>
                <ul className="space-y-2">
                  {contentResults.map((h) => (
                    <li key={h.driveFileId} className="rounded border p-2" data-testid="drive-content-hit">
                      <div className="flex items-center gap-2">
                        <a
                          className="font-medium hover:underline"
                          href={`/drive/spaces/${h.spaceId}?file=${h.driveFileId}`}
                        >
                          {h.name}
                        </a>
                        {/* 스페이스 뱃지 — 어느 스페이스의 파일인지 표시. */}
                        <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                          {h.spaceName}
                        </span>
                      </div>
                      {/* snippet 은 ts_headline 이 <b> 만 넣는 신뢰 출력이지만 안전을 위해 태그 제거 후 텍스트 렌더. */}
                      <p className="text-sm text-muted-foreground">{h.snippet.replace(/<\/?b>/g, '')}</p>
                    </li>
                  ))}
                </ul>
                {/* AI Overview — 풀페이지에서만(embedded 는 공간이 좁아 숨김). */}
                {!embedded && (
                  <div className="mt-2">
                    {!showOverview ? (
                      <button
                        type="button"
                        className="rounded bg-ai-accent-subtle px-2 py-1 text-sm text-ai-accent hover:opacity-90"
                        onClick={() => setShowOverview(true)}
                        data-testid="drive-overview-btn"
                      >
                        ✦ AI Overview
                      </button>
                    ) : (
                      <DriveOverviewCard query={query.trim()} />
                    )}
                  </div>
                )}
              </div>
            )}
            {results.folders.length === 0 &&
              results.files.length === 0 &&
              (contentResults == null || contentResults.length === 0) && (
                <p className="py-8 text-center text-sm text-muted-foreground">검색 결과가 없습니다</p>
              )}
          </div>
        ) : (
```

- [ ] **Step 8: 삭제 — DriveSearchBar.tsx**

```bash
git rm apps/workplace-web/src/components/drive/DriveSearchBar.tsx
```

- [ ] **Step 9: 타입체크**

Run: `cd apps/workplace-web && pnpm typecheck`
Expected: 에러 없음

- [ ] **Step 10: Lint**

Run: `cd apps/workplace-web && pnpm lint`
Expected: 에러 없음(`DriveSearchBar` 관련 미사용 import 등)

- [ ] **Step 11: Commit**

```bash
git add -f apps/workplace-web/src/pages/drive/DrivePage.tsx
git add apps/workplace-web/src/components/drive/DriveSearchBar.tsx
git commit -m "feat(drive): 헤더 타이틀 제거 + 파일명/콘텐츠 검색 통합"
```

---

## Task 7: E2E — 기존 drive.spec.ts 수정 (타이틀 미노출 + 검색 aria-label + 통합 검색 모킹)

**Files:**
- Modify: `apps/workplace-web/e2e/pages/drive.spec.ts`

**Interfaces:**
- Consumes: Task 6에서 만든 `search-results`/`drive-content-results`/`drive-content-hit` testid, `파일명 및 콘텐츠 검색` aria-label
- Produces: 없음(리프 테스트)

- [ ] **Step 1: '드라이브 헤더와 폴더명 breadcrumb' 테스트 — 타이틀 미노출 단언으로 교체**

`drive.spec.ts:387`의:

```tsx
  await expect(page.getByTestId('page-header')).toContainText('드라이브')
  await expect(page.getByTestId('drive-root')).toBeVisible()
```

를 아래로 교체한다(페이지 타이틀이 사라지고 브레드크럼만 남는 것을 명시적으로 검증):

```tsx
  // 페이지 타이틀 제거 확인 — page-header 에는 검색/버튼만 있고 "드라이브" 텍스트가 없다.
  await expect(page.getByTestId('page-header')).not.toContainText('드라이브')
  // 브레드크럼이 유일한 위치 표시자 — 루트 버튼에 "드라이브" 노출.
  await expect(page.getByTestId('drive-root')).toBeVisible()
  await expect(page.getByTestId('drive-root')).toHaveText('드라이브')
```

- [ ] **Step 2: 검색 aria-label 변경 반영 + 통합 검색(콘텐츠) 모킹 추가**

`drive.spec.ts:189~258`의 `test('검색어 입력 시 결과를 경로와 함께 보여주고, 폴더 결과 클릭으로 이동한다', ...)` 안에서, `searchQuery` 캡처하는 파일명 검색 라우트(207~240행) 아래에 콘텐츠 검색 라우트 모킹을 추가한다. 아래는 해당 route 블록(240행) 바로 뒤, `await page.goto(...)` (242행) 이전에 삽입:

```tsx
  // 콘텐츠 검색 — 통합 검색이므로 항상 함께 호출됨. 이 테스트는 파일명 결과만 검증하므로 빈 결과로 모킹.
  await page.route(
    (url) => url.pathname === '/api/v1/drive/search',
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ hits: [], semantic: false }) }),
  )
```

그리고 같은 테스트의 246행:

```tsx
  await page.getByLabel('드라이브 검색').fill('report')
```

를:

```tsx
  await page.getByLabel('파일명 및 콘텐츠 검색').fill('report')
```

로 교체한다.

- [ ] **Step 3: 나머지 폴더/업로드/삭제 테스트들의 aria-label 참조 확인**

Run: `grep -n "드라이브 검색" apps/workplace-web/e2e/pages/drive.spec.ts`
Expected: 위에서 교체한 1곳 외에 남은 참조가 없어야 함(있다면 동일하게 `파일명 및 콘텐츠 검색`으로 교체).

- [ ] **Step 4: E2E 실행 — drive.spec.ts만**

Run: `cd apps/workplace-web && npx playwright test e2e/pages/drive.spec.ts`
Expected: PASS (전체)

- [ ] **Step 5: Commit**

```bash
git add apps/workplace-web/e2e/pages/drive.spec.ts
git commit -m "test(drive): 타이틀 제거 + 통합 검색 aria-label 반영"
```

---

## Task 8: E2E — drive-content-search.spec.ts 재작성 (통합 검색 + 그룹 표시 + AI Overview 풀페이지 전용)

**Files:**
- Modify: `apps/workplace-web/e2e/drive-content-search.spec.ts`

**Interfaces:**
- Consumes: Task 6의 `search-results`/`drive-content-results`/`drive-content-hit`/`drive-overview-btn` testid
- Produces: 없음(리프 테스트)

- [ ] **Step 1: 파일 전체를 아래 내용으로 교체**

```ts
import type { DriveContentSearchResponse } from '../src/api/contentSearch'
import type { DriveSpace } from '../src/types/drive'
import { expect, test } from './fixtures/auth.fixture'

/**
 * 드라이브 통합 검색 E2E — 헤더 검색 입력 1개로 파일명+콘텐츠 검색을 동시 실행하고,
 * 결과를 "파일명 일치"/"내용 일치" 두 그룹으로 보여준다. 백엔드 없이 API 모킹으로 동작.
 */
test('통합 검색 — 콘텐츠 일치 결과에 스니펫과 AI Overview 버튼을 보여준다', { tag: '@smoke' }, async ({
  authenticatedPage: page,
}) => {
  const SPACE_ID = 1
  const spaces: DriveSpace[] = [
    { id: SPACE_ID, name: '내 드라이브', type: 'PERSONAL', archived: false } as DriveSpace,
  ]
  await page.route('**/api/v1/drive/spaces', (route) => route.fulfill({ json: spaces }))
  await page.route(`**/api/v1/drive/spaces/${SPACE_ID}/items**`, (route) =>
    route.fulfill({ json: { folders: [], files: [] } }),
  )
  await page.route(`**/api/v1/drive/spaces/${SPACE_ID}`, (route) => route.fulfill({ json: spaces[0] }))
  await page.route('**/api/v1/drive/quota', (route) =>
    route.fulfill({ json: { usedBytes: 0, quotaBytes: 10737418240 } }),
  )

  // 파일명 검색 — 빈 결과(이 테스트는 콘텐츠 일치만 검증).
  await page.route(`**/api/v1/drive/spaces/${SPACE_ID}/search**`, (route) =>
    route.fulfill({ json: { folders: [], files: [] } }),
  )

  // 콘텐츠 검색 — spaceId 쿼리 파라미터가 함께 전달되는지 캡처.
  let capturedSpaceId = ''
  const searchResponse: DriveContentSearchResponse = {
    hits: [
      {
        driveFileId: 1,
        fileId: 10,
        spaceId: SPACE_ID,
        spaceName: '내 드라이브',
        name: '예산안',
        mimeType: 'application/pdf',
        snippet: '내년도 <b>예산</b> 편성',
        score: 0.5,
      },
    ],
    semantic: true,
  }
  await page.route('**/api/v1/drive/search?*', (route) => {
    capturedSpaceId = new URL(route.request().url()).searchParams.get('spaceId') ?? ''
    return route.fulfill({ json: searchResponse })
  })

  await page.goto('/drive')
  await page.waitForURL(/drive\/spaces\/\d+/)

  // 통합 검색 입력 1개 — 파일명 검색과 동일한 aria-label.
  const searchInput = page.getByLabel('파일명 및 콘텐츠 검색')
  await expect(searchInput).toBeVisible()
  await searchInput.fill('예산')

  // 콘텐츠 일치 그룹에 결과가 표시된다.
  await expect(page.getByTestId('drive-content-results')).toBeVisible()
  await expect(page.getByText('예산안')).toBeVisible()
  await expect(page.getByText('내년도 예산 편성')).toBeVisible() // snippet(b 태그 제거 후)
  await expect(page.getByText('내 드라이브', { exact: true })).toBeVisible() // 스페이스 뱃지

  // spaceId 가 현재 공간으로 전달됨 — 콘텐츠 검색도 공간 스코프로 통일.
  expect(capturedSpaceId).toBe(String(SPACE_ID))

  // 풀페이지이므로 AI Overview 버튼이 노출된다.
  await expect(page.getByTestId('drive-overview-btn')).toBeVisible()
})

test('검색어 2자 미만은 검색을 실행하지 않는다', async ({ authenticatedPage: page }) => {
  const SPACE_ID = 1
  const spaces: DriveSpace[] = [
    { id: SPACE_ID, name: '내 드라이브', type: 'PERSONAL', archived: false } as DriveSpace,
  ]
  await page.route('**/api/v1/drive/spaces', (route) => route.fulfill({ json: spaces }))
  await page.route(`**/api/v1/drive/spaces/${SPACE_ID}/items**`, (route) =>
    route.fulfill({ json: { folders: [], files: [] } }),
  )
  await page.route(`**/api/v1/drive/spaces/${SPACE_ID}`, (route) => route.fulfill({ json: spaces[0] }))
  await page.route('**/api/v1/drive/quota', (route) =>
    route.fulfill({ json: { usedBytes: 0, quotaBytes: 10737418240 } }),
  )

  let searchCalled = false
  await page.route('**/api/v1/drive/search?*', (route) => {
    searchCalled = true
    return route.fulfill({ json: { hits: [], semantic: false } })
  })

  await page.goto('/drive')
  await page.waitForURL(/drive\/spaces\/\d+/)

  await page.getByLabel('파일명 및 콘텐츠 검색').fill('a')
  await page.waitForTimeout(400) // debounce(300ms) 경과 대기

  expect(searchCalled).toBe(false)
  await expect(page.getByTestId('search-results')).toHaveCount(0)
})
```

- [ ] **Step 2: E2E 실행**

Run: `cd apps/workplace-web && npx playwright test e2e/drive-content-search.spec.ts`
Expected: PASS (2개 테스트)

- [ ] **Step 3: Commit**

```bash
git add apps/workplace-web/e2e/drive-content-search.spec.ts
git commit -m "test(drive): 통합 검색 그룹 표시 + AI Overview 풀페이지 전용 E2E 재작성"
```

---

## Task 9: E2E — embedded(채팅 드로워) 모드 통합 검색 + AI Overview 숨김 테스트 추가

**Files:**
- Modify: `apps/workplace-web/e2e/pages/channel-drive-space.spec.ts`

**Interfaces:**
- Consumes: Task 6의 `search-results`/`drive-content-hit`/`drive-overview-btn` testid, 기존 `stubChannelView` 헬퍼(파일 상단에 정의됨)
- Produces: 없음(리프 테스트)

- [ ] **Step 1: 새 테스트 추가**

`channel-drive-space.spec.ts` 파일의 마지막 `test(...)` 블록 뒤(파일 끝)에 아래 테스트를 추가한다. 상단의 `CHANNEL_ID`/`SPACE_ID` 상수와 `stubChannelView` 헬퍼를 그대로 재사용한다:

```ts
test('드로워(embedded) 에서도 통합 검색이 동작하지만 AI Overview는 숨긴다', async ({
  authenticatedPage: page,
}) => {
  await stubChannelView(page)
  await page.route(
    (url) => url.pathname === `/api/v1/messaging/channels/${CHANNEL_ID}/drive-space`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ spaceId: SPACE_ID, archived: false }),
      }),
  )
  await page.route(
    (url) => url.pathname === `/api/v1/drive/spaces/${SPACE_ID}`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: SPACE_ID,
          type: 'CHANNEL',
          name: '파일채널',
          ownerId: 1,
          role: 'EDITOR',
          archived: false,
          createdAt: '2026-06-01T00:00:00Z',
        }),
      }),
  )
  await page.route(
    (url) => url.pathname === `/api/v1/drive/spaces/${SPACE_ID}/items`,
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ folders: [], files: [] }) }),
  )
  // 파일명 검색 — 빈 결과.
  await page.route(
    (url) => url.pathname === `/api/v1/drive/spaces/${SPACE_ID}/search`,
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ folders: [], files: [] }) }),
  )
  // 콘텐츠 검색 — 결과 1건.
  await page.route(
    (url) => url.pathname === '/api/v1/drive/search',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          hits: [
            {
              driveFileId: 1,
              fileId: 10,
              spaceId: SPACE_ID,
              spaceName: '파일채널',
              name: '회의록.txt',
              mimeType: 'text/plain',
              snippet: '오늘 <b>회의</b> 내용',
              score: 0.5,
            },
          ],
          semantic: true,
        }),
      }),
  )

  await page.goto(`/chat/channels/${CHANNEL_ID}`)
  await page.getByTestId('channel-files-button').click()
  await expect(page.getByTestId('drive-space-drawer')).toBeVisible()

  const drawer = page.getByTestId('drive-space-drawer')
  await drawer.getByLabel('파일명 및 콘텐츠 검색').fill('회의')

  // 콘텐츠 일치 결과는 embedded 에서도 보인다.
  await expect(drawer.getByTestId('drive-content-hit')).toBeVisible()
  await expect(drawer.getByText('회의록.txt')).toBeVisible()

  // AI Overview 버튼은 embedded 에서 숨겨진다(공간 협소).
  await expect(drawer.getByTestId('drive-overview-btn')).toHaveCount(0)
})
```

- [ ] **Step 2: E2E 실행**

Run: `cd apps/workplace-web && npx playwright test e2e/pages/channel-drive-space.spec.ts`
Expected: PASS (기존 테스트 포함 전체)

- [ ] **Step 3: Commit**

```bash
git add apps/workplace-web/e2e/pages/channel-drive-space.spec.ts
git commit -m "test(drive): embedded 모드 통합 검색 + AI Overview 숨김 검증 추가"
```

---

## Task 10: 디자인 시스템 문서 — 드라이브 헤더 패턴 갱신 + 신규 검색 결과 그룹 패턴 기록

**Files:**
- Modify: `docs/design-system/05-page-patterns.md:350`

**Interfaces:**
- Consumes: 없음
- Produces: 문서 갱신만(코드 영향 없음)

- [ ] **Step 1: 드라이브 PageHeader 설명 갱신 + 신규 패턴 bullet 추가**

`05-page-patterns.md:350`의:

```
  - 드라이브: 전폭 `PageHeader`(title="드라이브", actions=검색·새 폴더·업로드·휴지통) 아래 **폴더명 breadcrumb 행**을 별도로 둔다(`GET /drive/folders/{id}/path`로 폴더 경로 조회, 깊으면 `…` 접기).
```

를 아래로 교체한다:

```
  - 드라이브: 전폭 `PageHeader`(**title 없음** — 사이드바 앱 이름 + 아래 브레드크럼이 위치 표시자 역할, actions=통합 검색·새 폴더·업로드·휴지통) 아래 **폴더명 breadcrumb 행**을 별도로 둔다(`GET /drive/folders/{id}/path`로 폴더 경로 조회, 깊으면 `…` 접기). 검색 입력 1개가 파일명 검색(space-scoped)과 콘텐츠 검색(하이브리드, 동일하게 현재 공간으로 스코프)을 동시 실행하고, 결과를 "파일명 일치"/"내용 일치" 두 그룹으로 나눠 보여준다(그룹 소제목은 `text-xs font-semibold text-muted-foreground`). AI Overview 진입 버튼(`bg-ai-accent-subtle text-ai-accent`)은 콘텐츠 일치가 있을 때만, 풀페이지에서만 노출(embedded 드로워는 공간 협소로 숨김).
```

- [ ] **Step 2: Commit**

```bash
git add -f docs/design-system/05-page-patterns.md
git commit -m "docs(design-system): 드라이브 헤더/검색 통합 패턴 문서화"
```

---

## Task 11: 전체 회귀 검증

**Files:** 없음(검증 전용 태스크)

**Interfaces:** 없음

- [ ] **Step 1: 백엔드 전체 테스트**

Run: `cd apps/workplace-api && ./gradlew build`
Expected: BUILD SUCCESSFUL

- [ ] **Step 2: 프론트 타입체크 + 린트**

Run: `cd apps/workplace-web && pnpm typecheck && pnpm lint`
Expected: 에러 없음

- [ ] **Step 3: 드라이브 관련 E2E 전체**

Run: `cd apps/workplace-web && npx playwright test e2e/pages/drive.spec.ts e2e/pages/channel-drive-space.spec.ts e2e/pages/drive-space-rename-delete.spec.ts e2e/pages/drive-cross-link.spec.ts e2e/pages/drive-share-link.spec.ts e2e/drive-content-search.spec.ts e2e/drive-preview-summary.spec.ts`
Expected: PASS (전체 — 타이틀 제거·검색 통합이 인접 드라이브 기능들을 깨지 않았는지 확인)

- [ ] **Step 4: 전체 E2E 스위트(선택 — pre-push 게이트가 어차피 수행하지만 로컬에서 미리 확인하고 싶다면)**

Run: `cd apps/workplace-web && pnpm test:e2e`
Expected: PASS (기존 회귀 없음)
