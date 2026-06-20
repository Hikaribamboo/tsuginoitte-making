import type {
  ProductionValidationStatus,
  ProductionValidationSummary,
} from '../lib/productionValidation';

export default function ProductionQualityBadge({ summary }: { summary: ProductionValidationSummary }) {
  return (
    <span className={`inline-flex h-6 items-center rounded-full px-2 text-[11px] font-semibold ${badgeClass(summary.status)}`}>
      {validationStatusLabel(summary.status)}
      {summary.status !== 'ok' ? (
        <span className="ml-1 font-normal opacity-75">
          E{summary.errorCount}/W{summary.warningCount}
        </span>
      ) : null}
    </span>
  );
}

function validationStatusLabel(status: ProductionValidationStatus): string {
  if (status === 'error') return 'エラー';
  if (status === 'warning') return '警告';
  return 'OK';
}

function badgeClass(status: ProductionValidationStatus): string {
  if (status === 'error') return 'bg-rose-100 text-rose-700';
  if (status === 'warning') return 'bg-amber-100 text-amber-700';
  return 'bg-emerald-100 text-emerald-700';
}
