import { useEffect, useRef, useState } from "react";
import {
  Chart as ChartJS,
  ArcElement,
  CategoryScale,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip
} from "chart.js";
import { Doughnut, Line } from "react-chartjs-2";
import { useNavigate } from "react-router-dom";
import { Pencil, Plus, Check, X, Trash2 } from "lucide-react";
import {
  addAsset,
  clearToken,
  deleteAsset,
  fetchSummary,
  fetchTotalsDetail,
  refreshSummary,
  snapshotTotals,
  updateAsset
} from "../api.js";
import { formatDelta, formatKRW, formatRelativeTime, formatUSD } from "../utils/format.js";

ChartJS.register(
  ArcElement,
  CategoryScale,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip
);

const Dashboard = () => {
  const navigate = useNavigate();
  const initialLoadDone = useRef(false);
  const [summary, setSummary] = useState({ total_krw: 0, daily_change_krw: 0, assets: [] });
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [period, setPeriod] = useState("daily");
  const [periodTotals, setPeriodTotals] = useState([]);
  const [tableColumns, setTableColumns] = useState([]);
  const [periodOffset, setPeriodOffset] = useState(0);
  const [periodHasMore, setPeriodHasMore] = useState(false);
  const [periodLoading, setPeriodLoading] = useState(false);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [cardHistoryOpen, setCardHistoryOpen] = useState({});
  const [editingAssetId, setEditingAssetId] = useState(null);
  const [editForm, setEditForm] = useState({ name: "", quantity: "" });
  const [addingNew, setAddingNew] = useState(false);
  const [newAssetForm, setNewAssetForm] = useState({
    name: "", symbol: "", asset_type: "stock", quantity: 1, custom_type: "", price_krw: ""
  });
  const [saving, setSaving] = useState(false);
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }
    return window.matchMedia("(max-width: 640px)").matches;
  });

  // 페이지 로드 시 GET만 호출 (저장된 데이터 표시)
  const loadSummary = async () => {
    setSummaryLoading(true);
    setError("");
    try {
      const data = await fetchSummary();
      setSummary(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setSummaryLoading(false);
    }
  };

  // 수동 새로고침 (POST /refresh 호출)
  const handleManualRefresh = async () => {
    setRefreshing(true);
    setError("");
    setSuccess("");
    try {
      const data = await refreshSummary();
      setSummary(data);
      if (data.errors && data.errors.length > 0) {
        setError(data.errors.join(", "));
      } else {
        // source별 개수 집계
        const sourceCounts = {};
        (data.assets || []).forEach((asset) => {
          if (asset.source) {
            sourceCounts[asset.source] = (sourceCounts[asset.source] || 0) + 1;
          }
        });
        const sourceText = Object.entries(sourceCounts)
          .map(([source, count]) => `${source}: ${count}`)
          .join(", ");
        const successMsg = sourceText
          ? `가격이 업데이트되었습니다. (${sourceText})`
          : "가격이 업데이트되었습니다.";
        setSuccess(successMsg);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    // 초기 로딩: summary와 totals를 병렬로 요청
    const loadInitialData = async () => {
      await Promise.all([
        loadSummary(),
        loadTotals(0, false, period)
      ]);
      initialLoadDone.current = true;
    };
    loadInitialData();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }
    const media = window.matchMedia("(max-width: 640px)");
    const updateMatch = () => setIsMobile(media.matches);
    updateMatch();
    if (media.addEventListener) {
      media.addEventListener("change", updateMatch);
      return () => media.removeEventListener("change", updateMatch);
    }
    media.addListener(updateMatch);
    return () => media.removeListener(updateMatch);
  }, []);


  const onLogout = () => {
    if (window.confirm("로그아웃 하시겠습니까?")) {
      clearToken();
      navigate("/login");
    }
  };

  // 인라인 편집 핸들러
  const startEdit = (asset) => {
    setEditingAssetId(asset.id);
    setEditForm({ name: asset.name, quantity: String(asset.quantity) });
  };

  const cancelEdit = () => {
    setEditingAssetId(null);
    setEditForm({ name: "", quantity: "" });
  };

  const saveEdit = async (assetId) => {
    const quantity = Number(editForm.quantity);
    if (!editForm.name.trim()) {
      setError("이름을 입력해주세요.");
      return;
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      setError("수량은 1 이상의 정수만 가능합니다.");
      return;
    }
    setSaving(true);
    setError("");
    // Optimistic Update
    const prevAssets = summary.assets;
    setSummary((prev) => ({
      ...prev,
      assets: prev.assets.map((a) =>
        a.id === assetId ? { ...a, name: editForm.name.trim(), quantity } : a
      )
    }));
    try {
      await updateAsset(assetId, { name: editForm.name.trim(), quantity });
      setSuccess("저장되었습니다.");
      cancelEdit();
    } catch (err) {
      // 롤백
      setSummary((prev) => ({ ...prev, assets: prevAssets }));
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (assetId, assetName) => {
    if (!window.confirm(`"${assetName}"을(를) 삭제하시겠습니까?`)) return;
    setError("");
    try {
      await deleteAsset(assetId);
      setSummary((prev) => ({
        ...prev,
        assets: prev.assets.filter((a) => a.id !== assetId)
      }));
      setSuccess("자산이 삭제되었습니다.");
    } catch (err) {
      setError(err.message);
    }
  };

  const handleAddAsset = async () => {
    const quantity = Number(newAssetForm.quantity);
    if (!newAssetForm.name.trim()) {
      setError("이름을 입력해주세요.");
      return;
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      setError("수량은 1 이상의 정수만 가능합니다.");
      return;
    }
    const isCustom = newAssetForm.asset_type === "custom";
    const customType = newAssetForm.custom_type.trim();
    if (isCustom && !customType) {
      setError("직접 입력 유형을 입력해주세요.");
      return;
    }
    let priceValue = null;
    if (isCustom) {
      priceValue = Number(newAssetForm.price_krw);
      if (!Number.isFinite(priceValue) || priceValue <= 0) {
        setError("단가는 1 이상의 숫자만 가능합니다.");
        return;
      }
    }
    setSaving(true);
    setError("");
    try {
      await addAsset({
        name: newAssetForm.name.trim(),
        asset_type: isCustom ? customType : newAssetForm.asset_type,
        symbol: isCustom
          ? customType
          : newAssetForm.asset_type === "crypto"
            ? "BTC"
            : newAssetForm.asset_type === "cash"
              ? "CASH"
              : newAssetForm.symbol.trim().toUpperCase() || newAssetForm.name.trim().toUpperCase(),
        quantity,
        ...(priceValue ? { price_krw: priceValue } : {})
      });
      setNewAssetForm({ name: "", symbol: "", asset_type: "stock", quantity: 1, custom_type: "", price_krw: "" });
      setAddingNew(false);
      await loadSummary();
      setSuccess("자산이 추가되었습니다.");
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const isCustomType = (value) => !["stock", "crypto", "kr_stock", "cash"].includes(value);

  const loadTotals = async (offset = 0, append = false, nextPeriod = period) => {
    setPeriodLoading(true);
    try {
      const data = await fetchTotalsDetail(nextPeriod, 7, offset);
      setPeriodTotals((prev) => (append ? [...prev, ...data.points] : data.points));
      setTableColumns(data.assets || []);
      setPeriodOffset(offset + data.points.length);
      setPeriodHasMore(data.points.length === 7);
    } catch (err) {
      setError(err.message);
    } finally {
      setPeriodLoading(false);
    }
  };

  useEffect(() => {
    // 초기 로딩은 위에서 병렬로 처리하므로 skip
    if (!initialLoadDone.current) return;
    loadTotals(0, false, period);
  }, [period]);

  useEffect(() => {
    setCardHistoryOpen({});
  }, [period]);

  const onSnapshot = async () => {
    setSnapshotLoading(true);
    setError("");
    setSuccess("");
    try {
      // 1. 먼저 가격 갱신
      const refreshedData = await refreshSummary();
      setSummary(refreshedData);

      // 2. 그 다음 스냅샷 저장
      await snapshotTotals();
      await loadTotals(0, false, period);
      setSuccess("가격 갱신 후 스냅샷이 저장되었습니다.");
    } catch (err) {
      setError(err.message);
    } finally {
      setSnapshotLoading(false);
    }
  };

  const periodLabels = {
    daily: "Daily",
    weekly: "Weekly",
    monthly: "Monthly"
  };
  const periodUnit = {
    daily: "일",
    weekly: "주",
    monthly: "개월"
  };
  const chartSeries = [...periodTotals].reverse();
  const chartValues = chartSeries.map((item) => item.total_krw || 0);
  const assetMetaById = new Map(summary.assets.map((asset) => [asset.id, asset]));
  const sortedTableColumns = [...tableColumns].sort((a, b) => {
    const aMeta = assetMetaById.get(a.id);
    const bMeta = assetMetaById.get(b.id);
    const aValue = (aMeta?.last_price_krw || 0) * (aMeta?.quantity || 0);
    const bValue = (bMeta?.last_price_krw || 0) * (bMeta?.quantity || 0);
    if (bValue !== aValue) {
      return bValue - aValue;
    }
    return a.name.localeCompare(b.name, "ko-KR");
  });
  const filteredTableColumns = sortedTableColumns.filter((asset) => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    const name = asset.name?.toLowerCase() || "";
    const symbol = asset.symbol?.toLowerCase() || "";
    return name.includes(query) || symbol.includes(query);
  });
  // 타임존 정보가 없으면 한국 시간으로 해석
  const parseDate = (value) => {
    if (!value) return null;
    const raw = typeof value === "string" ? value : value.toString();
    const hasTimezone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(raw);
    const date = new Date(hasTimezone ? raw : `${raw}+09:00`);
    return Number.isNaN(date.getTime()) ? null : date;
  };

  // 자산들의 last_updated 중 최신 값 계산
  const assetLastUpdatedTimes = summary.assets
    .map((a) => a.last_updated)
    .filter(Boolean)
    .map((t) => parseDate(t)?.getTime())
    .filter((t) => t && !Number.isNaN(t));
  const latestAssetUpdate = assetLastUpdatedTimes.length
    ? new Date(Math.max(...assetLastUpdatedTimes))
    : null;

  // last_refreshed가 없으면 자산들의 최신 업데이트 시간 사용
  const effectiveLastRefreshed = summary.last_refreshed || (latestAssetUpdate ? latestAssetUpdate.toISOString() : null);

  const formatAxisDate = (value) => {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    return new Intl.DateTimeFormat("ko-KR", { month: "2-digit", day: "2-digit" }).format(
      date
    );
  };
  const formatAxisKrw = (value) => {
    const unit = 100000000;
    const amount = value / unit;
    return `${amount.toFixed(1)}억`;
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
  const chartLabels = chartSeries.map((item) => formatAxisDate(item.period_start));
  const chartData = {
    labels: chartLabels,
    datasets: [
      {
        label: "총 자산",
        data: chartValues,
        borderColor: "#3b82f6",
        backgroundColor: "rgba(59, 130, 246, 0.15)",
        tension: 0.35,
        pointRadius: 3,
        pointHoverRadius: 4,
        fill: true
      }
    ]
  };
  const allocationCategories = ["미국주식", "한국주식", "비트코인", "기타(직접입력)"];
  const allocationColorMap = {
    미국주식: "#60a5fa",
    한국주식: "#f97316",
    비트코인: "#fbbf24",
    "기타(직접입력)": "#94a3b8"
  };
  const allocationTotals = allocationCategories.reduce(
    (acc, label) => ({ ...acc, [label]: 0 }),
    {}
  );
  summary.assets.forEach((asset) => {
    const value = (asset.last_price_krw || 0) * (asset.quantity || 0);
    if (value <= 0) {
      return;
    }
    const type = asset.asset_type?.toLowerCase();
    if (type === "stock") {
      allocationTotals["미국주식"] += value;
      return;
    }
    if (type === "kr_stock") {
      allocationTotals["한국주식"] += value;
      return;
    }
    if (type === "crypto" && asset.symbol?.toUpperCase() === "BTC") {
      allocationTotals["비트코인"] += value;
      return;
    }
    allocationTotals["기타(직접입력)"] += value;
  });
  const totalPortfolioValue = Object.values(allocationTotals).reduce((sum, value) => sum + value, 0);
  const allocationEntries = allocationCategories.map((label) => {
    const share =
      totalPortfolioValue > 0 ? Math.round((allocationTotals[label] / totalPortfolioValue) * 1000) / 10 : 0;
    return { label, share };
  });
  allocationEntries.sort((a, b) => b.share - a.share);
  const allocationHasData = totalPortfolioValue > 0;
  const filteredAllocationEntries = allocationEntries.filter((entry) => entry.share > 0);
  const allocationLabels = filteredAllocationEntries.map((entry) => entry.label);
  const allocationShares = filteredAllocationEntries.map((entry) => entry.share);
  const allocationColors = filteredAllocationEntries.map((entry) => allocationColorMap[entry.label]);
  const allocationData = {
    labels: allocationLabels,
    datasets: [
      {
        data: allocationShares,
        backgroundColor: allocationColors,
        borderColor: "#1e293b",
        borderWidth: 2
      }
    ]
  };
  const allocationOptions = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: "60%",
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (context) => `${context.label}: ${context.parsed}%`
        }
      }
    }
  };
  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (context) => formatAxisKrw(context.parsed.y)
        }
      }
    },
    scales: {
      x: {
        ticks: {
          color: "#94a3b8",
          maxTicksLimit: 6
        },
        grid: {
          display: false
        }
      },
      y: {
        ticks: {
          color: "#94a3b8",
          callback: (value) => formatAxisKrw(value)
        },
        grid: {
          color: "rgba(148, 163, 184, 0.15)"
        }
      }
    }
  };
  const getCardPeriods = (key) =>
    isMobile && !cardHistoryOpen[key] ? periodTotals.slice(0, 1) : periodTotals.slice(0, 7);

  return (
    <>
      <nav className="navbar">
        <span className="navbar-title">흙창고 현황</span>
        <div className="navbar-actions">
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
        <section className="summary-card">
          {summaryLoading ? (
            <div className="loading-state">
              <span className="spinner large" />
              <p className="muted">잔액을 불러오는 중...</p>
            </div>
          ) : (
            <>
              <div className="summary-total">
                <p className="label">총 자산</p>
                <div className="summary-total-row">
                  <h2>{formatKRW(summary.total_krw)}</h2>
                  <button
                    className="icon-btn refresh-btn"
                    onClick={handleManualRefresh}
                    disabled={refreshing}
                    title="가격 새로고침"
                    type="button"
                  >
                    <i className={`fa-solid fa-arrows-rotate${refreshing ? " spinning" : ""}`} />
                  </button>
                </div>
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
            </>
          )}
        </section>

      {error ? (
        <section className="error-banner">
          <p className="error">{error}</p>
        </section>
      ) : null}

      {success ? <p className="success">{success}</p> : null}

      <section className="chart-card combined-charts">
        <div className="charts-grid">
          <div className="chart-section">
            <div className="chart-header">
              <div>
                <p className="label">{periodLabels[period]} Total</p>
                <h3>내 자산 변화 추이</h3>
              </div>
              <div className="chart-controls">
                <select
                  className="chart-select"
                  value={period}
                  onChange={(event) => setPeriod(event.target.value)}
                >
                  <option value="daily">일간</option>
                  <option value="weekly">주간</option>
                  <option value="monthly">월간</option>
                </select>
                <button
                  className="ghost small"
                  onClick={onSnapshot}
                  disabled={snapshotLoading}
                  type="button"
                >
                  {snapshotLoading ? "저장 중..." : "스냅샷"}
                </button>
                <span className="chart-tag">{periodLabels[period]}</span>
              </div>
            </div>
            <div className="chart-canvas">
              {chartValues.length ? (
                <Line data={chartData} options={chartOptions} />
              ) : (
                <p className="muted">데이터가 없습니다.</p>
              )}
            </div>
            <div className="chart-footer">
              {periodHasMore ? (
                <button
                  className="ghost small"
                  onClick={() => loadTotals(periodOffset, true, period)}
                  disabled={periodLoading}
                >
                  {periodLoading ? "불러오는 중..." : "더보기"}
                </button>
              ) : null}
            </div>
          </div>

          <div className="chart-section pie-section">
            <div className="chart-header">
              <div>
                <p className="label">Portfolio Mix</p>
                <h3>자산 비중</h3>
              </div>
            </div>
            <div className="pie-chart-container">
              <div className="pie-chart-wrapper">
                {allocationHasData ? (
                  <Doughnut data={allocationData} options={allocationOptions} />
                ) : (
                  <p className="muted">데이터가 없습니다.</p>
                )}
              </div>
              {allocationHasData && (
                <ul className="pie-legend">
                  {filteredAllocationEntries.map((entry) => (
                    <li key={entry.label} className="pie-legend-item">
                      <span
                        className="pie-legend-color"
                        style={{ backgroundColor: allocationColorMap[entry.label] }}
                      />
                      <span className="pie-legend-label">{entry.label}</span>
                      <span className="pie-legend-value">{entry.share}%</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>자산 변화</h3>
            <p className="subtext">
              자산 추가 및 수정이 반영되지 않았으면 스냅샷 버튼을 클릭하세요.
              {periodTotals.length > 0 && (
                <span className="last-snapshot-time"> (최근 스냅샷: {periodTotals[0].period_start})</span>
              )}
            </p>
          </div>
          <input
            type="text"
            placeholder="자산 검색 (이름, 심볼)"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="asset-search-input"
          />
        </div>
        {periodTotals.length ? (
          <>
            <div className="table-wrapper">
              <table className="asset-table">
                <thead>
                  <tr>
                    <th className="asset-name-col">종목</th>
                    <th>수량</th>
                    <th>현재가(USD)</th>
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
                          min="1"
                          step="1"
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
                            onChange={(e) => setNewAssetForm((prev) => ({ ...prev, symbol: e.target.value }))}
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
                          <Check size={16} />
                        </button>
                        <button
                          className="icon-btn small"
                          type="button"
                          onClick={() => {
                            setAddingNew(false);
                            setNewAssetForm({ name: "", symbol: "", asset_type: "stock", quantity: 1, custom_type: "", price_krw: "" });
                          }}
                          title="취소"
                        >
                          <X size={16} />
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
                            <input
                              type="text"
                              className="asset-edit-input"
                              value={editForm.name}
                              onChange={(e) => setEditForm((prev) => ({ ...prev, name: e.target.value }))}
                            />
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
                              min="1"
                              step="1"
                              value={editForm.quantity}
                              onChange={(e) => setEditForm((prev) => ({ ...prev, quantity: e.target.value }))}
                            />
                          ) : (
                            formatQuantity(meta?.quantity)
                          )}
                        </td>
                        <td>
                          {meta?.last_price_usd
                            ? formatUSD(meta?.last_price_usd)
                            : "-"}
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
                                <Check size={16} />
                              </button>
                              <button
                                className="icon-btn small"
                                type="button"
                                onClick={cancelEdit}
                                title="취소"
                              >
                                <X size={16} />
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
                                <Pencil size={16} />
                              </button>
                              <button
                                className="icon-btn small"
                                type="button"
                                onClick={() => handleDelete(asset.id, asset.name)}
                                title="삭제"
                              >
                                <Trash2 size={16} />
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
                          onChange={(e) => setNewAssetForm((prev) => ({ ...prev, symbol: e.target.value }))}
                        />
                      </label>
                    )}
                    <label>
                      수량
                      <input
                        type="number"
                        min="1"
                        step="1"
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
                        onClick={() => {
                          setAddingNew(false);
                          setNewAssetForm({ name: "", symbol: "", asset_type: "stock", quantity: 1, custom_type: "", price_krw: "" });
                        }}
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
                              style={{ marginBottom: "0.5rem" }}
                            />
                            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                              <span className="muted">수량:</span>
                              <input
                                type="number"
                                className="asset-edit-input"
                                style={{ width: "80px" }}
                                min="1"
                                step="1"
                                value={editForm.quantity}
                                onChange={(e) => setEditForm((prev) => ({ ...prev, quantity: e.target.value }))}
                              />
                            </div>
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
                              {meta.last_price_usd ? formatUSD(meta.last_price_usd) : "USD -"}
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
                              <Check size={16} />
                            </button>
                            <button
                              className="icon-btn small"
                              type="button"
                              onClick={cancelEdit}
                              title="취소"
                            >
                              <X size={16} />
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
                              <Pencil size={16} />
                            </button>
                            <button
                              className="icon-btn small"
                              type="button"
                              onClick={() => handleDelete(asset.id, asset.name)}
                              title="삭제"
                            >
                              <Trash2 size={16} />
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
          </>
        ) : (
          <p className="muted">데이터가 없습니다.</p>
        )}
      </section>
      </div>
    </>
  );
};

export default Dashboard;
