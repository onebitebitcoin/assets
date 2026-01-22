import { useEffect } from "react";
import { Outlet, useOutletContext } from "react-router-dom";
import Navbar from "../components/Navbar.jsx";
import AssetTypeNav from "../components/AssetTypeNav.jsx";
import useAssets from "../hooks/useAssets.js";
import useTotals from "../hooks/useTotals.js";
import useMobile from "../hooks/useMobile.js";

const DashboardLayout = () => {
  const isMobile = useMobile();
  const assets = useAssets();
  const totals = useTotals((data) => assets.setSummary(data));

  useEffect(() => {
    const loadInitialData = async () => {
      await Promise.all([
        assets.loadSummary(),
        totals.loadTotals(0, false, totals.period)
      ]);
      totals.markInitialLoadDone();
    };
    loadInitialData();
  }, []);

  const combinedError = assets.error || totals.error;
  const combinedSuccess = assets.success || totals.success;

  return (
    <>
      <Navbar />
      <AssetTypeNav />
      <div className="dashboard">
        {combinedError ? (
          <section className="error-banner">
            <p className="error">{combinedError}</p>
          </section>
        ) : null}
        {combinedSuccess ? <p className="success">{combinedSuccess}</p> : null}
        <Outlet context={{ assets, totals, isMobile }} />
      </div>
    </>
  );
};

export const useDashboardContext = () => useOutletContext();

export default DashboardLayout;
