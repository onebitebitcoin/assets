from __future__ import annotations

import asyncio
import logging
from datetime import date, timedelta
from dataclasses import dataclass
from time import time
from typing import Optional

import httpx

from backend.config import settings

logger = logging.getLogger(__name__)

FINNHUB_BASE_URL = "https://finnhub.io/api/v1"

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


async def _fetch_from_finnhub(symbol: str, client: httpx.AsyncClient) -> float:
    """Finnhub API에서 미국주식 가격 조회 (실시간)"""
    if not settings.finnhub_api_key:
        raise ValueError("FINNHUB_API_KEY is not configured")

    url = f"{FINNHUB_BASE_URL}/quote"
    params = {"symbol": symbol, "token": settings.finnhub_api_key}
    logger.debug("Fetching stock price from Finnhub: %s", symbol)

    response = await client.get(url, params=params, timeout=10)
    response.raise_for_status()
    data = response.json()

    # c=0이면 데이터 없음 (시장 마감 또는 잘못된 심볼)
    price = data.get("c", 0)
    if price == 0:
        logger.warning("Finnhub returned no data for %s (c=0)", symbol)
        raise ValueError(f"No price data for {symbol} from Finnhub")

    price = float(price)
    logger.debug("Finnhub price for %s: %.2f USD", symbol, price)
    return price


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


async def _fetch_stocks_from_finnhub_batch(
    symbols: list[str], client: httpx.AsyncClient
) -> dict[str, tuple[float, str]]:
    """Finnhub API에서 여러 종목을 병렬로 조회 (Finnhub은 배치 API 미지원)

    Args:
        symbols: 주식 심볼 리스트
        client: httpx.AsyncClient

    Returns:
        {symbol: (price, source)} 딕셔너리. 실패한 종목은 포함되지 않음.
    """
    results: dict[str, tuple[float, str]] = {}

    async def fetch_single(symbol: str) -> tuple[str, float | None]:
        try:
            price = await _fetch_from_finnhub(symbol, client)
            return (symbol, price)
        except Exception as exc:
            logger.debug("Finnhub failed for %s: %s", symbol, exc)
            return (symbol, None)

    tasks = [fetch_single(symbol) for symbol in symbols]
    responses = await asyncio.gather(*tasks)

    for symbol, price in responses:
        if price is not None:
            results[symbol] = (price, "finnhub")
            _set_cache(f"stock:{symbol}", price)
            logger.debug("Finnhub price for %s: %.2f USD", symbol, price)

    return results


async def _fetch_stocks_from_yahoo_batch(
    symbols: list[str], client: httpx.AsyncClient
) -> dict[str, tuple[float, str]]:
    """Yahoo Finance API에서 여러 미국주식 가격을 한 번에 조회 (v7 quote API)"""
    if not symbols:
        return {}

    url = "https://query1.finance.yahoo.com/v7/finance/quote"
    params = {"symbols": ",".join(symbols)}
    logger.debug("Fetching stock prices from Yahoo Finance batch API: %s", symbols)

    results: dict[str, tuple[float, str]] = {}

    try:
        response = await client.get(url, params=params, timeout=15)
        response.raise_for_status()
        data = response.json()

        quote_response = data.get("quoteResponse", {})
        quotes = quote_response.get("result", [])

        for quote in quotes:
            symbol = quote.get("symbol")
            price = quote.get("regularMarketPrice")
            if symbol and price is not None:
                results[symbol] = (float(price), "yahoo")
                _set_cache(f"stock:{symbol}", float(price))
                logger.debug("Yahoo Finance batch price for %s: %.2f USD", symbol, price)

    except Exception as exc:
        logger.warning("Yahoo Finance batch API failed: %s", exc)

    return results


async def fetch_stocks_usd_prices_batch(
    symbols: list[str], client: httpx.AsyncClient
) -> dict[str, tuple[float, str]]:
    """여러 미국주식 가격을 조회 (Finnhub 1차 -> Yahoo 2차 fallback)

    Args:
        symbols: 주식 심볼 리스트 (예: ["AAPL", "MSFT", "TSLA"])
        client: httpx.AsyncClient

    Returns:
        {symbol: (price, source)} 딕셔너리. 실패한 종목은 포함되지 않음.
    """
    if not symbols:
        return {}

    results: dict[str, tuple[float, str]] = {}

    # 1차: Finnhub API (병렬 조회)
    if settings.finnhub_api_key:
        logger.debug("Fetching stock prices from Finnhub: %s", symbols)
        finnhub_results = await _fetch_stocks_from_finnhub_batch(symbols, client)
        results.update(finnhub_results)

        # Finnhub 성공한 종목 로깅
        if finnhub_results:
            logger.info("Finnhub batch success: %s", list(finnhub_results.keys()))
    else:
        logger.debug("Finnhub API key not configured, skipping Finnhub")

    # 2차: Yahoo Finance fallback (Finnhub 실패 종목)
    failed_symbols = list(set(symbols) - set(results.keys()))
    if failed_symbols:
        logger.debug("Falling back to Yahoo Finance for: %s", failed_symbols)
        yahoo_results = await _fetch_stocks_from_yahoo_batch(failed_symbols, client)
        results.update(yahoo_results)

        if yahoo_results:
            logger.info("Yahoo Finance fallback success: %s", list(yahoo_results.keys()))

    # 최종 실패 종목 로깅
    final_failed = set(symbols) - set(results.keys())
    if final_failed:
        logger.warning("Batch API missing symbols after all sources: %s", final_failed)

    return results


async def fetch_stock_usd_price(symbol: str, client: httpx.AsyncClient) -> tuple[float, str]:
    """미국주식 USD 가격 조회 (Finnhub 1차, Yahoo 2차, Stooq 3차)

    Returns:
        (price, source) 튜플. source는 "finnhub", "yahoo", "stooq", "cache" 중 하나.
    """
    # 1차: Finnhub API (실시간 가격)
    if settings.finnhub_api_key:
        try:
            price = await _fetch_from_finnhub(symbol, client)
            _set_cache(f"stock:{symbol}", price)
            return price, "finnhub"
        except Exception as exc:
            logger.warning("Finnhub failed for %s: %s, trying Yahoo", symbol, exc)
    else:
        logger.debug("Finnhub API key not configured, skipping Finnhub")

    # 2차: Yahoo Finance API (fallback)
    try:
        price = await _fetch_from_yahoo(symbol, client)
        _set_cache(f"stock:{symbol}", price)
        return price, "yahoo"
    except Exception as exc:
        logger.warning("Yahoo Finance failed for %s: %s, trying Stooq", symbol, exc)

    # 3차: Stooq API (fallback, 종가)
    try:
        price = await _fetch_from_stooq(symbol, client)
        _set_cache(f"stock:{symbol}", price)
        return price, "stooq"
    except Exception as exc:
        logger.error("All sources failed for %s: %s", symbol, exc)
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
                usd_price, price_source = await fetch_stock_usd_price(symbol, client)
                rate = await fetch_usd_krw_rate(client)
                return PriceResult(
                    price_krw=usd_price * rate,
                    source=price_source,
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
    미국 주식(stock)은 Yahoo Finance 배치 API로 한 번에 조회합니다.

    Args:
        assets: [(symbol, asset_type), ...] 형태의 리스트

    Returns:
        {symbol: PriceResult} 형태의 딕셔너리. 실패한 경우 해당 키 없음.
    """
    results: dict[str, PriceResult] = {}

    # 미국 주식과 기타 자산 분리
    us_stock_symbols: list[str] = []
    other_assets: list[tuple[str, str]] = []

    for symbol, asset_type in assets:
        if asset_type == "stock":
            us_stock_symbols.append(symbol)
        else:
            other_assets.append((symbol, asset_type))

    async with httpx.AsyncClient() as client:
        # 1. 미국 주식: Yahoo Finance 배치 API로 한 번에 조회
        if us_stock_symbols:
            batch_prices = await fetch_stocks_usd_prices_batch(us_stock_symbols, client)

            # 배치 API 실패한 종목은 Stooq fallback 시도
            failed_symbols = set(us_stock_symbols) - set(batch_prices.keys())

            # 환율 조회 (미국 주식이 있으면 필요)
            rate = await fetch_usd_krw_rate(client)

            # 배치 성공한 종목 결과 저장
            for symbol, (usd_price, source) in batch_prices.items():
                results[symbol] = PriceResult(
                    price_krw=usd_price * rate,
                    source=source,
                    price_usd=usd_price,
                )

            # 배치 실패한 종목은 Stooq fallback
            for symbol in failed_symbols:
                try:
                    price = await _fetch_from_stooq(symbol, client)
                    _set_cache(f"stock:{symbol}", price)
                    results[symbol] = PriceResult(
                        price_krw=price * rate,
                        source="stooq",
                        price_usd=price,
                    )
                except Exception as exc:
                    logger.warning("Stooq fallback also failed for %s: %s", symbol, exc)

        # 2. 기타 자산 (한국주식, 암호화폐 등): 개별 조회
        async def fetch_single(symbol: str, asset_type: str) -> tuple[str, PriceResult | None]:
            try:
                result = await get_price_krw(symbol, asset_type)
                return (symbol, result)
            except Exception as exc:
                logger.warning("Price fetch failed for %s: %s", symbol, exc)
                return (symbol, None)

        if other_assets:
            tasks = [fetch_single(symbol, asset_type) for symbol, asset_type in other_assets]
            other_results = await asyncio.gather(*tasks)
            for symbol, result in other_results:
                if result is not None:
                    results[symbol] = result

    return results
