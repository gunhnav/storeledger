import { useI18n } from '../lib/i18n'

// Danh sách "khác gì" của các dòng đã có trong DB mà file nhập có số liệu khác (hiện tối đa `limit` dòng)
export function ImportDiffs({ rows, limit = 15 }: { rows: { id: string; title: string; diffs: { label: string; before: string; after: string }[] }[]; limit?: number }) {
  const { t } = useI18n()
  return (
    <ul className="import-diffs">
      {rows.slice(0, limit).map((r) => (
        <li key={r.id}>
          <strong>{r.title}</strong>:{' '}
          {r.diffs.map((d) => `${t(d.label)} ${d.before} → ${d.after}`).join('; ')}
        </li>
      ))}
      {rows.length > limit && <li className="muted">{t('…và {count} dòng khác', { count: rows.length - limit })}</li>}
    </ul>
  )
}
