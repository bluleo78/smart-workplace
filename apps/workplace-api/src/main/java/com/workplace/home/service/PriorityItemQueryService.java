package com.workplace.home.service;

import com.workplace.home.dto.PriorityItemResponse;
import com.workplace.home.dto.PriorityItemRow;
import com.workplace.home.repository.PriorityItemRepository;
import java.util.Comparator;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 저장된 우선순위 항목 조회 — importanceScore+urgencyScore 내림차순(SynthesisLayer 정렬과 동일 기준). */
@Service
public class PriorityItemQueryService {

  private final PriorityItemRepository repo;

  public PriorityItemQueryService(PriorityItemRepository repo) {
    this.repo = repo;
  }

  @Transactional(readOnly = true)
  public List<PriorityItemResponse> listForUser(long userId) {
    return repo.findForUser(userId).stream()
        .sorted(
            Comparator.comparingInt((PriorityItemRow r) -> r.importanceScore() + r.urgencyScore())
                .reversed())
        .map(PriorityItemResponse::from)
        .toList();
  }
}
