import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { register, setToken } from "../api.js";

const Signup = () => {
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
      const data = await register(form);
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
          <h1>회원가입</h1>
          <p className="subtext">사용자 이름과 비밀번호만으로 시작합니다.</p>
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
            {loading ? "생성 중..." : "계정 만들기"}
          </button>
        </form>
        <p className="meta">
          이미 계정이 있나요? <Link to="/login">로그인</Link>
        </p>
      </div>
      <div className="auth-visual">
        <div className="orb" />
        <div className="orb secondary" />
      </div>
    </div>
  );
};

export default Signup;
