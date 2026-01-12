export const formatKRW = (value) => {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "-";
  }
  return new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency: "KRW",
    maximumFractionDigits: 0
  }).format(value);
};

export const formatUSD = (value) => {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "-";
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  }).format(value);
};

export const formatDelta = (value) => {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "-";
  }
  const sign = value >= 0 ? "+" : "-";
  return `${sign}${formatKRW(Math.abs(value))}`;
};
