import { NavLink } from "react-router-dom";

const tabs = [
  { path: "/dashboard", label: "전체", exact: true },
  { path: "/dashboard/us-stocks", label: "미국주식" },
  { path: "/dashboard/kr-stocks", label: "한국주식" },
  { path: "/dashboard/crypto", label: "비트코인" },
  { path: "/dashboard/custom", label: "기타" }
];

const AssetTypeNav = () => {
  return (
    <nav className="asset-type-nav">
      {tabs.map((tab) => (
        <NavLink
          key={tab.path}
          to={tab.path}
          end={tab.exact}
          className={({ isActive }) =>
            `asset-type-tab ${isActive ? "active" : ""}`
          }
        >
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
};

export default AssetTypeNav;
