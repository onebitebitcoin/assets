import httpx
import pytest

from backend.services import pricing
from backend.services.pricing import fetch_stock_usd_price


@pytest.mark.anyio
async def test_fetch_stock_usd_price_tsla():
    async with httpx.AsyncClient() as client:
        try:
            price, source = await fetch_stock_usd_price("TSLA", client)
        except (httpx.HTTPStatusError, ValueError) as exc:
            if isinstance(exc, httpx.HTTPStatusError) and exc.response is not None and exc.response.status_code == 429:
                pytest.skip("Rate limited (429).")
            if isinstance(exc, ValueError) and "All price sources failed" in str(exc):
                pytest.skip("All price sources failed (API unavailable).")
            raise

    assert price > 0
    assert source in ("finnhub", "stooq")


@pytest.mark.anyio
async def test_fetch_usd_krw_rate_primary():
    class DummyResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {"rates": {"KRW": 1350.5}}

    class DummyClient:
        async def get(self, *_args, **_kwargs):
            return DummyResponse()

    rate = await pricing.fetch_usd_krw_rate(DummyClient())
    assert rate == 1350.5


@pytest.mark.anyio
async def test_get_price_krw_stock(monkeypatch):
    async def fake_stock_price(_symbol, _client):
        return 10.0, "finnhub"

    async def fake_rate(_client):
        return 1200.0

    monkeypatch.setattr(pricing, "fetch_stock_usd_price", fake_stock_price)
    monkeypatch.setattr(pricing, "fetch_usd_krw_rate", fake_rate)

    result = await pricing.get_price_krw("AAPL", "stock")
    assert result.price_krw == 12000.0
    assert result.price_usd == 10.0
    assert result.source == "finnhub"


@pytest.mark.anyio
async def test_get_price_krw_btc(monkeypatch):
    async def fake_btc_price(_client):
        return 41000000.0

    monkeypatch.setattr(pricing, "fetch_btc_krw_price", fake_btc_price)
    result = await pricing.get_price_krw("BTC", "crypto")
    assert result.price_krw == 41000000.0
    assert result.source == "upbit"


@pytest.mark.anyio
async def test_get_price_krw_batch(monkeypatch):
    async def fake_rate(_client):
        return 1200.0

    async def fake_finnhub(_symbol, _client):
        prices = {"AAPL": 150.0, "MSFT": 300.0}
        return prices.get(_symbol)

    async def fake_stooq(_symbol, _client):
        return None

    async def fake_btc_price(_client):
        return 50000000.0

    monkeypatch.setattr(pricing, "fetch_usd_krw_rate", fake_rate)
    monkeypatch.setattr(pricing, "_fetch_from_finnhub", fake_finnhub)
    monkeypatch.setattr(pricing, "_fetch_from_stooq", fake_stooq)
    monkeypatch.setattr(pricing, "fetch_btc_krw_price", fake_btc_price)

    assets = [("AAPL", "stock"), ("MSFT", "stock"), ("BTC", "crypto")]
    results = await pricing.get_price_krw_batch(assets)

    assert "AAPL" in results
    assert results["AAPL"].price_usd == 150.0
    assert results["AAPL"].price_krw == 150.0 * 1200.0
    assert results["AAPL"].source == "finnhub"

    assert "MSFT" in results
    assert results["MSFT"].source == "finnhub"

    assert "BTC" in results
    assert results["BTC"].price_krw == 50000000.0
    assert results["BTC"].source == "upbit"
