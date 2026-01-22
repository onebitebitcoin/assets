import {
  Chart as ChartJS,
  ArcElement,
  Legend,
  Tooltip
} from "chart.js";
import { Doughnut } from "react-chartjs-2";
import { formatKRW } from "../utils/format.js";

ChartJS.register(ArcElement, Legend, Tooltip);

const allocationCategories = ["미국주식", "한국주식", "비트코인", "기타(직접입력)"];
const allocationColorMap = {
  미국주식: "#60a5fa",
  한국주식: "#f97316",
  비트코인: "#fbbf24",
  "기타(직접입력)": "#94a3b8"
};

const AllocationDonut = ({ assets }) => {
  const allocationTotals = allocationCategories.reduce(
    (acc, label) => ({ ...acc, [label]: 0 }),
    {}
  );

  assets.forEach((asset) => {
    const value = (asset.last_price_krw || 0) * (asset.quantity || 0);
    if (value <= 0) return;

    const type = asset.asset_type?.toLowerCase();
    if (type === "stock") {
      allocationTotals["미국주식"] += value;
    } else if (type === "kr_stock") {
      allocationTotals["한국주식"] += value;
    } else if (type === "crypto" && asset.symbol?.toUpperCase() === "BTC") {
      allocationTotals["비트코인"] += value;
    } else {
      allocationTotals["기타(직접입력)"] += value;
    }
  });

  const totalPortfolioValue = Object.values(allocationTotals).reduce((sum, value) => sum + value, 0);
  const allocationEntries = allocationCategories.map((label) => {
    const amount = allocationTotals[label];
    const share =
      totalPortfolioValue > 0 ? Math.round((amount / totalPortfolioValue) * 1000) / 10 : 0;
    return { label, share, amount };
  });
  allocationEntries.sort((a, b) => b.share - a.share);

  const allocationHasData = totalPortfolioValue > 0;
  const filteredAllocationEntries = allocationEntries.filter((entry) => entry.share > 0);
  const allocationLabels = filteredAllocationEntries.map((entry) => entry.label);
  const allocationShares = filteredAllocationEntries.map((entry) => entry.share);
  const allocationAmounts = filteredAllocationEntries.map((entry) => entry.amount);
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
          label: (context) => {
            const amount = allocationAmounts[context.dataIndex];
            return `${context.label}: ${context.parsed}% (${formatKRW(amount)})`;
          }
        }
      }
    }
  };

  return (
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
  );
};

export default AllocationDonut;
