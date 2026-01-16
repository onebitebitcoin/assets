from __future__ import annotations

import asyncio
import logging
from datetime import date, timedelta
from dataclasses import dataclass
from time import time
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

# 자산 유형별 캐시 TTL (초)
_CACHE_TTL_MAP = {
    "usdkrw": 0,         # 환율: 캐시 없음
    "stock": 0,          # 미국주식: 캐시 없음
    "kr_stock": 0,       # 한국주식: 캐시 없음
    "btc": 0,            # 비트코인: 캐시 없음
}
_DEFAULT_CACHE_TTL = 0

_cache: dict[str, tuple[float, float]] = {}
# SWR 백그라운드 갱신 추적
_swr_pending: set[str] = set()


@dataclass
class PriceResult:
    price_krw: float
    source: str
    price_usd: Optional[float] = None


async def fetch_usd_krw_rate(client: httpx.AsyncClient) -> float:
    cached = _get_cached("usdkrw")
    if cached is not None:
        return cached
    primary_url = "https://open.er-api.com/v6/latest/USD"
    try:
        response = await client.get(primary_url, timeout=10)
        response.raise_for_status()
        data = response.json()
        rates = data.get("rates")
        if not rates or "KRW" not in rates:
            logger.warning("Primary FX missing rates field: %s", str(data)[:200])
            raise ValueError("Missing rates from open.er-api.com")
        rate = float(rates["KRW"])
        _set_cache("usdkrw", rate)
        return rate
    except Exception as exc:
        logger.warning("Primary FX source failed: %s", exc)

    fallback_url = "https://api.frankfurter.app/latest"
    fallback_params = {"from": "USD", "to": "KRW"}
    fallback_response = await client.get(fallback_url, params=fallback_params, timeout=10)
    fallback_response.raise_for_status()
    fallback_data = fallback_response.json()
    rates = fallback_data.get("rates")
    if not rates or "KRW" not in rates:
        logger.warning("Fallback FX missing rates field: %s", str(fallback_data)[:200])
        raise ValueError("Missing rates from frankfurter.app")
    rate = float(rates["KRW"])
    _set_cache("usdkrw", rate)
    return rate


async def _fetch_from_stooq(symbol: str, client: httpx.AsyncClient) -> float:
    """Stooq API에서 미국주식 가격 조회"""
    url = "https://stooq.com/q/l/"
    stooq_symbol = f"{symbol.lower()}.us"
    params = {"s": stooq_symbol, "f": "sd2t2ohlcv", "h": "", "e": "csv"}
    logger.debug("Fetching stock price from Stooq: %s", stooq_symbol)
    response = await client.get(url, params=params, timeout=10)
    response.raise_for_status()
    text = response.text.strip()
    lines = text.splitlines()
    if len(lines) < 2:
        logger.warning("Stooq returned insufficient data for %s: %s", symbol, text[:200])
        raise ValueError(f"No price data for {symbol} from Stooq")
    headers = [h.strip().lower() for h in lines[0].split(",")]
    values = [v.strip() for v in lines[1].split(",")]
    if len(headers) != len(values):
        logger.warning("Stooq header/value mismatch for %s", symbol)
        raise ValueError(f"Invalid price data for {symbol} from Stooq")
    data = dict(zip(headers, values))
    close_value = data.get("close")
    if not close_value or close_value == "N/D":
        logger.warning("Stooq returned N/D for %s", symbol)
        raise ValueError(f"No price data for {symbol} from Stooq (N/D)")
    price = float(close_value)
    logger.debug("Stooq price for %s: %.2f USD", symbol, price)
    return price


async def _fetch_from_yahoo(symbol: str, client: httpx.AsyncClient) -> float:
    """Yahoo Finance API에서 미국주식 가격 조회 (fallback)"""
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
    logger.debug("Fetching stock price from Yahoo Finance: %s", symbol)
    response = await client.get(url, timeout=10)
    response.raise_for_status()
    data = response.json()

    chart = data.get("chart", {})
    result = chart.get("result")
    if not result or len(result) == 0:
        error = chart.get("error", {})
        error_msg = error.get("description", "Unknown error")
        logger.warning("Yahoo Finance returned no result for %s: %s", symbol, error_msg)
        raise ValueError(f"No price data for {symbol} from Yahoo Finance: {error_msg}")

    meta = result[0].get("meta", {})
    price = meta.get("regularMarketPrice")
    if price is None:
        logger.warning("Yahoo Finance missing regularMarketPrice for %s", symbol)
        raise ValueError(f"No price data for {symbol} from Yahoo Finance")

    price = float(price)
    logger.debug("Yahoo Finance price for %s: %.2f USD", symbol, price)
    return price


async def fetch_stock_usd_price(symbol: str, client: httpx.AsyncClient) -> float:
    """미국주식 USD 가격 조회 (Yahoo Finance 1차, Stooq 2차)"""
    cached = _get_cached(f"stock:{symbol}")
    if cached is not None:
        return cached

    # 1차: Yahoo Finance API (실시간 가격)
    try:
        price = await _fetch_from_yahoo(symbol, client)
        _set_cache(f"stock:{symbol}", price)
        return price
    except Exception as exc:
        logger.warning("Yahoo Finance failed for %s: %s, trying Stooq", symbol, exc)

    # 2차: Stooq API (fallback, 종가)
    try:
        price = await _fetch_from_stooq(symbol, client)
        _set_cache(f"stock:{symbol}", price)
        return price
    except Exception as exc:
        logger.error("Stooq also failed for %s: %s", symbol, exc)
        raise ValueError(f"All price sources failed for {symbol}")


async def fetch_btc_krw_price(client: httpx.AsyncClient) -> float:
    cached = _get_cached("btc")
    if cached is not None:
        return cached
    url = "https://api.upbit.com/v1/ticker"
    params = {"markets": "KRW-BTC"}
    response = await client.get(url, params=params, timeout=10)
    response.raise_for_status()
    data = response.json()
    price = float(data[0]["trade_price"])
    _set_cache("btc", price)
    return price


def _fetch_krx_close_price(symbol: str) -> float:
    from pykrx import stock

    today = date.today()
    for offset in range(0, 7):
        target_date = today - timedelta(days=offset)
        day = target_date.strftime("%Y%m%d")
        data = stock.get_market_ohlcv_by_date(day, day, symbol)
        if data is None or data.empty:
            continue
        close = data["종가"].iloc[-1]
        return float(close)
    raise ValueError(f"No price data for {symbol}")


async def fetch_kr_stock_krw_price(symbol: str) -> float:
    # Remove exchange suffix (.KS, .KQ) if present
    clean_symbol = symbol.split('.')[0]
    cached = _get_cached(f"kr_stock:{clean_symbol}")
    if cached is not None:
        return cached
    price = await asyncio.to_thread(_fetch_krx_close_price, clean_symbol)
    _set_cache(f"kr_stock:{clean_symbol}", price)
    return price


async def get_price_krw(symbol: str, asset_type: str) -> PriceResult:
    async with httpx.AsyncClient() as client:
        if asset_type == "stock":
            try:
                usd_price = await fetch_stock_usd_price(symbol, client)
                rate = await fetch_usd_krw_rate(client)
                return PriceResult(
                    price_krw=usd_price * rate,
                    source="yahoo+exchangerate",
                    price_usd=usd_price,
                )
            except (httpx.HTTPError, ValueError) as exc:
                cached = _get_cached(f"stock:{symbol}", allow_stale=True)
                cached_rate = _get_cached("usdkrw", allow_stale=True)
                if cached is not None and cached_rate is not None:
                    logger.warning("Using cached stock price for %s after error: %s", symbol, exc)
                    return PriceResult(
                        price_krw=cached * cached_rate,
                        source="cache",
                        price_usd=cached,
                    )
            raise
        if asset_type == "kr_stock":
            try:
                krw_price = await fetch_kr_stock_krw_price(symbol)
                return PriceResult(price_krw=krw_price, source="pykrx")
            except Exception as exc:
                cached = _get_cached(f"kr_stock:{symbol}", allow_stale=True)
                if cached is not None:
                    logger.warning("Using cached KR stock price for %s after error: %s", symbol, exc)
                    return PriceResult(price_krw=cached, source="cache")
                raise
        if asset_type == "crypto" and symbol.upper() == "BTC":
            try:
                btc_price = await fetch_btc_krw_price(client)
                return PriceResult(price_krw=btc_price, source="upbit")
            except (httpx.HTTPError, ValueError) as exc:
                cached = _get_cached("btc", allow_stale=True)
                if cached is not None:
                    logger.warning("Using cached BTC price after error: %s", exc)
                    return PriceResult(price_krw=cached, source="cache")
                raise

    raise ValueError("Unsupported asset type or symbol")


def _get_cache_ttl(key: str) -> int:
    """캐시 키에 해당하는 TTL 반환"""
    for prefix, ttl in _CACHE_TTL_MAP.items():
        if key == prefix or key.startswith(f"{prefix}:"):
            return ttl
    return _DEFAULT_CACHE_TTL


def _get_cached(key: str, allow_stale: bool = False) -> Optional[float]:
    entry = _cache.get(key)
    if not entry:
        return None
    timestamp, value = entry
    ttl = _get_cache_ttl(key)
    if allow_stale or (time() - timestamp) < ttl:
        return value
    return None


def _is_cache_fresh(key: str) -> bool:
    """캐시가 아직 유효한지 확인"""
    entry = _cache.get(key)
    if not entry:
        return False
    timestamp, _ = entry
    ttl = _get_cache_ttl(key)
    return (time() - timestamp) < ttl


def _set_cache(key: str, value: float) -> None:
    _cache[key] = (time(), value)


async def _refresh_cache_background(key: str, fetch_coro) -> None:
    """백그라운드에서 캐시 갱신 (SWR 패턴)"""
    if key in _swr_pending:
        return
    _swr_pending.add(key)
    try:
        await fetch_coro
    except Exception as exc:
        logger.warning("Background cache refresh failed for %s: %s", key, exc)
    finally:
        _swr_pending.discard(key)


async def get_price_krw_batch(assets: list[tuple[str, str]]) -> dict[str, PriceResult]:
    """
    여러 자산의 가격을 병렬로 조회합니다.

    Args:
        assets: [(symbol, asset_type), ...] 형태의 리스트

    Returns:
        {symbol: PriceResult} 형태의 딕셔너리. 실패한 경우 해당 키 없음.
    """
    async def fetch_single(symbol: str, asset_type: str) -> tuple[str, PriceResult | None]:
        try:
            result = await get_price_krw(symbol, asset_type)
            return (symbol, result)
        except Exception as exc:
            logger.warning("Price fetch failed for %s: %s", symbol, exc)
            return (symbol, None)

    tasks = [fetch_single(symbol, asset_type) for symbol, asset_type in assets]
    results = await asyncio.gather(*tasks)
    return {symbol: result for symbol, result in results if result is not None}
