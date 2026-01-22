import { formatDelta, formatKRW, formatRelativeTime } from "../utils/format.js";

const SummaryCard = ({ summary, summaryLoading, effectiveLastRefreshed }) => {
  if (summaryLoading) {
    return (
      <section className="summary-card">
        <div className="loading-state">
          <span className="spinner large" />
          <p className="muted">잔액을 불러오는 중...</p>
        </div>
      </section>
    );
  }

  return (
    <section className="summary-card">
      <div className="summary-total">
        <p className="label">총 자산</p>
        <h2>{formatKRW(summary.total_krw)}</h2>
      </div>
      <div>
        <p className="label">오늘 변화량</p>
        <h3 className={summary.daily_change_krw >= 0 ? "delta up" : "delta down"}>
          {formatDelta(summary.daily_change_krw)}
        </h3>
      </div>
      {effectiveLastRefreshed ? (
        <p className="refresh-info muted">
          {formatRelativeTime(effectiveLastRefreshed)}에 업데이트됨
          {summary.next_refresh_at && ` · 다음 갱신: ${formatRelativeTime(summary.next_refresh_at)}`}
        </p>
      ) : (
        <p className="refresh-info muted">
          아직 가격이 갱신되지 않았습니다
        </p>
      )}
    </section>
  );
};

export default SummaryCard;
