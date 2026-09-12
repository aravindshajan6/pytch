"""Product constants shared across modules (and exposed via GET /meta)."""

SPORTS: list[dict] = [
    {"key": "football", "label": "Football", "emoji": "⚽", "formats": ["5v5", "7v7"]},
    {"key": "cricket", "label": "Cricket Nets", "emoji": "🏏", "formats": ["nets", "box"]},
    {"key": "badminton", "label": "Badminton", "emoji": "🏸", "formats": ["singles", "doubles"]},
    {"key": "pickleball", "label": "Pickleball", "emoji": "🥒", "formats": ["doubles"]},
    {"key": "basketball", "label": "Basketball", "emoji": "🏀", "formats": ["3v3", "5v5"]},
]
SPORT_KEYS = {s["key"] for s in SPORTS}

AREAS: list[dict] = [
    {"name": "Kakkanad", "lat": 10.0159, "lng": 76.3419},
    {"name": "Edappally", "lat": 10.0261, "lng": 76.3084},
    {"name": "Kaloor", "lat": 9.9975, "lng": 76.2926},
    {"name": "Palarivattom", "lat": 10.0033, "lng": 76.3068},
    {"name": "Vyttila", "lat": 9.9658, "lng": 76.3182},
    {"name": "Panampilly Nagar", "lat": 9.9582, "lng": 76.2958},
    {"name": "Marine Drive", "lat": 9.9771, "lng": 76.2773},
    {"name": "Fort Kochi", "lat": 9.9658, "lng": 76.2421},
    {"name": "Thrippunithura", "lat": 9.9439, "lng": 76.3486},
    {"name": "Aluva", "lat": 10.1076, "lng": 76.3516},
    {"name": "Kalamassery", "lat": 10.0527, "lng": 76.3190},
]

RATING_TAGS: list[str] = [
    "Clinical finisher",
    "Great passer",
    "Wall at the back",
    "Safe hands",
    "Engine",
    "Playmaker",
    "Keeps it cool",
    "Always on time",
    "Team player",
    "Speedster",
]

ACTIVE_MEMBER_STATUSES = ("joined", "paid")
