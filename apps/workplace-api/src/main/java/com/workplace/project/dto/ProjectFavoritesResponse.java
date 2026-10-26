package com.workplace.project.dto;

import java.util.List;

/** 내 프로젝트 즐겨찾기(WP-1001) — 즐겨찾기한 순서의 프로젝트 key. 지금 볼 수 있는 프로젝트만 담는다. */
public record ProjectFavoritesResponse(List<String> projectKeys) {}
