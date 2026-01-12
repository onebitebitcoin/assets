import { useEffect, useState } from "react";
import {
  Chart as ChartJS,
  BarElement,
  CategoryScale,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip
} from "chart.js";
import { Bar, Line } from "react-chartjs-2";
import { useNavigate } from "react-router-dom";
import {
  clearToken,
  fetchTotalsDetail,
  refreshSummary,
  snapshotTotals
} from "../api.js";
import { formatDelta, formatKRW, formatUSD } from "../utils/format.js";

ChartJS.register(
  BarElement,
  CategoryScale,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip
);

const Dashboard = () => {
  const navigate = useNavigate();
  const [summary, setSummary] = useState({ total_krw: 0, daily_change_krw: 0, assets: [] });
  const [error, setError] = useState("");
  const [period, setPeriod] = useState("daily");
  const [periodTotals, setPeriodTotals] = useState([]);
  const [tableColumns, setTableColumns] = useState([]);
  const [periodOffset, setPeriodOffset] = useState(0);
  const [periodHasMore, setPeriodHasMore] = useState(false);
  const [periodLoading, setPeriodLoading] = useState(false);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [cardHistoryOpen, setCardHistoryOpen] = useState({});
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }
    return window.matchMedia("(max-width: 640px)").matches;
  });

  const loadSummary = async () => {
    try {
      const data = await refreshSummary();
      setSummary(data);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    loadSummary();
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
    clearToken();
    navigate("/login");
  };

  const onEditAssets = () => {
    navigate("/edit-assets");
  };

  const loadTotals = async (offset = 0, append = false, nextPeriod = period) => {
    setPeriodLoading(true);
    try {
      const data = await fetchTotalsDetail(nextPeriod, 10, offset);
      setPeriodTotals((prev) => (append ? [...prev, ...data.points] : data.points));
      setTableColumns(data.assets || []);
      setPeriodOffset(offset + data.points.length);
      setPeriodHasMore(data.points.length === 10);
    } catch (err) {
      setError(err.message);
    } finally {
      setPeriodLoading(false);
    }
  };

  useEffect(() => {
    loadTotals(0, false, period);
  }, [period]);

  useEffect(() => {
    setCardHistoryOpen({});
  }, [period]);

  const onSnapshot = async () => {
    setSnapshotLoading(true);
    setError("");
    try {
      await snapshotTotals();
      await loadTotals(0, false, period);
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
  const allocationLabels = allocationEntries.map((entry) => `${entry.label} (${entry.share}%)`);
  const allocationShares = allocationEntries.map((entry) => entry.share);
  const allocationColors = allocationEntries.map((entry) => allocationColorMap[entry.label]);
  const allocationData = {
    labels: allocationLabels,
    datasets: [
      {
        label: "비중(%)",
        data: allocationShares,
        backgroundColor: allocationColors,
        borderRadius: 8,
        borderSkipped: false
      }
    ]
  };
  const allocationOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (context) => `${context.parsed.y}%`
        }
      }
    },
    indexAxis: "y",
    scales: {
      x: {
        ticks: {
          color: "#94a3b8",
          callback: (value) => `${value}%`
        },
        grid: {
          color: "rgba(148, 163, 184, 0.1)"
        },
        suggestedMax: 100
      },
      y: {
        ticks: {
          color: "#cbd5f5"
        },
        grid: {
          display: false
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
    isMobile && !cardHistoryOpen[key] ? periodTotals.slice(0, 1) : periodTotals.slice(0, 10);

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">My Daily Assets</p>
          <h1>내 자산</h1>
          <p className="subtext">총 자산과 하루 변화량을 원화로 확인합니다.</p>
        </div>
        <div className="header-actions">
          <button className="ghost" onClick={onEditAssets}>
            자산 추가
          </button>
          <button className="ghost" onClick={onLogout}>
            로그아웃
          </button>
        </div>
      </header>

      <section className="summary-card">
        <div>
          <p className="label">총 자산</p>
          <h2>{formatKRW(summary.total_krw)}</h2>
        </div>
        <div>
          <p className="label">오늘 변화량</p>
          <h3 className={summary.daily_change_krw >= 0 ? "delta up" : "delta down"}>
            {formatDelta(summary.daily_change_krw)}
          </h3>
        </div>
      </section>

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
            <div className="chart-canvas pie-canvas">
              {allocationHasData ? (
                <Bar data={allocationData} options={allocationOptions} />
              ) : (
                <p className="muted">데이터가 없습니다.</p>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>자산 변화</h3>
            <p className="subtext">자산 추가 및 수정이 반영되지 않았으면 스냅샷 버튼을 클릭하세요.</p>
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
                    {periodTotals.map((row, index) => (
                      <th key={`${row.period_start}-${index}`}>{formatAxisDate(row.period_start)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="asset-name-col">총 자산</td>
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
                  {filteredTableColumns.map((asset) => (
                    <tr key={asset.id}>
                      <td className="asset-name-col">
                        {asset.name} <span className="muted">({asset.symbol})</span>
                      </td>
                      <td>{formatQuantity(assetMetaById.get(asset.id)?.quantity)}</td>
                      <td>
                        {assetMetaById.get(asset.id)?.last_price_usd
                          ? formatUSD(assetMetaById.get(asset.id)?.last_price_usd)
                          : "-"}
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
                  ))}
                </tbody>
              </table>
            </div>
            <div className="asset-table-cards">
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
                return (
                  <article key={`card-${asset.id}`} className="asset-change-card">
                    <div className="asset-change-header">
                      <div>
                        <h4>
                          {asset.name} <span className="muted">({asset.symbol})</span>
                        </h4>
                        <p className="asset-change-meta">
                          보유 {formatQuantity(meta.quantity)} ·{" "}
                          {meta.last_price_usd ? formatUSD(meta.last_price_usd) : "USD -"}
                        </p>
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

      {error ? <p className="error">{error}</p> : null}
    </div>
  );
};

export default Dashboard;
