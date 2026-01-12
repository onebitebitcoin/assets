"""
Asset name to symbol/type mapping for automatic asset classification
"""

ASSET_MAPPING = {
    # 미국 주식 - Big Tech
    "엔비디아": {"symbol": "NVDA", "type": "stock"},
    "테슬라": {"symbol": "TSLA", "type": "stock"},
    "애플": {"symbol": "AAPL", "type": "stock"},
    "마이크로소프트": {"symbol": "MSFT", "type": "stock"},
    "알파벳 Class A": {"symbol": "GOOGL", "type": "stock"},
    "알파벳": {"symbol": "GOOGL", "type": "stock"},
    "브로드컴": {"symbol": "AVGO", "type": "stock"},

    # 미국 주식 - 반도체
    "TSMC ADR": {"symbol": "TSM", "type": "stock"},
    "ASML 홀딩 ADR": {"symbol": "ASML", "type": "stock"},

    # 미국 주식 - 기타
    "애브비": {"symbol": "ABBV", "type": "stock"},
    "코카콜라": {"symbol": "KO", "type": "stock"},
    "리얼티 인컴": {"symbol": "O", "type": "stock"},
    "유니티소프트웨어": {"symbol": "U", "type": "stock"},

    # ETF
    "Invesco QQQ Trust ETF": {"symbol": "QQQ", "type": "stock"},
    "SPDR 다우존스 ETF": {"symbol": "DIA", "type": "stock"},
    "SPDR S&P500 성장 ETF": {"symbol": "SPYG", "type": "stock"},

    # 한국 주식
    "SK하이닉스": {"symbol": "000660.KS", "type": "stock"},

    # Crypto
    "BTC": {"symbol": "BTC", "type": "crypto"},
    "비트코인": {"symbol": "BTC", "type": "crypto"},
}


def get_asset_info(name: str) -> dict:
    """
    Get symbol and type for an asset name.

    Args:
        name: Asset name from Excel

    Returns:
        dict with 'symbol' and 'type' keys
        If not in mapping, returns the name as symbol with 'savings' type
    """
    # Exact match
    if name in ASSET_MAPPING:
        return ASSET_MAPPING[name]

    # Fuzzy match (case-insensitive, stripped)
    name_normalized = name.strip().lower()
    for key, value in ASSET_MAPPING.items():
        if key.strip().lower() == name_normalized:
            return value

    # Default: use name as symbol with custom type
    return {
        "symbol": name,
        "type": "savings"
    }
