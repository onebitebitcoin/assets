import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  addAsset,
  clearToken,
  deleteAsset,
  listAssets,
  refreshAsset,
  refreshSummary,
  updateAsset
} from "../api.js";
import { formatKRW, formatUSD } from "../utils/format.js";

const emptyAsset = {
  name: "",
  symbol: "",
  asset_type: "stock",
  quantity: 1,
  custom_type: "",
  price_krw: ""
};

const EditAssets = () => {
  const navigate = useNavigate();
  const [assets, setAssets] = useState([]);
  const [assetForm, setAssetForm] = useState(emptyAsset);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [warnings, setWarnings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshingAssets, setRefreshingAssets] = useState({});
  const [quantityEdits, setQuantityEdits] = useState({});
  const [priceEdits, setPriceEdits] = useState({});
  const [nameEdits, setNameEdits] = useState({});
  const [symbolEdits, setSymbolEdits] = useState({});
  const [typeEdits, setTypeEdits] = useState({});
  const [addOpen, setAddOpen] = useState(false);
  const [sortMode, setSortMode] = useState("value");
  const [searchQuery, setSearchQuery] = useState("");

  const parseUpdatedAt = (value) => {
    if (!value) {
      return 0;
    }
    const raw = typeof value === "string" ? value : value.toString();
    const hasTimezone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(raw);
    const date = new Date(hasTimezone ? raw : `${raw}Z`);
    if (Number.isNaN(date.getTime())) {
      return 0;
    }
    return date.getTime();
  };

  const sortAssets = (list, mode) => {
    const sorted = [...list];
    if (mode === "updated") {
      sorted.sort((a, b) => {
        const delta = parseUpdatedAt(b.last_updated) - parseUpdatedAt(a.last_updated);
        if (delta !== 0) {
          return delta;
        }
        const aValue = a.value_krw ?? (a.last_price_krw || 0) * a.quantity;
        const bValue = b.value_krw ?? (b.last_price_krw || 0) * b.quantity;
        if (bValue !== aValue) {
          return bValue - aValue;
        }
        return a.name.localeCompare(b.name, "ko-KR");
      });
      return sorted;
    }
    sorted.sort((a, b) => {
      const aValue = a.value_krw ?? (a.last_price_krw || 0) * a.quantity;
      const bValue = b.value_krw ?? (b.last_price_krw || 0) * b.quantity;
      if (bValue !== aValue) {
        return bValue - aValue;
      }
      return a.name.localeCompare(b.name, "ko-KR");
    });
    return sorted;
  };

  const loadAssets = async () => {
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const data = await listAssets();
      setAssets(sortAssets(data, sortMode));
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
    setAssets((prev) => sortAssets(prev, sortMode));
  }, [sortMode]);

  useEffect(() => {
    if (!assets.length) {
      setQuantityEdits({});
      setNameEdits({});
      setSymbolEdits({});
      setTypeEdits({});
      setPriceEdits({});
      return;
    }
    const next = {};
    const nextPrices = {};
    const nextNames = {};
    const nextSymbols = {};
    const nextTypes = {};
    assets.forEach((asset) => {
      next[asset.id] = String(Math.trunc(asset.quantity));
      nextNames[asset.id] = asset.name || "";
      nextSymbols[asset.id] = asset.symbol || "";
      nextTypes[asset.id] = asset.asset_type || "stock";
      if (isCustomType(asset.asset_type)) {
        nextPrices[asset.id] = asset.last_price_krw ? String(asset.last_price_krw) : "";
      }
    });
    setQuantityEdits(next);
    setPriceEdits(nextPrices);
    setNameEdits(nextNames);
    setSymbolEdits(nextSymbols);
    setTypeEdits(nextTypes);
  }, [assets]);

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

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredAssets = normalizedQuery
    ? assets.filter((asset) => (asset.name || "").toLowerCase().includes(normalizedQuery))
    : assets;

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
    setSuccess("");
    try {
      const data = await refreshSummary();
      setAssets(sortAssets(data.assets, sortMode));
      setWarnings(data.errors || []);
      if (!data.errors || data.errors.length === 0) {
        setSuccess("가격 업데이트가 완료되었습니다.");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setRefreshing(false);
    }
  };

  const onRefreshAsset = async (assetId) => {
    setRefreshingAssets((prev) => ({ ...prev, [assetId]: true }));
    setError("");
    setSuccess("");
    try {
      const asset = assets.find((a) => a.id === assetId);
      const updated = await refreshAsset(assetId);
      setAssets((prev) =>
        sortAssets(
          prev.map((item) => (item.id === assetId ? updated : item)),
          sortMode
        )
      );
      const sourceText = updated.source ? ` (${updated.source})` : "";
      setSuccess(`${asset?.name || "자산"} 가격이 업데이트되었습니다.${sourceText}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setRefreshingAssets((prev) => ({ ...prev, [assetId]: false }));
    }
  };

  const onAddAsset = async (event) => {
    event.preventDefault();
    setError("");
    setSuccess("");
    try {
      const quantityValue = Number(assetForm.quantity);
      if (!Number.isInteger(quantityValue) || quantityValue <= 0) {
        setError("수량은 1 이상의 정수만 가능합니다.");
        return;
      }
      const isCustom = assetForm.asset_type === "custom";
      const customType = assetForm.custom_type.trim();
      if (isCustom && !customType) {
        setError("직접 입력 유형을 입력해 주세요.");
        return;
      }
      let priceValue = null;
      if (isCustom) {
        priceValue = Number(assetForm.price_krw);
        if (!Number.isFinite(priceValue) || priceValue <= 0) {
          setError("단가는 1 이상의 숫자만 가능합니다.");
          return;
        }
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
        quantity: quantityValue,
        ...(priceValue ? { price_krw: priceValue } : {})
      });
      setAssetForm(emptyAsset);
      await onRefresh();
      setSuccess("자산이 추가되었습니다.");
    } catch (err) {
      setError(err.message);
    }
  };

  const onDelete = async (id) => {
    try {
      await deleteAsset(id);
      await loadAssets();
      setSuccess("자산이 삭제되었습니다.");
    } catch (err) {
      setError(err.message);
    }
  };

  const formatUpdatedAt = (value) => {
    if (!value) {
      return "-";
    }
    const raw = typeof value === "string" ? value : value.toString();
    const hasTimezone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(raw);
    // 타임존 정보가 없으면 한국 시간(+09:00)으로 해석
    const date = new Date(hasTimezone ? raw : `${raw}+09:00`);
    if (Number.isNaN(date.getTime())) {
      return "-";
    }
    return new Intl.DateTimeFormat("ko-KR", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Seoul"
    }).format(date);
  };

  const onLogout = () => {
    if (window.confirm("로그아웃 하시겠습니까?")) {
      clearToken();
      navigate("/login");
    }
  };

  return (
    <>
      <nav className="navbar">
        <span className="navbar-title">흙창고 현황</span>
        <div className="navbar-actions">
          <button
            className="icon-btn"
            onClick={() => navigate("/dashboard")}
            title="대시보드"
            type="button"
          >
            <i className="fa-solid fa-grip" />
          </button>
          <button
            className="icon-btn"
            onClick={() => navigate("/settings")}
            title="설정"
            type="button"
          >
            <i className="fa-solid fa-gear" />
          </button>
          <button
            className="icon-btn"
            onClick={onLogout}
            title="로그아웃"
            type="button"
          >
            <i className="fa-solid fa-right-from-bracket" />
          </button>
        </div>
      </nav>

      <div className="dashboard">

      {error ? <p className="error">{error}</p> : null}
      {success ? <p className="success">{success}</p> : null}
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
            <div className="panel-header-left">
              <h3>보유 자산</h3>
              <div className="panel-header-icons">
                <button
                  className="icon-btn"
                  onClick={onRefresh}
                  disabled={refreshing}
                  title="가격 업데이트"
                  type="button"
                >
                  <i className={`fa-solid fa-arrows-rotate${refreshing ? " spinning" : ""}`} />
                </button>
                <button
                  className="icon-btn"
                  type="button"
                  aria-expanded={addOpen}
                  onClick={() => setAddOpen((prev) => !prev)}
                  title={addOpen ? "추가 닫기" : "자산 추가"}
                >
                  {addOpen ? <i className="fa-solid fa-xmark" /> : <i className="fa-solid fa-plus" />}
                </button>
              </div>
            </div>
            <div className="asset-panel-actions">
              <input
                type="text"
                placeholder="이름으로 검색"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="asset-search-input"
              />
              <select
                className="asset-sort-select"
                value={sortMode}
                onChange={(event) => setSortMode(event.target.value)}
              >
                <option value="value">총금액순</option>
                <option value="updated">최근 업데이트</option>
              </select>
            </div>
          </div>
          <div className="asset-add-panel">
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
                  {assetForm.asset_type === "cash" ? "금액(만원)" : "수량"}
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
                {assetForm.asset_type === "custom" ? (
                  <label>
                    단가(원)
                    <input
                      name="price_krw"
                      type="number"
                      min="1"
                      step="1"
                      inputMode="numeric"
                      value={assetForm.price_krw}
                      onChange={(event) =>
                        setAssetForm((prev) => ({ ...prev, price_krw: event.target.value }))
                      }
                      required
                    />
                  </label>
                ) : null}
                <button className="primary" type="submit">
                  자산 추가
                </button>
              </form>
              <p className="muted">미국/국내 주식, 비트코인, 현금, 직접 입력 자산만 지원합니다.</p>
            </div>
          </div>

          <div className="asset-section-divider" />
          {loading ? (
            <p className="muted">불러오는 중...</p>
          ) : filteredAssets.length ? (
            <ul className="asset-list">
              {filteredAssets.map((asset) => {
                const isCustom = isCustomType(asset.asset_type);
                const hasChanges =
                  nameEdits[asset.id] !== asset.name ||
                  symbolEdits[asset.id] !== asset.symbol ||
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
                        <div>
                          <p className="asset-total-krw">{formatKRW(asset.value_krw)}</p>
                          {!isCustom && (
                            <p className="asset-meta">
                              {formatUSD(asset.last_price_usd ? asset.last_price_usd * asset.quantity : null)}
                            </p>
                          )}
                        </div>
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
                          <span className="label-text">심볼</span>
                          <input
                            type="text"
                            value={symbolEdits[asset.id] ?? ""}
                            onChange={(event) =>
                              setSymbolEdits((prev) => ({
                                ...prev,
                                [asset.id]: event.target.value
                              }))
                            }
                            placeholder="종목코드"
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
                            className="ghost small"
                            onClick={() => onRefreshAsset(asset.id)}
                            disabled={refreshingAssets[asset.id]}
                            type="button"
                            title="가격 업데이트"
                          >
                            {refreshingAssets[asset.id] ? "새로고침 중..." : "새로고침"}
                          </button>
                          <button
                            className="primary small"
                            type="button"
                            disabled={
                              !nameEdits[asset.id]?.trim() ||
                              !symbolEdits[asset.id]?.trim() ||
                              !parseQuantityInput(quantityEdits[asset.id]) ||
                              (isCustom && !parsePriceInput(priceEdits[asset.id])) ||
                              !hasChanges
                            }
                            onClick={() => {
                              setSuccess("");
                              const name = nameEdits[asset.id]?.trim();
                              if (!name) {
                                setError("이름을 입력해주세요.");
                                return;
                              }
                              const symbol = symbolEdits[asset.id]?.trim();
                              if (!symbol) {
                                setError("심볼을 입력해주세요.");
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
                                symbol: symbolEdits[asset.id],
                                asset_type: typeEdits[asset.id],
                                quantity: value,
                                ...(priceValue ? { price_krw: priceValue } : {})
                              })
                                .then((updated) => {
                                  setAssets((prev) =>
                                    sortAssets(
                                      prev.map((item) => (item.id === asset.id ? updated : item)),
                                      sortMode
                                    )
                                  );
                                  setSuccess("저장되었습니다.");
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
          ) : assets.length ? (
            <p className="muted">검색 결과가 없습니다.</p>
          ) : (
            <p className="muted">아직 등록된 자산이 없습니다.</p>
          )}
        </div>
      </section>
      </div>
    </>
  );
};

export default EditAssets;
