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

const AssetLineChart = ({
  period,
  periodTotals,
  periodHasMore,
  periodLoading,
  snapshotLoading,
  onPeriodChange,
  onSnapshot,
  onLoadMore
}) => {
  const chartSeries = [...periodTotals].reverse();
  const chartValues = chartSeries.map((item) => item.total_krw || 0);
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
