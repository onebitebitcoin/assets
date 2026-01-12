import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  addAsset,
  clearToken,
  deleteAsset,
  listAssets,
  refreshSummary,
  updateAsset
} from "../api.js";
import { formatKRW, formatUSD } from "../utils/format.js";

const emptyAsset = { name: "", symbol: "", asset_type: "stock", quantity: 1, custom_type: "" };

const EditAssets = () => {
  const navigate = useNavigate();
  const [assets, setAssets] = useState([]);
  const [assetForm, setAssetForm] = useState(emptyAsset);
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [quantityEdits, setQuantityEdits] = useState({});
  const [priceEdits, setPriceEdits] = useState({});
  const [nameEdits, setNameEdits] = useState({});
  const [typeEdits, setTypeEdits] = useState({});
  const [addOpen, setAddOpen] = useState(false);

  const loadAssets = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await listAssets();
      const sorted = [...data].sort((a, b) => {
        const aValue = a.value_krw ?? (a.last_price_krw || 0) * a.quantity;
        const bValue = b.value_krw ?? (b.last_price_krw || 0) * b.quantity;
        if (bValue !== aValue) {
          return bValue - aValue;
        }
        return a.name.localeCompare(b.name, "ko-KR");
      });
      setAssets(sorted);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAssets();
  }, []);

  useEffect(() => {
    if (!assets.length) {
      setQuantityEdits({});
      setNameEdits({});
      setTypeEdits({});
      setPriceEdits({});
      return;
    }
    const next = {};
    const nextPrices = {};
    const nextNames = {};
    const nextTypes = {};
    assets.forEach((asset) => {
      // Only set if not already set (for initial load and new assets)
      if (!(asset.id in quantityEdits)) {
        next[asset.id] = String(Math.trunc(asset.quantity));
      }
      if (!(asset.id in nameEdits)) {
        nextNames[asset.id] = asset.name || "";
      }
      if (!(asset.id in typeEdits)) {
        nextTypes[asset.id] = asset.asset_type || "stock";
      }
      if (isCustomType(asset.asset_type) && !(asset.id in priceEdits)) {
        nextPrices[asset.id] = asset.last_price_krw ? String(asset.last_price_krw) : "";
      }
    });
    if (Object.keys(next).length > 0) {
      setQuantityEdits((prev) => ({ ...prev, ...next }));
    }
    if (Object.keys(nextPrices).length > 0) {
      setPriceEdits((prev) => ({ ...prev, ...nextPrices }));
    }
    if (Object.keys(nextNames).length > 0) {
      setNameEdits((prev) => ({ ...prev, ...nextNames }));
    }
    if (Object.keys(nextTypes).length > 0) {
      setTypeEdits((prev) => ({ ...prev, ...nextTypes }));
    }
  }, [assets, quantityEdits, nameEdits, typeEdits, priceEdits]);

  useEffect(() => {
    setAssetForm((prev) => {
      if (prev.asset_type === "crypto" && prev.symbol !== "BTC") {
        return { ...prev, symbol: "BTC" };
      }
      if (prev.asset_type === "cash" && prev.symbol !== "CASH") {
        return { ...prev, symbol: "CASH" };
      }
      if (prev.asset_type === "custom" && prev.custom_type && prev.symbol !== prev.custom_type) {
        return { ...prev, symbol: prev.custom_type };
      }
      return prev;
    });
  }, [assetForm.asset_type, assetForm.custom_type]);

  const parseQuantityInput = (value) => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return null;
    }
    return parsed;
  };
  const parsePriceInput = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return null;
    }
    return parsed;
  };

  const isCustomType = (value) => !["stock", "crypto", "kr_stock", "cash"].includes(value);

  const onRefresh = async () => {
    setRefreshing(true);
    setError("");
    try {
      const data = await refreshSummary();
      setAssets(data.assets);
      setWarnings(data.errors || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setRefreshing(false);
    }
  };

  const onAddAsset = async (event) => {
    event.preventDefault();
    setError("");
    try {
      const quantityValue = Number(assetForm.quantity);
      if (!Number.isInteger(quantityValue) || quantityValue <= 0) {
        setError(
          assetForm.asset_type === "custom"
            ? "금액은 1 이상의 정수(만원)만 가능합니다."
            : "수량은 1 이상의 정수만 가능합니다."
        );
        return;
      }
      const isCustom = assetForm.asset_type === "custom";
      const customType = assetForm.custom_type.trim();
      if (isCustom && !customType) {
        setError("직접 입력 유형을 입력해 주세요.");
        return;
      }
      await addAsset({
        name: assetForm.name,
        asset_type: isCustom ? customType : assetForm.asset_type,
        symbol: isCustom
          ? customType
          : assetForm.asset_type === "crypto"
            ? "BTC"
            : assetForm.asset_type === "cash"
              ? "CASH"
              : assetForm.symbol.trim().toUpperCase(),
        quantity: quantityValue
      });
      setAssetForm(emptyAsset);
      await onRefresh();
    } catch (err) {
      setError(err.message);
    }
  };

  const onDelete = async (id) => {
    try {
      await deleteAsset(id);
      await loadAssets();
    } catch (err) {
      setError(err.message);
    }
  };

  const formatUpdatedAt = (value) => {
    if (!value) {
      return "-";
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "-";
    }
    return new Intl.DateTimeFormat("ko-KR", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
  };

  const onLogout = () => {
    clearToken();
    navigate("/login");
  };

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">Manage Assets</p>
          <h1>자산 관리</h1>
          <p className="subtext">자산 수정 및 추가를 진행하세요.</p>
        </div>
        <div className="header-actions">
          <button className="ghost" onClick={() => navigate("/dashboard")}> 
            대시보드
          </button>
          <button className="ghost" onClick={onLogout}>
            로그아웃
          </button>
        </div>
      </header>

      {error ? <p className="error">{error}</p> : null}
      {warnings.length ? (
        <div className="warning">
          {warnings.map((message) => (
            <p key={message}>{message}</p>
          ))}
        </div>
      ) : null}

      <section className="grid">
        <div className="panel full">
          <div className="panel-header">
            <h3>새 자산 추가</h3>
            <button
              className="ghost small"
              type="button"
              aria-expanded={addOpen}
              onClick={() => setAddOpen((prev) => !prev)}
            >
              {addOpen ? "닫기" : "＋"}
            </button>
          </div>
          <div className={`asset-add-body${addOpen ? " open" : ""}`}>
            <form className="asset-form" onSubmit={onAddAsset}>
              <label>
                자산 이름
                <input
                  name="name"
                  value={assetForm.name}
                  onChange={(event) =>
                    setAssetForm((prev) => ({ ...prev, name: event.target.value }))
                  }
                  placeholder="Apple, Bitcoin"
                  required
                />
              </label>
              <label>
                유형
                <select
                  name="asset_type"
                  value={assetForm.asset_type}
                  onChange={(event) =>
                    setAssetForm((prev) => ({ ...prev, asset_type: event.target.value }))
                  }
                >
                  <option value="stock">미국 주식</option>
                  <option value="kr_stock">국내 주식</option>
                  <option value="crypto">비트코인</option>
                  <option value="cash">현금</option>
                  <option value="custom">직접 입력</option>
                </select>
              </label>
              {assetForm.asset_type === "custom" ? (
                <label>
                  직접 입력 유형
                  <input
                    name="custom_type"
                    value={assetForm.custom_type}
                    onChange={(event) =>
                      setAssetForm((prev) => ({ ...prev, custom_type: event.target.value }))
                    }
                    placeholder="예금, IRP 계좌"
                    required
                  />
                </label>
              ) : null}
              <label>
                심볼
                <input
                  name="symbol"
                  value={assetForm.symbol}
                  onChange={(event) =>
                    setAssetForm((prev) => ({ ...prev, symbol: event.target.value }))
                  }
                placeholder={
                  assetForm.asset_type === "crypto"
                    ? "BTC"
                    : assetForm.asset_type === "kr_stock"
                      ? "005930"
                      : assetForm.asset_type === "cash"
                        ? "CASH"
                        : "AAPL"
                }
                disabled={!["stock", "kr_stock"].includes(assetForm.asset_type)}
                required
              />
            </label>
            <label>
              {["custom", "cash"].includes(assetForm.asset_type) ? "금액(만원)" : "수량"}
              <input
                name="quantity"
                type="number"
                  min="1"
                  step="1"
                  inputMode="numeric"
                  value={assetForm.quantity}
                  onChange={(event) =>
                    setAssetForm((prev) => ({ ...prev, quantity: event.target.value }))
                  }
                  required
                />
              </label>
              <button className="primary" type="submit">
                자산 추가
              </button>
            </form>
            <p className="muted">미국/국내 주식, 비트코인, 현금, 직접 입력 자산만 지원합니다.</p>
          </div>
        </div>

        <div className="panel full">
          <div className="panel-header">
            <h3>보유 자산</h3>
            <button className="ghost small" onClick={onRefresh} disabled={refreshing}>
              {refreshing ? "업데이트 중" : "가격 업데이트"}
            </button>
          </div>
          {loading ? (
            <p className="muted">불러오는 중...</p>
          ) : assets.length ? (
            <ul className="asset-list">
              {assets.map((asset) => {
                const isCustom = isCustomType(asset.asset_type);
                const hasChanges =
                  nameEdits[asset.id] !== asset.name ||
                  typeEdits[asset.id] !== asset.asset_type ||
                  parseQuantityInput(quantityEdits[asset.id]) !== Math.trunc(asset.quantity) ||
                  (isCustom && parsePriceInput(priceEdits[asset.id]) !== asset.last_price_krw);
                return (
                  <li key={asset.id} className="asset-edit-card">
                    <div className="asset-edit-header">
                      <div>
                        <h4 className="asset-edit-name">{asset.name}</h4>
                        <p className="asset-meta">
                          {asset.symbol} · 보유: {new Intl.NumberFormat("ko-KR", {
                            minimumFractionDigits: 0,
                            maximumFractionDigits: 2
                          }).format(asset.quantity)}
                        </p>
                      </div>
                      <div className="asset-edit-value">
                        <p className="asset-total-krw">{formatKRW(asset.value_krw)}</p>
                        {!isCustom && (
                          <p className="asset-meta">
                            {formatUSD(asset.last_price_usd ? asset.last_price_usd * asset.quantity : null)}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="asset-edit-form">
                      <div className="asset-edit-grid">
                        <label>
                          <span className="label-text">이름</span>
                          <input
                            type="text"
                            value={nameEdits[asset.id] ?? ""}
                            onChange={(event) =>
                              setNameEdits((prev) => ({
                                ...prev,
                                [asset.id]: event.target.value
                              }))
                            }
                            placeholder="자산 이름"
                          />
                        </label>
                        <label>
                          <span className="label-text">유형</span>
                          <select
                            value={typeEdits[asset.id] ?? "stock"}
                            onChange={(event) =>
                              setTypeEdits((prev) => ({
                                ...prev,
                                [asset.id]: event.target.value
                              }))
                            }
                          >
                            <option value="stock">미국 주식</option>
                            <option value="kr_stock">국내 주식</option>
                            <option value="crypto">비트코인</option>
                            <option value="cash">현금</option>
                            <option value="custom">직접 입력</option>
                          </select>
                        </label>
                        <label>
                          <span className="label-text">수량</span>
                          <input
                            type="number"
                            min="1"
                            step="1"
                            inputMode="numeric"
                            value={quantityEdits[asset.id] ?? ""}
                            onChange={(event) =>
                              setQuantityEdits((prev) => ({
                                ...prev,
                                [asset.id]: event.target.value
                              }))
                            }
                          />
                        </label>
                        {isCustom && (
                          <label>
                            <span className="label-text">단가(원)</span>
                            <input
                              type="number"
                              min="1"
                              step="1"
                              inputMode="numeric"
                              value={priceEdits[asset.id] ?? ""}
                              onChange={(event) =>
                                setPriceEdits((prev) => ({
                                  ...prev,
                                  [asset.id]: event.target.value
                                }))
                              }
                            />
                          </label>
                        )}
                      </div>

                      <div className="asset-edit-footer">
                        <div className="asset-edit-info">
                          {!isCustom ? (
                            <p className="asset-meta">
                              현재가: {formatUSD(asset.last_price_usd)} · {formatKRW(asset.last_price_krw)}
                            </p>
                          ) : (
                            <p className="asset-meta">직접 입력 자산</p>
                          )}
                          <p className="asset-meta">업데이트: {formatUpdatedAt(asset.last_updated)}</p>
                        </div>
                        <div className="asset-edit-actions">
                          <button
                            className="primary small"
                            type="button"
                            disabled={
                              !nameEdits[asset.id]?.trim() ||
                              !parseQuantityInput(quantityEdits[asset.id]) ||
                              (isCustom && !parsePriceInput(priceEdits[asset.id])) ||
                              !hasChanges
                            }
                            onClick={() => {
                              const name = nameEdits[asset.id]?.trim();
                              if (!name) {
                                setError("이름을 입력해주세요.");
                                return;
                              }
                              const value = parseQuantityInput(quantityEdits[asset.id]);
                              if (!value) {
                                setError("수량은 1 이상의 정수만 가능합니다.");
                                return;
                              }
                              let priceValue = null;
                              if (isCustom) {
                                priceValue = parsePriceInput(priceEdits[asset.id]);
                                if (!priceValue) {
                                  setError("단가는 1 이상의 숫자만 가능합니다.");
                                  return;
                                }
                              }
                              updateAsset(asset.id, {
                                name,
                                asset_type: typeEdits[asset.id],
                                quantity: value,
                                ...(priceValue ? { price_krw: priceValue } : {})
                              })
                                .then((updated) => {
                                  setAssets((prev) =>
                                    prev.map((item) => (item.id === asset.id ? updated : item))
                                  );
                                  setNameEdits((prev) => ({
                                    ...prev,
                                    [asset.id]: updated.name || ""
                                  }));
                                  setTypeEdits((prev) => ({
                                    ...prev,
                                    [asset.id]: updated.asset_type || "stock"
                                  }));
                                  setQuantityEdits((prev) => ({
                                    ...prev,
                                    [asset.id]: String(Math.trunc(updated.quantity))
                                  }));
                                  const updatedIsCustom = isCustomType(updated.asset_type);
                                  if (updatedIsCustom && updated.last_price_krw) {
                                    setPriceEdits((prev) => ({
                                      ...prev,
                                      [asset.id]: String(updated.last_price_krw)
                                    }));
                                  }
                                })
                                .catch((err) => {
                                  setError(err.message);
                                });
                            }}
                          >
                            저장
                          </button>
                          <button className="ghost small" onClick={() => onDelete(asset.id)}>
                            삭제
                          </button>
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="muted">아직 등록된 자산이 없습니다.</p>
          )}
        </div>
      </section>
    </div>
  );
};

export default EditAssets;
