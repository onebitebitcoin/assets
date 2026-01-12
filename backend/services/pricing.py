from __future__ import annotations

import asyncio
import logging
from datetime import date, timedelta
from dataclasses import dataclass
from time import time
from typing import Optional

import httpx

logger = logging.getLogger(__name__)
_CACHE_TTL_SECONDS = 60
_cache: dict[str, tuple[float, float]] = {}


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


async def fetch_stock_usd_price(symbol: str, client: httpx.AsyncClient) -> float:
    cached = _get_cached(f"stock:{symbol}")
    if cached is not None:
        return cached
    url = "https://stooq.com/q/l/"
    stooq_symbol = f"{symbol.lower()}.us"
    params = {"s": stooq_symbol, "f": "sd2t2ohlcv", "h": "", "e": "csv"}
    response = await client.get(url, params=params, timeout=10)
    response.raise_for_status()
    text = response.text.strip()
    lines = text.splitlines()
    if len(lines) < 2:
        raise ValueError(f"No price data for {symbol}")
    headers = [h.strip().lower() for h in lines[0].split(",")]
    values = [v.strip() for v in lines[1].split(",")]
    if len(headers) != len(values):
        raise ValueError(f"Invalid price data for {symbol}")
    data = dict(zip(headers, values))
    close_value = data.get("close")
    if not close_value or close_value == "N/D":
        raise ValueError(f"No price data for {symbol}")
    price = float(close_value)
    _set_cache(f"stock:{symbol}", price)
    return price


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
                    source="stooq+exchangerate",
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


def _get_cached(key: str, allow_stale: bool = False) -> Optional[float]:
    entry = _cache.get(key)
    if not entry:
        return None
    timestamp, value = entry
    if allow_stale or (time() - timestamp) < _CACHE_TTL_SECONDS:
        return value
    return None


def _set_cache(key: str, value: float) -> None:
    _cache[key] = (time(), value)
