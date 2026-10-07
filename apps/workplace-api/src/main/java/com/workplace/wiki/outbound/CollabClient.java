package com.workplace.wiki.outbound;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.workplace.wiki.exception.CollabRequestRejectedException;
import com.workplace.wiki.exception.CollabUnavailableException;
import com.workplace.wiki.exception.WikiPageNotFoundException;
import java.util.List;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

/**
 * API → 노트 동기화 서버(workplace-collab) 호출(WP-285). 인증은 {@code Authorization: Internal <token>} 공유 비밀.
 *
 * <p>테넌트는 헤더가 아니라 본문 {@code tenantId} 로 싣는다 — API 는 이미 테넌트 컨텍스트 안에서 호출하고, 동기화 서버는 그 값을 문서 컨텍스트에
 * 보관했다가 되돌려 호출(PUT /internal/wiki/pages/{id}/doc)할 때 {@code X-Tenant-Id} 로 쓴다(스펙 §4.1). 무재시도 — 호출자가
 * 판단한다. apply-markdown 실패 매핑: 404·410(페이지 없어짐) → {@link WikiPageNotFoundException}(404), 그 밖의
 * 4xx(우리 요청이 틀림) → {@link CollabRequestRejectedException}(500), 연결 실패·타임아웃·5xx 만 {@link
 * CollabUnavailableException}(503).
 */
@Slf4j
public class CollabClient {

  private final RestClient restClient;

  public CollabClient(RestClient.Builder builder, String internalToken) {
    this.restClient = builder.defaultHeader("Authorization", "Internal " + internalToken).build();
  }

  /**
   * 마크다운 본문을 실시간 문서에 적용하고 즉시 저장된 결과를 받는다(스펙 §5.1). 지금은 mode=replace 만 쓴다 — 3-way 병합(merge)은 WP-289.
   *
   * @param ai MCP·채팅 비서 등 AI 경로면 true(✦ 표시·스냅샷 ai_actor_id 용), 사람(구버전 웹)이면 false
   * @return 동기화 서버가 저장한 version 과 그 version 의 body
   */
  public CollabApplyResult applyMarkdown(
      long tenantId, long pageId, String body, long actorId, String actorName, boolean ai) {
    try {
      CollabApplyResult res =
          restClient
              .post()
              .uri("/internal/docs/{pageId}/apply-markdown", pageId)
              .contentType(MediaType.APPLICATION_JSON)
              .body(
                  new ApplyMarkdownRequest(
                      tenantId, "replace", body, new Actor(actorId, actorName), ai))
              .retrieve()
              .body(CollabApplyResult.class);
      if (res == null) {
        throw new CollabUnavailableException("동기화 서버 응답이 비어 있습니다: page=" + pageId, null);
      }
      return res;
    } catch (HttpClientErrorException e) {
      // 4xx 는 일시 장애가 아니다 — 503 으로 돌리면 호출자(MCP·구버전 웹)가 사라진 페이지에 재시도를 반복한다.
      if (e.getStatusCode().isSameCodeAs(HttpStatus.NOT_FOUND)
          || e.getStatusCode().isSameCodeAs(HttpStatus.GONE)) {
        throw new WikiPageNotFoundException(pageId);
      }
      log.error("collab apply-markdown 요청 거부: page={} {}", pageId, e.getMessage());
      throw new CollabRequestRejectedException("노트 동기화 서버가 본문 적용 요청을 거부했습니다: page=" + pageId, e);
    } catch (RestClientException e) {
      log.warn("collab apply-markdown 실패: page={} {}", pageId, e.getMessage());
      throw new CollabUnavailableException("노트 동기화 서버에 본문을 적용하지 못했습니다. 잠시 후 다시 시도해 주세요.", e);
    }
  }

  /** 권한 변화 후 열린 연결 재검증 요청(스펙 §4.1). 실패 시 {@link CollabUnavailableException}. */
  public void revalidate(RevalidateRequest req) {
    try {
      restClient
          .post()
          .uri("/internal/docs/revalidate")
          .contentType(MediaType.APPLICATION_JSON)
          .body(req)
          .retrieve()
          .toBodilessEntity();
    } catch (RestClientException e) {
      throw new CollabUnavailableException("노트 동기화 서버 재검증 요청 실패", e);
    }
  }

  /** apply-markdown 요청 본문. pageId 는 경로에 싣는다. */
  record ApplyMarkdownRequest(long tenantId, String mode, String body, Actor actor, boolean ai) {}

  /** 적용 주체 — 동기화 서버가 awareness 이름표·updated_by 에 쓴다. */
  record Actor(long userId, String name) {}

  /** apply-markdown 응답 — 즉시 저장 후의 wiki_page.version 과 그 본문. */
  public record CollabApplyResult(int version, String body) {}

  /**
   * revalidate 요청 본문. spaceId·pageIds·userId 는 선택 — null 이면 키를 생략한다. 의미: pageIds 가 있으면 그 페이지 연결,
   * 없으면 spaceId 의 모든 연결; userId 가 있으면 그 사용자 연결로 한정.
   */
  @JsonInclude(JsonInclude.Include.NON_NULL)
  public record RevalidateRequest(long tenantId, Long spaceId, List<Long> pageIds, Long userId) {}
}
