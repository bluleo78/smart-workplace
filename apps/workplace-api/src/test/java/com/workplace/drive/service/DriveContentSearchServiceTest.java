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
    when(repo.hybridSearch(anyLong(), anyString(), isNull(), eq(10), eq(42L)))
        .thenReturn(List.of());

    svc.search(1L, "쿼리", null, 42L);

    verify(repo).hybridSearch(anyLong(), anyString(), isNull(), eq(10), eq(42L));
  }
}
