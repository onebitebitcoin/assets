import { Route, Routes, Navigate } from "react-router-dom";
import Login from "./pages/Login.jsx";
import Signup from "./pages/Signup.jsx";
import Settings from "./pages/Settings.jsx";
import DashboardLayout from "./pages/DashboardLayout.jsx";
import DashboardOverview from "./pages/DashboardOverview.jsx";
import USStocksPage from "./pages/USStocksPage.jsx";
import KRStocksPage from "./pages/KRStocksPage.jsx";
import CryptoPage from "./pages/CryptoPage.jsx";
import CustomAssetsPage from "./pages/CustomAssetsPage.jsx";
import { getToken } from "./api.js";

const RequireAuth = ({ children }) => {
  const token = getToken();
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return children;
};

const App = () => (
  <Routes>
    <Route path="/" element={<Navigate to="/dashboard" replace />} />
    <Route path="/login" element={<Login />} />
    <Route path="/signup" element={<Signup />} />
    <Route
      path="/dashboard"
      element={
        <RequireAuth>
          <DashboardLayout />
        </RequireAuth>
      }
    >
      <Route index element={<DashboardOverview />} />
      <Route path="us-stocks" element={<USStocksPage />} />
      <Route path="kr-stocks" element={<KRStocksPage />} />
      <Route path="crypto" element={<CryptoPage />} />
      <Route path="custom" element={<CustomAssetsPage />} />
    </Route>
    <Route
      path="/settings"
      element={
        <RequireAuth>
          <Settings />
        </RequireAuth>
      }
    />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>
);

export default App;
