import { useState } from "react";
import AssetTable from "../components/AssetTable.jsx";
import AssetCardList from "../components/AssetCardList.jsx";
import { useDashboardContext } from "./DashboardLayout.jsx";

const SMALL_ASSET_THRESHOLD = 300000;

const CustomAssetsPage = () => {
  const { assets, totals, isMobile } = useDashboardContext();
  const [searchQuery, setSearchQuery] = useState("");
  const [showSmallAssets, setShowSmallAssets] = useState(false);

  const { periodTotals, tableColumns } = totals;

  // 커스텀 자산만 필터링 (stock, kr_stock, crypto, cash 제외)
  const standardTypes = ["stock", "kr_stock", "crypto", "cash"];
  const customAssets = assets.summary.assets.filter(
    (a) => !standardTypes.includes(a.asset_type?.toLowerCase())
  );
  const assetMetaById = new Map(customAssets.map((asset) => [asset.id, asset]));

  const customIds = new Set(customAssets.map((a) => a.id));
  const filteredTableColumns = tableColumns.filter((col) => customIds.has(col.id));

  const sortedTableColumns = [...filteredTableColumns].sort((a, b) => {
    const aMeta = assetMetaById.get(a.id);
    const bMeta = assetMetaById.get(b.id);
    const aValue = (aMeta?.last_price_krw || 0) * (aMeta?.quantity || 0);
    const bValue = (bMeta?.last_price_krw || 0) * (bMeta?.quantity || 0);
    if (bValue !== aValue) return bValue - aValue;
    return a.name.localeCompare(b.name, "ko-KR");
  });

  const finalFilteredColumns = sortedTableColumns.filter((asset) => {
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

  const commonProps = {
    periodTotals,
    filteredTableColumns: finalFilteredColumns,
    assetMetaById,
    addingNew: assets.addingNew,
    newAssetForm: { ...assets.newAssetForm, asset_type: "custom" },
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
    setAddingNew: (val) => {
      assets.setAddingNew(val);
      if (val) {
        assets.setNewAssetForm((prev) => ({ ...prev, asset_type: "custom" }));
      }
    },
    isMobile,
    categoryLabel: "기타 자산 합계",
    categoryAssetIds: customIds
  };

  return (
    <>
      <h2 className="page-title">기타 자산</h2>
      <AssetTable {...commonProps} />
      <AssetCardList {...commonProps} />
    </>
  );
};

export default CustomAssetsPage;
