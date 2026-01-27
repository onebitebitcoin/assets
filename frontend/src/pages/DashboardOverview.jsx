import { useState } from "react";
import SummaryCard from "../components/SummaryCard.jsx";
import AssetLineChart from "../components/AssetLineChart.jsx";
import AllocationDonut from "../components/AllocationDonut.jsx";
import AssetTable from "../components/AssetTable.jsx";
import AssetCardList from "../components/AssetCardList.jsx";
import { useDashboardContext } from "./DashboardLayout.jsx";

const SMALL_ASSET_THRESHOLD = 300000;

const parseDate = (value) => {
  if (!value) return null;
  const raw = typeof value === "string" ? value : value.toString();
  const hasTimezone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(raw);
  const date = new Date(hasTimezone ? raw : `${raw}+09:00`);
  return Number.isNaN(date.getTime()) ? null : date;
};

const DashboardOverview = () => {
  const { assets, totals, isMobile } = useDashboardContext();
  const { summary, summaryLoading, loadSummary } = assets;
  const {
    period,
    periodTotals,
    tableColumns,
    periodHasMore,
    periodLoading,
    snapshotLoading,
    changePeriod,
    onSnapshot,
    loadMore
  } = totals;

  const [searchQuery, setSearchQuery] = useState("");
  const [showSmallAssets, setShowSmallAssets] = useState(false);

  // 전체 자산
  const assetMetaById = new Map(summary.assets.map((asset) => [asset.id, asset]));

  const sortedTableColumns = [...tableColumns].sort((a, b) => {
    const aMeta = assetMetaById.get(a.id);
    const bMeta = assetMetaById.get(b.id);
    const aValue = (aMeta?.last_price_krw || 0) * (aMeta?.quantity || 0);
    const bValue = (bMeta?.last_price_krw || 0) * (bMeta?.quantity || 0);
    if (bValue !== aValue) return bValue - aValue;
    return a.name.localeCompare(b.name, "ko-KR");
  });

  const filteredTableColumns = sortedTableColumns.filter((asset) => {
    const meta = assetMetaById.get(asset.id);
    const assetValue = (meta?.last_price_krw || 0) * (meta?.quantity || 0);
    if (!showSmallAssets && assetValue < SMALL_ASSET_THRESHOLD) return false;
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    const name = asset.name?.toLowerCase() || "";
    const symbol = asset.symbol?.toLowerCase() || "";
    return name.includes(query) || symbol.includes(query);
  });

  const smallAssetCount = sortedTableColumns.filter((asset) => {
    const meta = assetMetaById.get(asset.id);
    const assetValue = (meta?.last_price_krw || 0) * (meta?.quantity || 0);
    return assetValue < SMALL_ASSET_THRESHOLD;
  }).length;

  const assetTableProps = {
    periodTotals,
    filteredTableColumns,
    assetMetaById,
    addingNew: assets.addingNew,
    newAssetForm: assets.newAssetForm,
    setNewAssetForm: assets.setNewAssetForm,
    handleSymbolChange: assets.handleSymbolChange,
    handleAddAsset: assets.handleAddAsset,
    resetNewAssetForm: assets.resetNewAssetForm,
    saving: assets.saving,
    editingAssetId: assets.editingAssetId,
    editForm: assets.editForm,
    setEditForm: assets.setEditForm,
    startEdit: assets.startEdit,
    cancelEdit: assets.cancelEdit,
    saveEdit: assets.saveEdit,
    handleDelete: assets.handleDelete,
    searchQuery,
    setSearchQuery,
    showSmallAssets,
    setShowSmallAssets,
    smallAssetCount,
    setAddingNew: assets.setAddingNew,
    isMobile,
    categoryLabel: "총 자산",
    categoryAssetIds: null,
    summaryMode: true
  };

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
            assetMetaById={assetMetaById}
          />
          <AllocationDonut assets={summary.assets} />
        </div>
      </section>

      <AssetTable {...assetTableProps} />
      <AssetCardList {...assetTableProps} />
    </>
  );
};

export default DashboardOverview;
