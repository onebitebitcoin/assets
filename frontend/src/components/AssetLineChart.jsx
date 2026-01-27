import {
  Chart as ChartJS,
  CategoryScale,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip
} from "chart.js";
import { Line } from "react-chartjs-2";

ChartJS.register(
  CategoryScale,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip
);

const periodLabels = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly"
};

const formatAxisDate = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("ko-KR", { month: "2-digit", day: "2-digit" }).format(date);
};

const formatAxisKrw = (value) => {
  const unit = 100000000;
  const amount = value / unit;
  return `${amount.toFixed(1)}억`;
};

const categoryColors = {
  stock: { border: "#60a5fa", bg: "rgba(96, 165, 250, 0.15)" },
  kr_stock: { border: "#f97316", bg: "rgba(249, 115, 22, 0.15)" },
  crypto: { border: "#fbbf24", bg: "rgba(251, 191, 36, 0.15)" }
};

const categoryLabels = {
  stock: "미국주식",
  kr_stock: "한국주식",
  crypto: "비트코인"
};

const AssetLineChart = ({
  period,
  periodTotals,
  periodHasMore,
  periodLoading,
  snapshotLoading,
  onPeriodChange,
  onSnapshot,
  onLoadMore,
  assetMetaById
}) => {
  const chartSeries = [...periodTotals].reverse();
  const chartValues = chartSeries.map((item) => item.total_krw || 0);
  const chartLabels = chartSeries.map((item) => formatAxisDate(item.period_start));

  // 카테고리별 총합 계산
  const categoryTotals = { stock: [], kr_stock: [], crypto: [] };
  for (const point of chartSeries) {
    const totals = { stock: 0, kr_stock: 0, crypto: 0 };
    if (point.assets && assetMetaById) {
      for (const asset of point.assets) {
        const meta = assetMetaById.get(asset.id);
        if (meta) {
          const type = meta.asset_type?.toLowerCase();
          if (type in totals) {
            totals[type] += asset.total_krw || 0;
          }
        }
      }
    }
    categoryTotals.stock.push(totals.stock);
    categoryTotals.kr_stock.push(totals.kr_stock);
    categoryTotals.crypto.push(totals.crypto);
  }

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

  // 카테고리별 차트 데이터
  const categoryChartData = {
    labels: chartLabels,
    datasets: Object.entries(categoryColors).map(([type, colors]) => ({
      label: categoryLabels[type],
      data: categoryTotals[type],
      borderColor: colors.border,
      backgroundColor: colors.bg,
      tension: 0.35,
      pointRadius: 3,
      pointHoverRadius: 4,
      fill: false
    }))
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

  const categoryChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: true,
        position: "top",
        labels: {
          color: "#94a3b8",
          usePointStyle: true,
          pointStyle: "circle",
          padding: 16,
          font: { size: 12 }
        }
      },
      tooltip: {
        callbacks: {
          label: (context) => `${context.dataset.label}: ${formatAxisKrw(context.parsed.y)}`
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

  const hasCategoryData = assetMetaById && chartSeries.some((point) => point.assets?.length > 0);

  return (
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
            onChange={(event) => onPeriodChange(event.target.value)}
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

      {hasCategoryData ? (
        <>
          <div className="chart-header" style={{ marginTop: "1.5rem" }}>
            <div>
              <p className="label">카테고리별</p>
              <h3>자산 유형별 변화 추이</h3>
            </div>
          </div>
          <div className="chart-canvas">
            <Line data={categoryChartData} options={categoryChartOptions} />
          </div>
        </>
      ) : null}

      <div className="chart-footer">
        {periodHasMore ? (
          <button
            className="ghost small"
            onClick={onLoadMore}
            disabled={periodLoading}
          >
            {periodLoading ? "불러오는 중..." : "더보기"}
          </button>
        ) : null}
      </div>
    </div>
  );
};

export default AssetLineChart;
