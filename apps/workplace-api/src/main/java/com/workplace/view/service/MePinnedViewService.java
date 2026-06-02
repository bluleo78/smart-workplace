package com.workplace.view.service;

import com.workplace.view.dto.PinnedSavedViewResponse;
import com.workplace.view.repository.SavedViewRepository;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 사용자의 프로젝트 교차 고정뷰 조회(사이드바). */
@Service
@RequiredArgsConstructor
public class MePinnedViewService {

  private final SavedViewRepository repository;

  @Transactional(readOnly = true)
  public List<PinnedSavedViewResponse> list(Long callerId) {
    return repository.findPinnedByUser(callerId);
  }
}
