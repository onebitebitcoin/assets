import SummaryCard from "../components/SummaryCard.jsx";
import AssetLineChart from "../components/AssetLineChart.jsx";
import AllocationDonut from "../components/AllocationDonut.jsx";
import { useDashboardContext } from "./DashboardLayout.jsx";

const parseDate = (value) => {
  if (!value) return null;
  const raw = typeof value === "string" ? value : value.toString();
  const hasTimezone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(raw);
  const date = new Date(hasTimezone ? raw : `${raw}+09:00`);
  return Number.isNaN(date.getTime()) ? null : date;
};

const DashboardOverview = () => {
  const { assets, totals } = useDashboardContext();
  const { summary, summaryLoading, loadSummary } = assets;
  const {
    period,
    periodTotals,
    periodHasMore,
    periodLoading,
    snapshotLoading,
    changePeriod,
    onSnapshot,
    loadMore
  } = totals;

  const assetLastUpdatedTimes = summary.assets
    .map((a) => a.last_updated)
    .filter(Boolean)
    .map((t) => parseDate(t)?.getTime())
    .filter((t) => t && !Number.isNaN(t));
  const latestAssetUpdate = assetLastUpdatedTimes.length
    ? new Date(Math.max(...assetLastUpdatedTimes))
    : null;
  const effectiveLastRefreshed = summary.last_refreshed || (latestAssetUpdate ? latestAssetUpdate.toISOString() : null);

  return (
    <>
      <SummaryCard
        summary={summary}
        summaryLoading={summaryLoading}
        effectiveLastRefreshed={effectiveLastRefreshed}
      />

      <section className="chart-card combined-charts">
        <div className="charts-grid">
          <AssetLineChart
            period={period}
            periodTotals={periodTotals}
            periodHasMore={periodHasMore}
            periodLoading={periodLoading}
            snapshotLoading={snapshotLoading}
            onPeriodChange={changePeriod}
            onSnapshot={() => onSnapshot(loadSummary)}
            onLoadMore={loadMore}
          />
          <AllocationDonut assets={summary.assets} />
        </div>
      </section>
    </>
  );
};

export default DashboardOverview;
