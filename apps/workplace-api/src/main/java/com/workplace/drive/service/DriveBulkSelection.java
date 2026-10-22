package com.workplace.drive.service;

import com.workplace.drive.exception.DriveInvalidTargetException;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;

/**
 * 드라이브 일괄 작업(ZIP·이동·삭제)이 받는 선택 목록 정리(WP-795).
 *
 * <p>같은 id 를 반복해 보내면 그만큼 항목이 처리돼, 191바이트 요청 하나가 같은 5MB 파일을 40번 담은 210MB ZIP 을 만들고 이동은 같은 id 2만 개로
 * 16초가 걸렸다. 그래서 순서를 지킨 채 중복을 걷어 내고, 서로 다른 항목 수(파일+폴더)가 {@link #MAX_ITEMS} 를 넘으면 항목을 조회하기 전에 400 으로
 * 거절한다.
 */
public record DriveBulkSelection(List<Long> fileIds, List<Long> folderIds) {

  /** 한 요청에 고를 수 있는 파일·폴더 수(합계). 화면의 「전체 선택」은 불러온 목록만 고르므로 평소 선택은 이보다 훨씬 작다. */
  public static final int MAX_ITEMS = 1000;

  /**
   * null 목록은 빈 목록으로, 중복 id 는 처음 나온 자리만 남기고, 합계가 상한을 넘으면 {@link DriveInvalidTargetException}(400).
   */
  public static DriveBulkSelection of(List<Long> fileIds, List<Long> folderIds) {
    List<Long> files = distinct(fileIds);
    List<Long> folders = distinct(folderIds);
    if (files.size() + folders.size() > MAX_ITEMS) {
      throw new DriveInvalidTargetException("한 번에 고를 수 있는 파일·폴더는 1,000개까지입니다. 나눠서 다시 시도해 주세요.");
    }
    return new DriveBulkSelection(files, folders);
  }

  /** 순서를 지킨 중복 제거. null 원소는 그대로 남겨 기존 처리(조회 실패)를 바꾸지 않는다. */
  private static List<Long> distinct(List<Long> ids) {
    return ids == null ? List.of() : new ArrayList<>(new LinkedHashSet<>(ids));
  }
}
