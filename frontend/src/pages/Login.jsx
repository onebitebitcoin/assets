import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { login, setToken } from "../api.js";

const Login = () => {
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const onChange = (event) => {
    setForm((prev) => ({ ...prev, [event.target.name]: event.target.value }));
  };

  const onSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const data = await login(form);
      setToken(data.access_token);
      navigate("/dashboard");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-header">
          <p className="eyebrow">Asset Daily</p>
          <h1>로그인</h1>
          <p className="subtext">매일 내 자산의 변화량을 확인하세요.</p>
        </div>
        <form className="auth-form" onSubmit={onSubmit}>
          <label>
            사용자 이름
            <input
              name="username"
              placeholder="username"
              value={form.username}
              onChange={onChange}
              required
            />
          </label>
          <label>
            비밀번호
            <input
              name="password"
              type="password"
              placeholder="••••••••"
              value={form.password}
              onChange={onChange}
              required
            />
          </label>
          {error ? <p className="error">{error}</p> : null}
          <button className="primary" type="submit" disabled={loading}>
            {loading ? "로그인 중..." : "로그인"}
          </button>
        </form>
        <p className="meta">
          계정이 없나요? <Link to="/signup">회원가입</Link>
        </p>
      </div>
      <div className="auth-visual">
        <div className="orb" />
        <div className="orb secondary" />
      </div>
    </div>
  );
};

export default Login;
