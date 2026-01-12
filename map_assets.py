#!/usr/bin/env python3
"""
Map parsed assets to API format with quantity calculation
"""

import json
import sys
import time
from typing import Dict, Any, Optional
import httpx

from asset_mapping import get_asset_info


# Cache for API results
_cache: Dict[str, tuple[float, Any]] = {}
_CACHE_TTL = 300  # 5 minutes


def get_usd_krw_rate() -> float:
    """Get USD to KRW exchange rate"""
    cache_key = "usdkrw"
    if cache_key in _cache:
        timestamp, rate = _cache[cache_key]
        if time.time() - timestamp < _CACHE_TTL:
            print(f"Using cached USD/KRW rate: {rate:.2f}")
            return rate

    print("Fetching USD/KRW exchange rate...")
    try:
        with httpx.Client(timeout=10) as client:
            response = client.get(
                "https://api.exchangerate.host/latest",
                params={"base": "USD", "symbols": "KRW"}
            )
            response.raise_for_status()
            data = response.json()
            rate = float(data["rates"]["KRW"])
            _cache[cache_key] = (time.time(), rate)
            print(f"USD/KRW rate: {rate:.2f}")
            return rate
    except Exception as e:
        print(f"Error fetching exchange rate: {e}")
        # Fallback rate
        return 1350.0


def get_stock_price_usd(symbol: str) -> Optional[float]:
    """
    Get stock price in USD using stooq.com

    Args:
        symbol: Stock ticker symbol (e.g., "NVDA", "TSLA")

    Returns:
        Price in USD or None if failed
    """
    cache_key = f"stock:{symbol}"
    if cache_key in _cache:
        timestamp, price = _cache[cache_key]
        if time.time() - timestamp < _CACHE_TTL:
            print(f"Using cached price for {symbol}: ${price:.2f}")
            return price

    print(f"Fetching price for {symbol}...")
    try:
        with httpx.Client(timeout=10) as client:
            url = "https://stooq.com/q/l/"
            stooq_symbol = f"{symbol.lower()}.us"
            params = {"s": stooq_symbol, "f": "sd2t2ohlcv", "h": "", "e": "csv"}
            response = client.get(url, params=params)
            response.raise_for_status()

            lines = response.text.strip().splitlines()
            if len(lines) < 2:
                print(f"No data for {symbol}")
                return None

            headers = [h.strip().lower() for h in lines[0].split(",")]
            values = [v.strip() for v in lines[1].split(",")]
            data = dict(zip(headers, values))

            close_value = data.get("close")
            if not close_value or close_value == "N/D":
                print(f"No price data for {symbol}")
                return None

            price = float(close_value)
            _cache[cache_key] = (time.time(), price)
            print(f"{symbol}: ${price:.2f}")
            return price
    except Exception as e:
        print(f"Error fetching price for {symbol}: {e}")
        return None


def get_btc_price_krw() -> Optional[float]:
    """Get Bitcoin price in KRW from Upbit"""
    cache_key = "btc"
    if cache_key in _cache:
        timestamp, price = _cache[cache_key]
        if time.time() - timestamp < _CACHE_TTL:
            print(f"Using cached BTC price: {price:,.0f} KRW")
            return price

    print("Fetching BTC price from Upbit...")
    try:
        with httpx.Client(timeout=10) as client:
            response = client.get(
                "https://api.upbit.com/v1/ticker",
                params={"markets": "KRW-BTC"}
            )
            response.raise_for_status()
            data = response.json()
            price = float(data[0]["trade_price"])
            _cache[cache_key] = (time.time(), price)
            print(f"BTC: {price:,.0f} KRW")
            return price
    except Exception as e:
        print(f"Error fetching BTC price: {e}")
        return None


def calculate_quantity(asset: Dict[str, Any]) -> Dict[str, Any]:
    """
    Calculate quantity for an asset

    Args:
        asset: Dict with 'name' and 'amount_krw'

    Returns:
        Dict with 'name', 'symbol', 'asset_type', 'quantity'
    """
    name = asset["name"]
    amount_krw = asset["amount_krw"]

    # Get symbol and type
    info = get_asset_info(name)
    symbol = info["symbol"]
    asset_type = info["type"]

    print(f"\nProcessing: {name} ({amount_krw:,.0f} KRW)")
    print(f"  → Symbol: {symbol}, Type: {asset_type}")

    quantity = None

    if asset_type == "stock":
        # Get stock price
        price_usd = get_stock_price_usd(symbol)
        if price_usd:
            usd_krw_rate = get_usd_krw_rate()
            price_krw = price_usd * usd_krw_rate
            quantity = amount_krw / price_krw
            print(f"  → Quantity: {quantity:.6f} shares (Price: ${price_usd:.2f} / {price_krw:,.0f} KRW)")
        else:
            print(f"  → Failed to get price, using quantity=1")
            quantity = 1.0

    elif asset_type == "crypto":
        # Get BTC price
        if symbol.upper() == "BTC":
            price_krw = get_btc_price_krw()
            if price_krw:
                quantity = amount_krw / price_krw
                print(f"  → Quantity: {quantity:.8f} BTC")
            else:
                print(f"  → Failed to get BTC price, using quantity=1")
                quantity = 1.0
        else:
            print(f"  → Only BTC supported, using quantity=1")
            quantity = 1.0

    else:
        # Custom type: quantity = amount_krw / 10000
        quantity = amount_krw / 10000.0
        print(f"  → Quantity: {quantity:.6f} (custom type, price=10000 KRW)")

    return {
        "name": name,
        "symbol": symbol,
        "asset_type": asset_type,
        "quantity": quantity
    }


def main():
    if len(sys.argv) < 3:
        print("Usage: python3 map_assets.py <input_json> <output_json>")
        sys.exit(1)

    input_file = sys.argv[1]
    output_file = sys.argv[2]

    # Read raw assets
    with open(input_file, "r", encoding="utf-8") as f:
        raw_assets = json.load(f)

    print(f"Loaded {len(raw_assets)} assets from {input_file}")

    # Map assets
    mapped_assets = []
    for asset in raw_assets:
        try:
            mapped = calculate_quantity(asset)
            mapped_assets.append(mapped)
            # Rate limiting
            time.sleep(0.3)
        except Exception as e:
            print(f"Error processing {asset['name']}: {e}")
            continue

    # Write to output
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(mapped_assets, f, ensure_ascii=False, indent=2)

    print(f"\n✓ Mapped {len(mapped_assets)} assets")
    print(f"✓ Output written to: {output_file}")

    # Summary
    stock_count = sum(1 for a in mapped_assets if a["asset_type"] == "stock")
    crypto_count = sum(1 for a in mapped_assets if a["asset_type"] == "crypto")
    other_count = len(mapped_assets) - stock_count - crypto_count
    print(f"\nSummary:")
    print(f"  - Stocks: {stock_count}")
    print(f"  - Crypto: {crypto_count}")
    print(f"  - Others: {other_count}")


if __name__ == "__main__":
    main()
