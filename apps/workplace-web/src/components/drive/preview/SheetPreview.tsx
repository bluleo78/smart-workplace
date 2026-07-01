import { useEffect, useState } from 'react'

/** 과대 표 보호를 위한 시트당 최대 행. */
const MAX_ROWS = 500

/**
 * XLSX(SheetJS)를 lazy import 로 로드해 시트별 표로 렌더한다.
 * 셀은 React 텍스트 노드로만 출력(원시 HTML 주입 경로 없음). 시트가 여럿이면 탭으로 전환.
 */
export function SheetPreview({ buffer }: { buffer: ArrayBuffer }) {
  const [sheets, setSheets] = useState<{ name: string; rows: string[][] }[] | null>(null)
  const [active, setActive] = useState(0)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        // 무거운 파서는 XLSX 를 열 때만 동적 로드(코드 분할).
        const XLSX = await import('xlsx')
        const wb = XLSX.read(new Uint8Array(buffer), { type: 'array' })
        const parsed = wb.SheetNames.map((name) => {
          // raw:false → 셀의 서식 문자열(.w) 사용. 날짜·통화·백분율이 OA serial/원시값이 아닌
          // Excel 이 표시하는 그대로 렌더된다.
          const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], {
            header: 1,
            blankrows: false,
            raw: false,
          })
          const rows = aoa
            .slice(0, MAX_ROWS)
            .map((r) => r.map((c) => (c == null ? '' : String(c))))
          return { name, rows }
        })
        if (alive) setSheets(parsed)
      } catch {
        if (alive) setFailed(true)
      }
    })()
    return () => {
      alive = false
    }
  }, [buffer])

  if (failed) return <p className="text-sm text-destructive">스프레드시트를 읽지 못했습니다.</p>
  if (!sheets) return <p className="text-sm text-muted-foreground">불러오는 중…</p>
  const sheet = sheets[active]
  return (
    <div data-testid="xlsx-table">
      {sheets.length > 1 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {sheets.map((s, i) => (
            <button
              key={s.name}
              type="button"
              onClick={() => setActive(i)}
              className={
                i === active
                  ? 'rounded bg-primary px-2 py-0.5 text-xs text-primary-foreground'
                  : 'rounded bg-muted px-2 py-0.5 text-xs'
              }
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <tbody>
            {sheet.rows.map((row, r) => (
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
      </div>
    </div>
  )
}
