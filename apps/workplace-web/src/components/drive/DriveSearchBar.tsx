import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { searchDriveContent } from '@/api/contentSearch'

import { DriveOverviewCard } from './DriveOverviewCard'

/**
 * Drive 콘텐츠 검색 바 + 결과 리스트 + AI Overview 진입.
 * snippet 은 ts_headline HTML(b 태그만) — XSS 방지를 위해 text-only 렌더.
 */
export function DriveSearchBar() {
  const [q, setQ] = useState('')
  const [submitted, setSubmitted] = useState('')
  const [showOverview, setShowOverview] = useState(false)

  const { data } = useQuery({
    queryKey: ['drive-content-search', submitted],
    queryFn: () => searchDriveContent(submitted),
    enabled: submitted.length >= 2,
  })

  return (
    <div className="space-y-3">
      <input
        className="w-full rounded border px-3 py-2 text-sm"
        placeholder="콘텐츠 검색"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            setSubmitted(q)
            setShowOverview(false)
          }
        }}
        data-testid="drive-content-search-input"
      />
      {/* AI Overview 버튼 — 검색어가 2자 이상일 때만 표시. */}
      {submitted.length >= 2 && (
        <button
          type="button"
          className="text-sm text-primary hover:underline"
          onClick={() => setShowOverview(true)}
          data-testid="drive-overview-btn"
        >
          AI Overview
        </button>
      )}
      {showOverview && submitted.length >= 2 && <DriveOverviewCard query={submitted} />}
      <ul className="space-y-2">
        {data?.hits.map((h) => (
          <li key={h.driveFileId} className="rounded border p-2" data-testid="drive-content-hit">
            <div className="flex items-center gap-2">
              <a
                className="font-medium hover:underline"
                href={`/drive/spaces/${h.spaceId}?file=${h.driveFileId}`}
              >
                {h.name}
              </a>
              {/* 스페이스 뱃지 — 어느 스페이스의 파일인지 표시. */}
              <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                {h.spaceName}
              </span>
            </div>
            {/* snippet 은 ts_headline 이 <b> 만 넣는 신뢰 출력이지만 안전을 위해 태그 제거 후 텍스트 렌더. */}
            <p className="text-sm text-muted-foreground">{h.snippet.replace(/<\/?b>/g, '')}</p>
          </li>
        ))}
      </ul>
    </div>
  )
}
