package com.workplace.project.service;

import com.workplace.project.dto.ProjectFavoritesResponse;
import com.workplace.project.dto.ProjectRow;
import com.workplace.project.exception.ProjectNotFoundException;
import com.workplace.project.repository.ProjectFavoriteRepository;
import com.workplace.project.repository.ProjectRepository;
import java.util.LinkedHashSet;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 프로젝트 즐겨찾기(WP-1001). 브라우저 저장소에만 두면 지워지거나 다른 창의 옛 값으로 덮어써지고 기기마다 달라서, 사용자·프로젝트별 행으로 서버에 둔다.
 *
 * <p>볼 수 있는 프로젝트만 즐겨찾기할 수 있고(볼 수 없으면 없는 프로젝트와 같은 404 — WP-588), 목록도 지금 볼 수 있는 것만 돌려준다. 멤버에서 빠져 못 보게
 * 된 프로젝트의 행은 남겨 두되 보이지 않는다(다시 멤버가 되면 되살아난다).
 */
@Service
@RequiredArgsConstructor
public class ProjectFavoriteService {

  private final ProjectFavoriteRepository favoriteRepository;
  private final ProjectRepository projectRepository;
  private final ProjectAccessGuard accessGuard;

  /** 내 즐겨찾기 — 즐겨찾기한 순서, 지금 볼 수 있는 프로젝트만. 프로젝트 행은 한 번에 읽는다. */
  @Transactional(readOnly = true)
  public ProjectFavoritesResponse list(Long userId) {
    List<String> keys =
        projectRepository.findActiveByIdsInOrder(favoriteRepository.findProjectIds(userId)).stream()
            .filter(p -> accessGuard.canRead(p, userId))
            .map(ProjectRow::key)
            .toList();
    return new ProjectFavoritesResponse(keys);
  }

  /**
   * 즐겨찾기 추가 — 멱등. 볼 수 없는 프로젝트는 404. 멤버라서 볼 수 있으면 그 멤버 행을 커밋까지 잠근다(WP-776 과 같은 방식) — 같은 순간의 멤버 제거와 둘
   * 다 성공해 볼 수 없는 프로젝트의 즐겨찾기 행이 남지 않게.
   */
  @Transactional
  public void add(Long userId, String projectKey) {
    ProjectRow project = accessGuard.resolve(projectKey);
    if (!accessGuard.lockReadable(project, userId)) {
      throw ProjectNotFoundException.hidden();
    }
    favoriteRepository.add(userId, project.id());
  }

  /** 즐겨찾기 해제 — 멱등. 없는(지워진) 프로젝트도 204 로 끝낸다 — 지울 것이 없을 뿐이다. */
  @Transactional
  public void remove(Long userId, String projectKey) {
    projectRepository
        .findByKey(projectKey)
        .ifPresent(p -> favoriteRepository.remove(userId, p.id()));
  }

  /**
   * 브라우저에만 있던 즐겨찾기를 올린다 — 볼 수 있는 key 만 더하고 없는·볼 수 없는 key 는 건너뛴다. 이미 있는 것은 그대로(멱등). 올린 뒤의 목록을 돌려준다.
   */
  @Transactional
  public ProjectFavoritesResponse importKeys(Long userId, List<String> projectKeys) {
    for (String key : new LinkedHashSet<>(projectKeys)) {
      if (key == null || key.isBlank()) continue;
      try {
        add(userId, key);
      } catch (ProjectNotFoundException ignored) {
        // 기기의 옛 값 — 그 사이 지워졌거나 볼 수 없게 된 프로젝트는 건너뛴다.
      }
    }
    return list(userId);
  }
}
