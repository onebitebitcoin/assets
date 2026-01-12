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
      return;
    }
    const next = {};
    const nextPrices = {};
    assets.forEach((asset) => {
      next[asset.id] = String(Math.trunc(asset.quantity));
      if (isCustomType(asset.asset_type)) {
        nextPrices[asset.id] = asset.last_price_krw ? String(asset.last_price_krw) : "";
      }
    });
    setQuantityEdits(next);
    setPriceEdits(nextPrices);
  }, [assets]);

  useEffect(() => {
    setAssetForm((prev) => {
      if (prev.asset_type === "crypto" && prev.symbol !== "BTC") {
        return { ...prev, symbol: "BTC" };
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

  const isCustomType = (value) => !["stock", "crypto"].includes(value);

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
          <h3>새 자산 추가</h3>
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
                <option value="crypto">비트코인</option>
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
                placeholder={assetForm.asset_type === "crypto" ? "BTC" : "AAPL"}
                disabled={assetForm.asset_type !== "stock"}
                required
              />
            </label>
            <label>
              {assetForm.asset_type === "custom" ? "금액(만원)" : "수량"}
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
          <p className="muted">비트코인과 직접 입력 자산만 지원합니다.</p>
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
                return (
                  <li key={asset.id} className="asset-item">
                    <div>
                      <div className="asset-title">
                        <p className="asset-name">{asset.name}</p>
                      </div>
                      <p className="asset-meta">
                        {asset.symbol} · {asset.quantity}
                      </p>
                      <div className="asset-quantity">
                        <label>
                          수량
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
                        {isCustom ? (
                          <label>
                            단가(원)
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
                        ) : null}
                        <button
                          className="primary small"
                          type="button"
                          disabled={
                            !parseQuantityInput(quantityEdits[asset.id]) ||
                            (isCustom && !parsePriceInput(priceEdits[asset.id])) ||
                            (parseQuantityInput(quantityEdits[asset.id]) ===
                              Math.trunc(asset.quantity) &&
                              (!isCustom ||
                                parsePriceInput(priceEdits[asset.id]) === asset.last_price_krw))
                          }
                          onClick={() => {
                            const value = parseQuantityInput(quantityEdits[asset.id]);
                            if (!value) {
                              setError(
                                "수량은 1 이상의 정수만 가능합니다."
                              );
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
                              quantity: value,
                              ...(priceValue ? { price_krw: priceValue } : {})
                            })
                              .then((updated) => {
                                setAssets((prev) =>
                                  prev.map((item) => (item.id === asset.id ? updated : item))
                                );
                                setQuantityEdits((prev) => ({
                                  ...prev,
                                  [asset.id]: String(value)
                                }));
                                if (priceValue) {
                                  setPriceEdits((prev) => ({
                                    ...prev,
                                    [asset.id]: String(priceValue)
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
                      </div>
                      {isCustom ? (
                        <p className="asset-meta">단가를 수정할 수 있습니다.</p>
                      ) : (
                        <p className="asset-meta">
                          1주/1코인: {formatUSD(asset.last_price_usd)} ·{" "}
                          {formatKRW(asset.last_price_krw)}
                        </p>
                      )}
                      <p className="asset-meta">업데이트: {formatUpdatedAt(asset.last_updated)}</p>
                    </div>
                    <div className="asset-value">
                      <p className="asset-total-usd">
                        {formatUSD(
                          asset.last_price_usd ? asset.last_price_usd * asset.quantity : null
                        )}
                      </p>
                      <p className="asset-total-krw">{formatKRW(asset.value_krw)}</p>
                      <button className="text" onClick={() => onDelete(asset.id)}>
                        삭제
                      </button>
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
