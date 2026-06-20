import type {
  ProductionValidationIssue,
  ProductionValidationSeverity,
} from '../lib/productionValidation';

export default function ProductionIssueList({ issues }: { issues: ProductionValidationIssue[] }) {
  return (
    <section className="rounded-xl border border-sky-200/80 bg-white/75 p-4 shadow-sm backdrop-blur-sm">
      <div className="mb-2 text-sm font-semibold text-slate-900">issue 一覧</div>
      {issues.length === 0 ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
          issue はありません。
        </div>
      ) : (
        <div className="space-y-2">
          {issues.map((issue, index) => (
            <div key={`${issue.rule_code}-${index}`} className={`rounded-lg border p-3 text-sm ${issueClass(issue.severity)}`}>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold uppercase">{issue.severity}</span>
                <span className="font-mono text-[11px] opacity-80">{issue.rule_code}</span>
              </div>
              <div className="mt-1 text-sm">{issue.message}</div>
              <div className="mt-1 text-xs opacity-80">{issue.field_path}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function issueClass(severity: ProductionValidationSeverity): string {
  if (severity === 'error') return 'border-rose-200 bg-rose-50 text-rose-800';
  if (severity === 'warning') return 'border-amber-200 bg-amber-50 text-amber-800';
  return 'border-sky-200 bg-sky-50 text-sky-800';
}
