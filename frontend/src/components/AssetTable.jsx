import { formatDateTime, formatKRW, formatUSD } from "../utils/format.js";

const formatAxisDate = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("ko-KR", { month: "2-digit", day: "2-digit" }).format(date);
};

const getDeltaClass = (current, previous) => {
  if (previous === null || previous === undefined) return "";
  if (current > previous) return "delta-up";
  if (current < previous) return "delta-down";
  return "";
};

const formatQuantity = (value) => {
  if (value === null || value === undefined) return "-";
  const rounded = Math.round(value * 100) / 100;
  return new Intl.NumberFormat("ko-KR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(rounded);
};

const AssetTable = ({
  periodTotals,
  filteredTableColumns,
  assetMetaById,
  addingNew,
  newAssetForm,
  setNewAssetForm,
  handleSymbolChange,
  handleAddAsset,
  resetNewAssetForm,
  saving,
  editingAssetId,
  editForm,
  setEditForm,
  startEdit,
  cancelEdit,
  saveEdit,
  handleDelete,
  searchQuery,
  setSearchQuery,
  showSmallAssets,
  setShowSmallAssets,
  smallAssetCount,
  setAddingNew
}) => {
  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h3>자산 변화</h3>
          <p className="subtext">
            자산 추가 및 수정이 반영되지 않았으면 스냅샷 버튼을 클릭하세요.
            {periodTotals.length > 0 && (
              <span className="last-snapshot-time"> (최근 스냅샷: {formatDateTime(periodTotals[0].snapshot_at || periodTotals[0].period_start)})</span>
            )}
          </p>
        </div>
        <div className="panel-header-actions">
          <input
            type="text"
            placeholder="자산 검색 (이름, 심볼)"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="asset-search-input"
          />
          <button
            type="button"
            className="primary small"
            onClick={() => setAddingNew(true)}
            disabled={addingNew}
          >
            <i className="fa-solid fa-plus" /> 자산 추가
          </button>
        </div>
      </div>
      {smallAssetCount > 0 && (
        <button
          type="button"
          className="ghost small toggle-small-assets"
          onClick={() => setShowSmallAssets((prev) => !prev)}
        >
          {showSmallAssets
            ? `30만원 미만 종목 숨기기 (${smallAssetCount}개)`
            : `30만원 미만 종목 보기 (${smallAssetCount}개)`}
        </button>
      )}
      {periodTotals.length ? (
        <div className="table-wrapper">
          <table className="asset-table">
            <thead>
              <tr>
                <th className="asset-name-col">종목</th>
                <th>수량</th>
                <th>현재가</th>
                <th>소스</th>
                <th>작업</th>
                {periodTotals.map((row, index) => (
                  <th key={`${row.period_start}-${index}`}>{formatAxisDate(row.period_start)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {addingNew && (
                <tr className="asset-add-row">
                  <td className="asset-name-col">
                    <input
                      type="text"
                      className="asset-edit-input"
                      placeholder="종목명"
                      value={newAssetForm.name}
                      onChange={(e) => setNewAssetForm((prev) => ({ ...prev, name: e.target.value }))}
                    />
                    <select
                      className="asset-edit-input"
                      style={{ marginTop: "0.3rem" }}
                      value={newAssetForm.asset_type}
                      onChange={(e) => setNewAssetForm((prev) => ({ ...prev, asset_type: e.target.value }))}
                    >
                      <option value="stock">미국 주식</option>
                      <option value="kr_stock">국내 주식</option>
                      <option value="crypto">비트코인</option>
                      <option value="cash">현금</option>
                      <option value="custom">직접 입력</option>
                    </select>
                    {newAssetForm.asset_type === "custom" && (
                      <input
                        type="text"
                        className="asset-edit-input"
                        style={{ marginTop: "0.3rem" }}
                        placeholder="유형 (예: 예금)"
                        value={newAssetForm.custom_type}
                        onChange={(e) => setNewAssetForm((prev) => ({ ...prev, custom_type: e.target.value }))}
                      />
                    )}
                  </td>
                  <td>
                    <input
                      type="number"
                      className="asset-edit-input asset-edit-input-small"
                      min="0"
                      step="any"
                      value={newAssetForm.quantity}
                      onChange={(e) => setNewAssetForm((prev) => ({ ...prev, quantity: e.target.value }))}
                    />
                    {newAssetForm.asset_type === "custom" && (
                      <input
                        type="number"
                        className="asset-edit-input asset-edit-input-small"
                        style={{ marginTop: "0.3rem" }}
                        placeholder="단가(원)"
                        min="1"
                        value={newAssetForm.price_krw}
                        onChange={(e) => setNewAssetForm((prev) => ({ ...prev, price_krw: e.target.value }))}
                      />
                    )}
                  </td>
                  <td>
                    {["stock", "kr_stock"].includes(newAssetForm.asset_type) && (
                      <input
                        type="text"
                        className="asset-edit-input asset-edit-input-small"
                        placeholder="심볼"
                        value={newAssetForm.symbol}
                        onChange={(e) => handleSymbolChange(e.target.value, newAssetForm.asset_type)}
                      />
                    )}
                  </td>
                  <td>-</td>
                  <td className="asset-actions-col">
                    <button
                      className="icon-btn small"
                      type="button"
                      onClick={handleAddAsset}
                      disabled={saving}
                      title="추가"
                    >
                      <i className="fa-solid fa-check" />
                    </button>
                    <button
                      className="icon-btn small"
                      type="button"
                      onClick={resetNewAssetForm}
                      title="취소"
                    >
                      <i className="fa-solid fa-xmark" />
                    </button>
                  </td>
                  {periodTotals.map((row, index) => (
                    <td key={`add-${row.period_start}-${index}`}>-</td>
                  ))}
                </tr>
              )}
              <tr>
                <td className="asset-name-col">총 자산</td>
                <td>-</td>
                <td>-</td>
                <td>-</td>
                <td>-</td>
                {periodTotals.map((row, index) => {
                  const prev = periodTotals[index + 1];
                  const totalClass = getDeltaClass(row.total_krw, prev?.total_krw);
                  return (
                    <td key={`${row.period_start}-${index}`} className={totalClass}>
                      {formatKRW(row.total_krw)}
                    </td>
                  );
                })}
              </tr>
              {filteredTableColumns.map((asset) => {
                const meta = assetMetaById.get(asset.id);
                const isEditing = editingAssetId === asset.id;
                return (
                  <tr key={asset.id}>
                    <td className="asset-name-col">
                      {isEditing ? (
                        <div className="asset-edit-name-group">
                          <input
                            type="text"
                            className="asset-edit-input"
                            value={editForm.name}
                            onChange={(e) => setEditForm((prev) => ({ ...prev, name: e.target.value }))}
                            placeholder="이름"
                          />
                          <input
                            type="text"
                            className="asset-edit-input asset-edit-input-small"
                            value={editForm.symbol}
                            onChange={(e) => setEditForm((prev) => ({ ...prev, symbol: e.target.value }))}
                            placeholder="티커"
                          />
                        </div>
                      ) : (
                        <>
                          {asset.name} <span className="muted">({asset.symbol})</span>
                        </>
                      )}
                    </td>
                    <td>
                      {isEditing ? (
                        <input
                          type="number"
                          className="asset-edit-input asset-edit-input-small"
                          min="0"
                          step="any"
                          value={editForm.quantity}
                          onChange={(e) => setEditForm((prev) => ({ ...prev, quantity: e.target.value }))}
                        />
                      ) : (
                        formatQuantity(meta?.quantity)
                      )}
                    </td>
                    <td>
                      {(() => {
                        const assetType = meta?.asset_type?.toLowerCase();
                        const isCustomAsset = !["stock", "crypto", "kr_stock", "cash"].includes(assetType);
                        if (isEditing && isCustomAsset) {
                          return (
                            <input
                              type="number"
                              className="asset-edit-input asset-edit-input-small"
                              min="0"
                              step="any"
                              placeholder="단가(원)"
                              value={editForm.price_krw}
                              onChange={(e) => setEditForm((prev) => ({ ...prev, price_krw: e.target.value }))}
                            />
                          );
                        }
                        if (assetType === "crypto" || assetType === "kr_stock") {
                          return meta?.last_price_krw ? formatKRW(meta.last_price_krw) : "-";
                        }
                        return meta?.last_price_usd ? formatUSD(meta.last_price_usd) : "-";
                      })()}
                    </td>
                    <td className="muted">
                      {meta?.source || "-"}
                    </td>
                    <td className="asset-actions-col">
                      {isEditing ? (
                        <>
                          <button
                            className="icon-btn small"
                            type="button"
                            onClick={() => saveEdit(asset.id)}
                            disabled={saving}
                            title="저장"
                          >
                            <i className="fa-solid fa-check" />
                          </button>
                          <button
                            className="icon-btn small"
                            type="button"
                            onClick={cancelEdit}
                            title="취소"
                          >
                            <i className="fa-solid fa-xmark" />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            className="icon-btn small"
                            type="button"
                            onClick={() => startEdit(meta || asset)}
                            title="편집"
                          >
                            <i className="fa-solid fa-pencil" />
                          </button>
                          <button
                            className="icon-btn small"
                            type="button"
                            onClick={() => handleDelete(asset.id, asset.name)}
                            title="삭제"
                          >
                            <i className="fa-solid fa-trash" />
                          </button>
                        </>
                      )}
                    </td>
                    {periodTotals.map((row, index) => {
                      const current = (row.assets || []).find((item) => item.id === asset.id);
                      const prev = periodTotals[index + 1];
                      const prevAsset = prev?.assets?.find((item) => item.id === asset.id);
                      const assetClass = getDeltaClass(current?.total_krw, prevAsset?.total_krw);
                      return (
                        <td key={`${asset.id}-${row.period_start}-${index}`} className={assetClass}>
                          {formatKRW(current?.total_krw || 0)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">데이터가 없습니다.</p>
      )}
    </section>
  );
};

export default AssetTable;
