import math

from sqlalchemy import ColumnElement, func

EARTH_RADIUS_KM = 6371.0088


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(a))


def haversine_sql(lat_col, lng_col, lat: float, lng: float) -> ColumnElement[float]:
    """SQL expression for great-circle distance (km) between columns and a point."""
    dlat = func.radians(lat_col - lat)
    dlng = func.radians(lng_col - lng)
    a = func.power(func.sin(dlat / 2), 2) + func.cos(func.radians(lat)) * func.cos(
        func.radians(lat_col)
    ) * func.power(func.sin(dlng / 2), 2)
    return 2 * EARTH_RADIUS_KM * func.asin(func.sqrt(a))
