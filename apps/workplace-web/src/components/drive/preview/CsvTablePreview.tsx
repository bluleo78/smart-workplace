import Papa from 'papaparse'

/**
 * CSV 텍스트를 표로 렌더한다. 셀은 React 텍스트 노드로만 출력(원시 HTML 주입 경로 없음).
 * 첫 행을 헤더로 본다. 과대 표 보호를 위해 행 수를 상한으로 자른다.
 */
const MAX_ROWS = 500

export function CsvTablePreview({ csv }: { csv: string }) {
  const parsed = Papa.parse<string[]>(csv.trim(), { skipEmptyLines: true })
  const rows = parsed.data.slice(0, MAX_ROWS)
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">표시할 데이터가 없습니다.</p>
  }
  const [header, ...body] = rows
  return (
    // 가로 스크롤 영역은 포커스를 받을 수 있게 둔다(tabIndex) — 클릭·Tab 으로 들어오면 뷰어가 ←/→ 를 넘김 대신 표 스크롤에 양보한다(data-hscroll).
    <div
      className="overflow-x-auto rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-hscroll
      tabIndex={0}
      role="region"
      aria-label="표 가로 스크롤"
      data-testid="csv-table"
    >
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr>
            {header.map((cell, i) => (
              <th key={i} className="border border-border bg-muted px-2 py-1 text-left font-medium">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => (
                <td key={c} className="border border-border px-2 py-1">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {parsed.data.length > MAX_ROWS && (
        <p className="mt-2 text-xs text-muted-foreground">
          {parsed.data.length}행 중 {MAX_ROWS}행만 표시합니다. 전체는 다운로드하세요.
        </p>
      )}
    </div>
  )
}
