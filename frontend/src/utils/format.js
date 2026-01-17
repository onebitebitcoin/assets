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
  const raw = typeof dateString === "string" ? dateString : dateString.toString();
  const hasTimezone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(raw);
  // 타임존 정보가 없으면 한국 시간(+09:00)으로 해석
  const date = new Date(hasTimezone ? raw : `${raw}+09:00`);
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

export const formatDateTime = (dateString) => {
  if (!dateString) return "-";
  const raw = typeof dateString === "string" ? dateString : dateString.toString();
  const hasTimezone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(raw);
  const hasTime = /T\d{2}:/.test(raw);
  let dateStr = raw;
  // 날짜만 있는 경우 (YYYY-MM-DD) 시간 추가
  if (!hasTimezone && !hasTime) {
    dateStr = `${raw}T00:00:00+09:00`;
  } else if (!hasTimezone) {
    dateStr = `${raw}+09:00`;
  }
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Seoul"
  }).format(date);
};
