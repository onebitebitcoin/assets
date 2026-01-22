import { useNavigate } from "react-router-dom";
import { clearToken } from "../api.js";

const Navbar = () => {
  const navigate = useNavigate();

  const onLogout = () => {
    if (window.confirm("로그아웃 하시겠습니까?")) {
      clearToken();
      navigate("/login");
    }
  };

  return (
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
  );
};

export default Navbar;
