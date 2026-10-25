package com.workplace.mail.service.folder;

import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailProvider;
import com.workplace.mail.exception.MailSyncException;
import com.workplace.mail.outbound.GraphApiClient;
import com.workplace.mail.service.GraphTokenService;
import com.workplace.mail.service.graph.GraphMailFolder;
import com.workplace.mail.service.graph.GraphMailFolderPage;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

/**
 * Microsoft Graph 서버 메일함 목록 조회(WP-960).
 *
 * <p>흐름: (1) well-known 이름({@code archive}, {@code inbox}, {@code sentitems} …)을 폴더 id 로 해석 (2)
 * {@code /me/mailFolders?$top=100} 부터 {@code childFolders} 를 재귀로 내려가며(각 단계 nextLink 페이징) 보관·사용자 폴더만
 * 고른다. 시스템 폴더(보낸편지함·휴지통·동기화 문제 등)는 그 하위 전체를 숨기므로 내려가지도 않는다. 받은편지함은 저장하지 않지만 그 아래 사용자 폴더는 최상위 사용자
 * 폴더로 올린다. 숨김 폴더({@code isHidden})와 검색 폴더({@code mailSearchFolder})는 뺀다.
 *
 * <p>목록·하위 목록 중 하나라도 실패하면 전체를 실패로 던진다 — 일부만 받은 목록으로는 저장된 폴더를 지우면 안 된다.
 *
 * <p>well-known id 캐시: 이름 → id 는 메일함 수명 동안 바뀌지 않으므로 성공한 해석은 계정별로 기억한다. 없는 이름(예: clutter 가 없는 메일함)은
 * 매 갱신마다 404 를 다시 받지 않도록 {@link #MISS_TTL} 동안만 「없음」으로 기억한다. 404 가 아닌 해석 실패와 받은편지함 해석 실패는 목록 전체를 실패로
 * 본다 — 시스템 폴더·받은편지함을 모르면 그것을 사용자 폴더로 잘못 저장하게 된다.
 */
@Slf4j
@Component
public class GraphFolderLister implements MailFolderLister {

  /** 최상위 폴더 목록 URL(상대경로 — GraphApiClient 가 v1.0 접두를 붙인다). */
  static final String ROOT_URL = "/me/mailFolders?$top=100";

  /** 해석할 well-known 이름. archive·inbox 외에는 모두 시스템 폴더(하위 포함 숨김). */
  static final List<String> WELL_KNOWN =
      List.of(
          "archive",
          "inbox",
          "sentitems",
          "drafts",
          "deleteditems",
          "junkemail",
          "outbox",
          "conversationhistory",
          "syncissues",
          "clutter",
          "conflicts",
          "localfailures",
          "serverfailures",
          "scheduled");

  /** 없는 well-known 이름을 다시 묻지 않는 기간. */
  static final Duration MISS_TTL = Duration.ofHours(6);

  /** 재귀 깊이 상한 — 비정상 응답(순환)으로 끝없이 내려가지 않게. */
  private static final int MAX_DEPTH = 32;

  private final GraphTokenService tokenService;
  private final GraphApiClient graphApiClient;

  /** 계정별 well-known 이름 해석 캐시. */
  private final Map<Long, WellKnownCache> wellKnownCache = new ConcurrentHashMap<>();

  /** 계정 하나의 well-known 해석 결과 — 찾은 것(name → id)과 없던 것(name → 확인 시각). */
  private record WellKnownCache(Map<String, String> found, Map<String, Instant> missing) {}

  public GraphFolderLister(GraphTokenService tokenService, GraphApiClient graphApiClient) {
    this.tokenService = tokenService;
    this.graphApiClient = graphApiClient;
  }

  @Override
  public MailProvider provider() {
    return MailProvider.M365_GRAPH;
  }

  /** well-known 이름 해석 URL — id 만 받는다. */
  static String wellKnownUrl(String name) {
    return "/me/mailFolders/" + name + "?$select=id";
  }

  /** 하위 폴더 목록 URL. */
  static String childFoldersUrl(String folderId) {
    return "/me/mailFolders/" + folderId + "/childFolders?$top=100";
  }

  @Override
  public ServerFolderListing list(long userId, long accountId, EmailAccountResponse account) {
    String token = tokenService.getAccessToken(userId, accountId);
    Map<String, String> nameById = resolveWellKnown(token, accountId);
    String inboxId =
        nameById.entrySet().stream()
            .filter(e -> e.getValue().equals("inbox"))
            .map(Map.Entry::getKey)
            .findFirst()
            .orElse(null);
    if (inboxId == null) {
      throw new MailSyncException("받은편지함 폴더를 확인하지 못했습니다");
    }
    List<ServerFolder> out = new ArrayList<>();
    walk(token, ROOT_URL, null, nameById, out, new HashSet<>(), 0);
    return new ServerFolderListing(out, inboxId);
  }

  /**
   * 한 단계 목록(nextLink 페이징 포함)을 받아 보관·사용자 폴더를 모으고 필요한 하위로 내려간다.
   *
   * @param parentKey 이 단계 폴더들의 보이는 부모 key(받은편지함·최상위면 null)
   */
  private void walk(
      String token,
      String url,
      String parentKey,
      Map<String, String> nameById,
      List<ServerFolder> out,
      Set<String> visited,
      int depth) {
    if (depth > MAX_DEPTH) {
      throw new MailSyncException("메일함 계층이 너무 깊습니다");
    }
    String next = url;
    while (next != null) {
      GraphMailFolderPage page = graphApiClient.get(token, next, GraphMailFolderPage.class);
      if (page == null || page.value() == null) {
        // 빈 응답을 「폴더 없음」으로 보면 저장된 폴더를 지우게 된다 — 실패로 본다.
        throw new MailSyncException("메일함 목록 응답이 비었습니다");
      }
      for (GraphMailFolder f : page.value()) {
        if (f.id() == null || f.isSearchFolder() || Boolean.TRUE.equals(f.isHidden())) {
          continue;
        }
        if (!visited.add(f.id())) {
          continue; // 순환 방지
        }
        String wellKnown = nameById.get(f.id());
        String childParent;
        if ("inbox".equals(wellKnown)) {
          // 받은편지함은 저장하지 않고, 그 아래 사용자 폴더는 내 메일함 최상위로 올린다.
          childParent = null;
        } else if (wellKnown != null && !"archive".equals(wellKnown)) {
          continue; // 시스템 폴더 — 하위 전체 숨김, 내려가지 않는다
        } else {
          FolderRole role = "archive".equals(wellKnown) ? FolderRole.ARCHIVE : FolderRole.USER;
          out.add(
              new ServerFolder(
                  f.id(),
                  f.id(),
                  f.displayName(),
                  parentKey,
                  role,
                  true,
                  f.unreadItemCount(),
                  f.totalItemCount()));
          childParent = f.id();
        }
        if (f.childFolderCount() != null && f.childFolderCount() > 0) {
          walk(token, childFoldersUrl(f.id()), childParent, nameById, out, visited, depth + 1);
        }
      }
      next = page.nextLink();
    }
  }

  /**
   * well-known 이름을 폴더 id 로 해석해 id → 이름 맵으로 돌려준다. 캐시에 있는 것은 다시 묻지 않는다. 받은편지함 외의 해석 실패(대부분 그 폴더가 없는
   * 404)는 무시하고 「없음」으로 잠시 기억한다.
   */
  private Map<String, String> resolveWellKnown(String token, long accountId) {
    WellKnownCache cache =
        wellKnownCache.computeIfAbsent(
            accountId,
            id -> new WellKnownCache(new ConcurrentHashMap<>(), new ConcurrentHashMap<>()));
    Instant now = Instant.now();
    for (String name : WELL_KNOWN) {
      if (cache.found().containsKey(name)) {
        continue;
      }
      Instant missedAt = cache.missing().get(name);
      if (missedAt != null && missedAt.plus(MISS_TTL).isAfter(now)) {
        continue;
      }
      try {
        GraphMailFolder f = graphApiClient.get(token, wellKnownUrl(name), GraphMailFolder.class);
        if (f != null && f.id() != null) {
          cache.found().put(name, f.id());
          cache.missing().remove(name);
        } else if ("inbox".equals(name)) {
          throw new MailSyncException("받은편지함 폴더를 확인하지 못했습니다");
        } else {
          cache.missing().put(name, now);
        }
      } catch (MailSyncException e) {
        // 확실히 없는 폴더(404)만 「없음」으로 기억한다. 그 밖의 실패(429·503·네트워크)는 목록 전체를 실패로 본다 — 시스템 폴더를
        // 몰라 사용자 폴더로 저장하면 안 된다. 받은편지함은 404 여도 목록을 믿을 수 없어 실패다. GraphApiClient 는 상태 코드를
        // "Graph API 호출 실패: {status}" 메시지로만 알려 준다.
        boolean notFound = e.getMessage() != null && e.getMessage().endsWith(": 404");
        if ("inbox".equals(name) || !notFound) {
          throw e;
        }
        cache.missing().put(name, now);
        log.debug("Graph well-known 폴더 없음(건너뜀): name={} {}", name, e.getMessage());
      }
    }
    Map<String, String> nameById = new HashMap<>();
    cache.found().forEach((name, id) -> nameById.put(id, name));
    return nameById;
  }
}
