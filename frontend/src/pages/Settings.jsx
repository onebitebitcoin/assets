import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { clearToken, listAssets } from "../api.js";
import { formatKRW, formatUSD } from "../utils/format.js";

const Settings = () => {
  const navigate = useNavigate();
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadAssets = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await listAssets();
      const sorted = [...data].sort((a, b) => {
        const aValue = (a.last_price_krw || 0) * a.quantity;
        const bValue = (b.last_price_krw || 0) * b.quantity;
        if (bValue !== aValue) return bValue - aValue;
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

  const onLogout = () => {
    if (window.confirm("로그아웃 하시겠습니까?")) {
      clearToken();
      navigate("/login");
    }
  };

  const formatUpdatedAt = (value) => {
    if (!value) return "-";
    const raw = typeof value === "string" ? value : value.toString();
    const hasTimezone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(raw);
    // 타임존 정보가 없으면 한국 시간(+09:00)으로 해석
    const date = new Date(hasTimezone ? raw : `${raw}+09:00`);
    if (Number.isNaN(date.getTime())) return "-";
    return new Intl.DateTimeFormat("ko-KR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZone: "Asia/Seoul"
    }).format(date);
  };

  const getAssetTypeName = (type) => {
    const typeMap = {
      stock: "미국주식",
      kr_stock: "국내주식",
      crypto: "비트코인",
      cash: "현금"
    };
    return typeMap[type?.toLowerCase()] || type || "직접입력";
  };

  const lastUpdatedTimes = assets
    .map((a) => a.last_updated)
    .filter(Boolean)
    .map((t) => new Date(t).getTime())
    .filter((t) => !Number.isNaN(t));
  const latestUpdate = lastUpdatedTimes.length
    ? new Date(Math.max(...lastUpdatedTimes))
    : null;

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
            onClick={() => navigate("/edit-assets")}
            title="자산 관리"
            type="button"
          >
            <i className="fa-solid fa-pen-to-square" />
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
        {error && <p className="error">{error}</p>}

        <section className="panel">
          <div className="panel-header">
            <div>
              <h3>DB 저장 가격 현황</h3>
              <p className="subtext">
                {latestUpdate
                  ? `마지막 업데이트: ${formatUpdatedAt(latestUpdate)}`
                  : "아직 가격이 갱신되지 않았습니다"}
              </p>
            </div>
          </div>

          {loading ? (
            <p className="muted">불러오는 중...</p>
          ) : assets.length ? (
            <>
              <div className="table-wrapper">
                <table className="asset-table settings-price-table">
                  <thead>
                    <tr>
                      <th>종목</th>
                      <th>유형</th>
                      <th>수량</th>
                      <th>단가(USD)</th>
                      <th>단가(KRW)</th>
                      <th>총액(KRW)</th>
                      <th>업데이트</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assets.map((asset) => (
                      <tr key={asset.id}>
                        <td>
                          {asset.name}{" "}
                          <span className="muted">({asset.symbol})</span>
                        </td>
                        <td>{getAssetTypeName(asset.asset_type)}</td>
                        <td>
                          {new Intl.NumberFormat("ko-KR", {
                            maximumFractionDigits: 2
                          }).format(asset.quantity)}
                        </td>
                        <td>{asset.last_price_usd ? formatUSD(asset.last_price_usd) : "-"}</td>
                        <td>{asset.last_price_krw ? formatKRW(asset.last_price_krw) : "-"}</td>
                        <td>
                          {asset.last_price_krw
                            ? formatKRW(asset.last_price_krw * asset.quantity)
                            : "-"}
                        </td>
                        <td className="update-time">{formatUpdatedAt(asset.last_updated)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="settings-price-cards">
                {assets.map((asset) => (
                  <article key={asset.id} className="settings-price-card">
                    <div className="settings-price-card-header">
                      <h4>
                        {asset.name} <span className="muted">({asset.symbol})</span>
                      </h4>
                      <span className="settings-price-card-type">
                        {getAssetTypeName(asset.asset_type)}
                      </span>
                    </div>
                    <div className="settings-price-card-body">
                      <div className="settings-price-row">
                        <span className="label">수량</span>
                        <span>
                          {new Intl.NumberFormat("ko-KR", {
                            maximumFractionDigits: 2
                          }).format(asset.quantity)}
                        </span>
                      </div>
                      <div className="settings-price-row">
                        <span className="label">단가(USD)</span>
                        <span>{asset.last_price_usd ? formatUSD(asset.last_price_usd) : "-"}</span>
                      </div>
                      <div className="settings-price-row">
                        <span className="label">단가(KRW)</span>
                        <span>{asset.last_price_krw ? formatKRW(asset.last_price_krw) : "-"}</span>
                      </div>
                      <div className="settings-price-row total">
                        <span className="label">총액</span>
                        <span>
                          {asset.last_price_krw
                            ? formatKRW(asset.last_price_krw * asset.quantity)
                            : "-"}
                        </span>
                      </div>
                    </div>
                    <div className="settings-price-card-footer">
                      <span className="muted">{formatUpdatedAt(asset.last_updated)}</span>
                    </div>
                  </article>
                ))}
              </div>
            </>
          ) : (
            <p className="muted">등록된 자산이 없습니다.</p>
          )}
        </section>
      </div>
    </>
  );
};

export default Settings;
