package com.workplace.issue.service;

import com.workplace.issue.dto.IssueRef;
import com.workplace.issue.repository.IssueRepository;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 이슈 모듈의 공개 읽기 전용 조회 서비스 — 다른 도메인 모듈(wiki 등)이 직접 repository 를 import 하지 않고 이슈를 조회하기 위한 경계 진입점. 모듈 간
 * 직접 import 금지(workplace-api 컨벤션)에 따라 wiki 는 이 서비스를 호출한다.
 */
@Service
@Transactional(readOnly = true)
@RequiredArgsConstructor
public class IssueLookupService {

  private final IssueRepository issueRepository;

  /** 전역 issue.id 목록 중 호출자가 멤버인 프로젝트의 활성 이슈만 경량 참조로 반환. 비가시/삭제/미존재 id 는 자연 배제. 빈 ids 면 빈 리스트. */
  public List<IssueRef> findVisibleByIds(long callerId, List<Long> issueIds) {
    return issueRepository.findVisibleRefsByIds(callerId, issueIds);
  }
}
