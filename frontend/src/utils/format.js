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

export const formatRelativeTime = (dateString) => {
  if (!dateString) return "";
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now - date;
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 0) {
    // 미래 시간 (다음 갱신 예정)
    const absMin = Math.abs(diffMin);
    if (absMin < 60) return `${absMin}분 후`;
    return `${Math.floor(absMin / 60)}시간 ${absMin % 60}분 후`;
  }

  if (diffMin < 1) return "방금 전";
  if (diffMin < 60) return `${diffMin}분 전`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}시간 전`;
  return `${Math.floor(diffHour / 24)}일 전`;
};
