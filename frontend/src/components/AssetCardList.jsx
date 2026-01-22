import { useState } from "react";
import { formatKRW, formatUSD } from "../utils/format.js";

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

const AssetCardList = ({
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
  isMobile
}) => {
  const [cardHistoryOpen, setCardHistoryOpen] = useState({});

  const getCardPeriods = (key) =>
    isMobile && !cardHistoryOpen[key] ? periodTotals.slice(0, 1) : periodTotals.slice(0, 7);

  return (
    <div className="asset-table-cards">
      {addingNew && (
        <article className="asset-change-card asset-add-card">
          <div className="asset-add-card-form">
            <h4>새 자산 추가</h4>
            <label>
              종목명
              <input
                type="text"
                placeholder="Apple, Bitcoin"
                value={newAssetForm.name}
                onChange={(e) => setNewAssetForm((prev) => ({ ...prev, name: e.target.value }))}
              />
            </label>
            <label>
              유형
              <select
                value={newAssetForm.asset_type}
                onChange={(e) => setNewAssetForm((prev) => ({ ...prev, asset_type: e.target.value }))}
              >
                <option value="stock">미국 주식</option>
                <option value="kr_stock">국내 주식</option>
                <option value="crypto">비트코인</option>
                <option value="cash">현금</option>
                <option value="custom">직접 입력</option>
              </select>
            </label>
            {newAssetForm.asset_type === "custom" && (
              <label>
                직접 입력 유형
                <input
                  type="text"
                  placeholder="예금, IRP 계좌"
                  value={newAssetForm.custom_type}
                  onChange={(e) => setNewAssetForm((prev) => ({ ...prev, custom_type: e.target.value }))}
                />
              </label>
            )}
            {["stock", "kr_stock"].includes(newAssetForm.asset_type) && (
              <label>
                심볼
                <input
                  type="text"
                  placeholder="AAPL"
                  value={newAssetForm.symbol}
                  onChange={(e) => handleSymbolChange(e.target.value, newAssetForm.asset_type)}
                />
              </label>
            )}
            <label>
              수량
              <input
                type="number"
                min="0"
                step="any"
                value={newAssetForm.quantity}
                onChange={(e) => setNewAssetForm((prev) => ({ ...prev, quantity: e.target.value }))}
              />
            </label>
            {newAssetForm.asset_type === "custom" && (
              <label>
                단가(원)
                <input
                  type="number"
                  min="1"
                  placeholder="10000"
                  value={newAssetForm.price_krw}
                  onChange={(e) => setNewAssetForm((prev) => ({ ...prev, price_krw: e.target.value }))}
                />
              </label>
            )}
            <div className="asset-add-card-actions">
              <button
                className="primary small"
                type="button"
                onClick={handleAddAsset}
                disabled={saving}
              >
                추가
              </button>
              <button
                className="ghost small"
                type="button"
                onClick={resetNewAssetForm}
              >
                취소
              </button>
            </div>
          </div>
        </article>
      )}
      <article className="asset-change-card">
        <div className="asset-change-header">
          <div>
            <h4>총 자산</h4>
            <p className="asset-change-meta muted">요약</p>
          </div>
        </div>
        <div className="asset-change-body">
          {getCardPeriods("total").map((row, index) => {
            const prev = periodTotals[index + 1];
            const totalClass = getDeltaClass(row.total_krw, prev?.total_krw);
            return (
              <div key={`total-${row.period_start}-${index}`} className="asset-change-row">
                <span className="asset-change-date">{formatAxisDate(row.period_start)}</span>
                <span className={totalClass}>{formatKRW(row.total_krw)}</span>
              </div>
            );
          })}
          {periodTotals.length > 1 ? (
            <button
              type="button"
              className="ghost small asset-card-toggle"
              onClick={() =>
                setCardHistoryOpen((prev) => ({
                  ...prev,
                  total: !prev.total
                }))
              }
            >
              {cardHistoryOpen.total ? "접기" : "더보기"}
            </button>
          ) : null}
        </div>
      </article>
      {filteredTableColumns.map((asset) => {
        const meta = assetMetaById.get(asset.id) || {};
        const cardKey = `asset-${asset.id}`;
        const isEditing = editingAssetId === asset.id;
        return (
          <article key={`card-${asset.id}`} className="asset-change-card">
            <div className="asset-change-header">
              <div style={{ flex: 1 }}>
                {isEditing ? (
                  <>
                    <input
                      type="text"
                      className="asset-edit-input"
                      value={editForm.name}
                      onChange={(e) => setEditForm((prev) => ({ ...prev, name: e.target.value }))}
                      placeholder="이름"
                      style={{ marginBottom: "0.5rem" }}
                    />
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
                      <span className="muted">티커:</span>
                      <input
                        type="text"
                        className="asset-edit-input"
                        style={{ width: "100px" }}
                        value={editForm.symbol}
                        onChange={(e) => setEditForm((prev) => ({ ...prev, symbol: e.target.value }))}
                        placeholder="AAPL"
                      />
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <span className="muted">수량:</span>
                      <input
                        type="number"
                        className="asset-edit-input"
                        style={{ width: "80px" }}
                        min="0"
                        step="any"
                        value={editForm.quantity}
                        onChange={(e) => setEditForm((prev) => ({ ...prev, quantity: e.target.value }))}
                      />
                    </div>
                    {!["stock", "crypto", "kr_stock", "cash"].includes(meta?.asset_type?.toLowerCase()) && (
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.5rem" }}>
                        <span className="muted">단가:</span>
                        <input
                          type="number"
                          className="asset-edit-input"
                          style={{ width: "100px" }}
                          min="0"
                          step="any"
                          placeholder="원"
                          value={editForm.price_krw}
                          onChange={(e) => setEditForm((prev) => ({ ...prev, price_krw: e.target.value }))}
                        />
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <h4>
                      {asset.name} <span className="muted">({asset.symbol})</span>
                      {meta.source && (
                        <span className="source-badge muted">
                          {meta.source}
                        </span>
                      )}
                    </h4>
                    <p className="asset-change-meta">
                      보유 {formatQuantity(meta.quantity)} ·{" "}
                      {(() => {
                        const assetType = meta?.asset_type?.toLowerCase();
                        if (assetType === "crypto" || assetType === "kr_stock") {
                          return meta?.last_price_krw ? formatKRW(meta.last_price_krw) : "-";
                        }
                        return meta?.last_price_usd ? formatUSD(meta.last_price_usd) : "-";
                      })()}
                    </p>
                  </>
                )}
              </div>
              <div className="asset-card-actions">
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
                      onClick={() => startEdit(meta)}
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
              </div>
            </div>
            <div className="asset-change-body">
              {getCardPeriods(cardKey).map((row, index) => {
                const current = (row.assets || []).find((item) => item.id === asset.id);
                const prev = periodTotals[index + 1];
                const prevAsset = prev?.assets?.find((item) => item.id === asset.id);
                const assetClass = getDeltaClass(current?.total_krw, prevAsset?.total_krw);
                return (
                  <div key={`${asset.id}-${row.period_start}-${index}`} className="asset-change-row">
                    <span className="asset-change-date">{formatAxisDate(row.period_start)}</span>
                    <span className={assetClass}>{formatKRW(current?.total_krw || 0)}</span>
                  </div>
                );
              })}
              {periodTotals.length > 1 ? (
                <button
                  type="button"
                  className="ghost small asset-card-toggle"
                  onClick={() =>
                    setCardHistoryOpen((prev) => ({
                      ...prev,
                      [cardKey]: !prev[cardKey]
                    }))
                  }
                >
                  {cardHistoryOpen[cardKey] ? "접기" : "더보기"}
                </button>
              ) : null}
            </div>
          </article>
        );
      })}
    </div>
  );
};

export default AssetCardList;
