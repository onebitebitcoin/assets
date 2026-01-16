import { Route, Routes, Navigate } from "react-router-dom";
import Login from "./pages/Login.jsx";
import Signup from "./pages/Signup.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import EditAssets from "./pages/EditAssets.jsx";
import Settings from "./pages/Settings.jsx";
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
          <Dashboard />
        </RequireAuth>
      }
    />
    <Route
      path="/edit-assets"
      element={
        <RequireAuth>
          <EditAssets />
        </RequireAuth>
      }
    />
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
