package com.workplace.issue.service;

import com.workplace.issue.exception.IssueNotFoundException;
import com.workplace.issue.exception.NotAnEpicException;
import com.workplace.issue.outbound.IssueChangeNotifier;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.issue.repository.IssueTypeRepository;
import com.workplace.label.dto.ColorToken;
import com.workplace.project.service.ProjectAccessGuard;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 에픽 색 바꾸기(WP-1017). 새 에픽은 생성 때 자동 색을 받고(IssueService), 여기서는 사람이 12색 중 하나로 바꾼다 — 자동 배정과 달리 GRAY 도
 * 고를 수 있다. 유형·부모처럼 정리성 쓰기라 프로젝트 멤버만 바꾸고, 꾸밈 값이라 이력·알림은 남기지 않는다(라벨 색 변경과 같다). 다른 화면이 새 색으로 다시 그리도록
 * 변경 알림(updatedWithoutTouch)만 낸다.
 */
@Service
@Transactional
@RequiredArgsConstructor
public class IssueEpicColorService {

  private final IssueRepository issueRepository;
  private final IssueTypeRepository typeRepository;
  private final ProjectAccessGuard accessGuard;
  private final IssueChangeNotifier changeNotifier;

  /** 에픽 색을 colorToken 으로 바꾸고 저장한 토큰을 돌려준다. 에픽이 아니면 400, 허용되지 않은 토큰이면 400. */
  public String change(Long callerId, String projectKey, int number, String colorToken) {
    // 볼 수 없는 프로젝트는 404, 보기만 되는 비멤버는 403 — 유형 변경(setType)과 같은 가드.
    var project = accessGuard.assertMember(projectKey, callerId);
    String token = ColorToken.validate(colorToken);
    // 행을 잠가 같은 순간의 유형 변경과 엇갈리지 않게 한다(에픽이 아니게 된 이슈에 색을 쓰지 않도록).
    var issue =
        issueRepository
            .findByProjectAndNumberForUpdate(project.id(), number)
            .orElseThrow(() -> new IssueNotFoundException(projectKey, number));
    var type = typeRepository.findById(issue.typeId()).orElseThrow();
    if (!"EPIC".equals(type.name())) {
      throw new NotAnEpicException();
    }
    if (token.equals(issue.epicColor())) {
      return token;
    }
    issueRepository.updateEpicColor(issue.id(), token);
    // 꾸밈 값 변경 — AI 작업을 시작·터치하지 않는다(WP-425).
    changeNotifier.updatedWithoutTouch(project, number, issue.id(), callerId);
    return token;
  }
}
