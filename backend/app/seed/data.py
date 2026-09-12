"""Static demo content: fictional Kochi venues and community players.

Venue and player names are invented — any resemblance to real businesses or people is coincidental.
Cover images are Unsplash photos (verified to resolve with HTTP 200 when this seed was written).
"""

from dataclasses import dataclass, field


def unsplash(photo_id: str, w: int = 1200) -> str:
    return f"https://images.unsplash.com/photo-{photo_id}?auto=format&fit=crop&w={w}&q=80"


IMG = {
    "floodlit": "1431324155629-1a6deb1dec8d",
    "grass_line": "1459865264687-595d652de67e",
    "night_pitch": "1487466365202-1afdb86c764e",
    "balls": "1518604666860-9ed391f76460",
    "cricket_ball": "1531415074968-036ba1b575da",
    "empty_goal": "1543351611-58f69d7c1781",
    "turf_balls": "1551958219-acbc608c6377",
    "tackle": "1553778263-73a83bab9b0c",
    "kick": "1560272564-c83b66b1ad12",
    "ball_grass": "1574629810360-7efbbe195018",
    "ball_lawn": "1575361204480-aadea25e6e68",
    "ball_turf": "1589487391730-58f20eb2c308",
    "footwork": "1600679472829-3044539ce8ed",
    "futsal": "1606925797300-0b35e9d1794e",
    "batsman": "1624526267942-ab0ff8a3e972",
    "match": "1624880357913-a8539238245b",
    "badminton": "1626224583764-f87db24ac4ea",
}


@dataclass(frozen=True)
class PitchSpec:
    key: str  # stable handle used by the seed scenarios
    name: str
    sport: str
    format: str
    capacity: int
    price: int  # ₹ / hour off-peak
    peak: int  # ₹ / hour peak
    indoor: bool = False
    camera_fee: int = 0  # ₹, 0 = no camera


@dataclass(frozen=True)
class VenueSpec:
    slug: str
    name: str
    area: str
    lat: float
    lng: float
    address: str
    phone: str
    description: str
    cover: str
    photos: tuple[str, ...]
    amenities: tuple[str, ...]
    rating: float
    rating_count: int
    pitches: tuple[PitchSpec, ...]
    open_hour: int = 6
    close_hour: int = 23


VENUES: list[VenueSpec] = [
    VenueSpec(
        "backwater-arena", "Backwater Arena", "Vyttila", 9.9672, 76.3205,
        "Behind Mobility Hub Rd, Vyttila, Kochi 682019", "+914842000101",
        "Floodlit FIFA-grade turf a stone's throw from the Vyttila hub, with a breeze off the backwaters "
        "that makes evening fives the best in town. Camera-equipped main pitch for match recordings.",
        IMG["floodlit"], (IMG["night_pitch"], IMG["ball_grass"]),
        ("Floodlights", "Parking", "Changing rooms", "Drinking water", "Bibs & balls", "Match camera"),
        4.7, 386,
        (
            PitchSpec("bwa-a", "Pitch A · 5s", "football", "5v5", 10, 1500, 1800, camera_fee=250),
            PitchSpec("bwa-b", "Pitch B · 7s", "football", "7v7", 14, 2000, 2400, camera_fee=300),
        ),
    ),
    VenueSpec(
        "kakkanad-kickoff-dome", "Kakkanad Kickoff Dome", "Kakkanad", 10.0132, 76.3468,
        "Seaport–Airport Rd, near Collectorate, Kakkanad, Kochi 682030", "+914842000102",
        "Kochi's favourite rain-proof football dome — a fully covered 5s arena plus an open-air 7s pitch "
        "and two wooden-floor badminton courts. The monsoon plan B for half of Infopark.",
        IMG["futsal"], (IMG["turf_balls"], IMG["badminton"]),
        ("Covered arena", "Floodlights", "Parking", "Changing rooms", "Cafeteria", "Showers"),
        4.6, 512,
        (
            PitchSpec("kkd-dome", "The Dome · Indoor 5s", "football", "5v5", 10, 1600, 1900, indoor=True),
            PitchSpec("kkd-7s", "Open 7s", "football", "7v7", 14, 1900, 2300, camera_fee=250),
            PitchSpec("kkd-bad1", "Badminton Court 1", "badminton", "doubles", 4, 400, 500, indoor=True),
            PitchSpec("kkd-bad2", "Badminton Court 2", "badminton", "doubles", 4, 400, 500, indoor=True),
        ),
    ),
    VenueSpec(
        "infopark-turf-republic", "Turf Republic Infopark", "Kakkanad", 10.0086, 76.3601,
        "Infopark Expressway, Phase 1 Gate, Kakkanad, Kochi 682042", "+914842000103",
        "Two lightning-fast 5s pitches built for the after-work crowd, plus bowling-machine cricket nets. "
        "Pitch 1 has a fixed match camera — book 'Recorded' and relive every nutmeg.",
        IMG["night_pitch"], (IMG["kick"], IMG["batsman"]),
        ("Floodlights", "Parking", "Bowling machine", "Drinking water", "Match camera"),
        4.5, 298,
        (
            PitchSpec("itr-1", "Pitch 1 · 5s", "football", "5v5", 10, 1400, 1750, camera_fee=200),
            PitchSpec("itr-2", "Pitch 2 · 5s", "football", "5v5", 10, 1300, 1650),
            PitchSpec("itr-nets", "Cricket Nets", "cricket", "nets", 6, 700, 900),
        ),
    ),
    VenueSpec(
        "edappally-goal-factory", "Goal Factory Edappally", "Edappally", 10.0238, 76.3102,
        "NH 66 Service Rd, near Edappally Toll, Kochi 682024", "+914842000104",
        "Premium covered 5s with shock-pad turf, an open-air camera pitch and two pickleball courts. "
        "Pricey, but the air-cooled indoor arena is worth every rupee in April.",
        IMG["tackle"], (IMG["footwork"], IMG["balls"]),
        ("Covered arena", "Air cooling", "Parking", "Pro shop", "Showers", "Match camera"),
        4.8, 441,
        (
            PitchSpec("egf-indoor", "Arena · Indoor 5s", "football", "5v5", 10, 1900, 2400, indoor=True),
            PitchSpec("egf-open", "Open 5s", "football", "5v5", 10, 1400, 1750, camera_fee=250),
            PitchSpec("egf-pb", "Pickleball Court", "pickleball", "doubles", 4, 500, 600),
        ),
    ),
    VenueSpec(
        "marine-line-sports-park", "Marine Line Sports Park", "Marine Drive", 9.9794, 76.2789,
        "Walkway Rd, off Marine Drive, Ernakulam, Kochi 682031", "+914842000105",
        "Sunset football with a sea breeze. A full-size 7s pitch, a quick 5s cage and two pickleball "
        "courts right off the Marine Drive walkway.",
        IMG["empty_goal"], (IMG["grass_line"], IMG["ball_lawn"]),
        ("Floodlights", "Pay & park", "Drinking water", "Bibs & balls"),
        4.4, 233,
        (
            PitchSpec("mls-7s", "Seaside 7s", "football", "7v7", 14, 1800, 2200),
            PitchSpec("mls-5s", "Cage 5s", "football", "5v5", 10, 1200, 1500),
            PitchSpec("mls-pb", "Pickleball Court", "pickleball", "doubles", 4, 450, 550),
        ),
    ),
    VenueSpec(
        "palarivattom-pitch-house", "The Pitch House", "Palarivattom", 10.0051, 76.3049,
        "Bypass Junction, Palarivattom, Kochi 682025", "+914842000106",
        "A warehouse turned covered sports house — indoor 5s under LED lights and three BWF-spec "
        "badminton courts. Zero rain delays, ever.",
        IMG["badminton"], (IMG["futsal"],),
        ("Covered arena", "LED lighting", "Parking", "Changing rooms", "Racket rental"),
        4.6, 367,
        (
            PitchSpec("tph-indoor", "Indoor 5s", "football", "5v5", 10, 1650, 2000, indoor=True),
            PitchSpec("tph-bad1", "Court 1", "badminton", "doubles", 4, 380, 460, indoor=True),
            PitchSpec("tph-bad2", "Court 2", "badminton", "doubles", 4, 380, 460, indoor=True),
            PitchSpec("tph-bad3", "Court 3 · Singles", "badminton", "singles", 2, 350, 420, indoor=True),
        ),
    ),
    VenueSpec(
        "harbour-kicks-fort-kochi", "Harbour Kicks", "Fort Kochi", 9.9641, 76.2448,
        "Beach Rd, near the Parade Ground side lanes, Fort Kochi 682001", "+914842000107",
        "Heritage-town football with a camera-equipped 5s pitch and practice nets. Grab a Fort Kochi "
        "coffee after the final whistle.",
        IMG["ball_lawn"], (IMG["ball_turf"],),
        ("Floodlights", "Drinking water", "Match camera", "Bibs & balls"),
        4.3, 154,
        (
            PitchSpec("hk-5s", "Harbour 5s", "football", "5v5", 10, 1200, 1500, camera_fee=200),
            PitchSpec("hk-nets", "Practice Nets", "cricket", "nets", 6, 600, 750),
        ),
    ),
    VenueSpec(
        "kaloor-nightfall-turf", "Nightfall Turf Kaloor", "Kaloor", 9.9989, 76.2941,
        "Stadium Link Rd, Kaloor, Kochi 682017", "+914842000108",
        "Open till midnight on weekends — two floodlit football pitches and a box-cricket arena "
        "for the late-night crowd.",
        IMG["turf_balls"], (IMG["floodlit"],),
        ("Floodlights", "Open late", "Parking", "Snacks counter"),
        4.5, 276,
        (
            PitchSpec("nf-5s", "Pitch 1 · 5s", "football", "5v5", 10, 1300, 1650),
            PitchSpec("nf-7s", "Pitch 2 · 7s", "football", "7v7", 14, 1900, 2300),
            PitchSpec("nf-box", "Box Cricket", "cricket", "box", 12, 1000, 1300),
        ),
        close_hour=0,
    ),
    VenueSpec(
        "temple-town-turf", "Temple Town Turf", "Thrippunithura", 9.9452, 76.3461,
        "SN Junction Rd, Thrippunithura, Kochi 682301", "+914842000109",
        "Neighbourhood 5s pitch and an indoor badminton hall, loved by the early-morning regulars.",
        IMG["match"], (IMG["balls"],),
        ("Floodlights", "Parking", "Drinking water"),
        4.2, 118,
        (
            PitchSpec("ttt-5s", "Main 5s", "football", "5v5", 10, 1200, 1450),
            PitchSpec("ttt-bad", "Badminton Hall", "badminton", "doubles", 4, 350, 420, indoor=True),
        ),
    ),
    VenueSpec(
        "aluva-riverside-sports-hub", "Riverside Sports Hub", "Aluva", 10.1049, 76.3538,
        "Periyar Riverside Rd, Aluva 683101", "+914842000110",
        "Big-sky 7s pitch by the Periyar, a covered 5s and turf cricket nets with bowling machines.",
        IMG["batsman"], (IMG["cricket_ball"], IMG["empty_goal"]),
        ("Covered arena", "Floodlights", "Parking", "Bowling machine", "Cafeteria"),
        4.4, 189,
        (
            PitchSpec("arh-7s", "River 7s", "football", "7v7", 14, 1700, 2100),
            PitchSpec("arh-indoor", "Covered 5s", "football", "5v5", 10, 1500, 1850, indoor=True),
            PitchSpec("arh-nets", "Turf Nets", "cricket", "nets", 6, 650, 800),
        ),
    ),
    VenueSpec(
        "kalamassery-campus-courts", "Campus Courts Kalamassery", "Kalamassery", 10.0551, 76.3212,
        "HMT Rd, near the tech campus, Kalamassery, Kochi 683104", "+914842000111",
        "Student-friendly prices: an outdoor 5s pitch, two indoor badminton courts and a pickleball court.",
        IMG["kick"], (IMG["badminton"],),
        ("Floodlights", "Parking", "Student discounts", "Racket rental"),
        4.3, 143,
        (
            PitchSpec("kcc-5s", "Campus 5s", "football", "5v5", 10, 1200, 1500),
            PitchSpec("kcc-bad1", "Badminton A", "badminton", "doubles", 4, 350, 420, indoor=True),
            PitchSpec("kcc-bad2", "Badminton B", "badminton", "doubles", 4, 350, 420, indoor=True),
            PitchSpec("kcc-pb", "Pickleball Court", "pickleball", "doubles", 4, 400, 480),
        ),
    ),
    VenueSpec(
        "panampilly-pocket-turf", "Pocket Turf Panampilly", "Panampilly Nagar", 9.9569, 76.2981,
        "Avenue Rd, Panampilly Nagar, Kochi 682036", "+914842000112",
        "A boutique camera-equipped 5s pitch and a covered futsal court tucked behind the Panampilly "
        "avenue — tight, technical, fast.",
        IMG["footwork"], (IMG["futsal"], IMG["ball_turf"]),
        ("Covered futsal", "Floodlights", "Match camera", "Changing rooms"),
        4.6, 207,
        (
            PitchSpec("ppt-5s", "Avenue 5s", "football", "5v5", 10, 1400, 1700, camera_fee=250),
            PitchSpec("ppt-futsal", "Futsal Court · Indoor", "football", "5v5", 10, 1450, 1700, indoor=True),
        ),
    ),
]


@dataclass(frozen=True)
class PlayerSpec:
    name: str
    area: str
    position: str | None
    sports: tuple[str, ...]
    archetype: str  # verified | elite | skilled | regular | rookie
    skill_level: str
    foot: str | None = "right"
    bio: str | None = None
    bench: bool = False
    extra: dict = field(default_factory=dict)


PLAYERS: list[PlayerSpec] = [
    PlayerSpec("Rahul Nair", "Kakkanad", "Forward", ("football",), "verified", "pro",
               bio="Infopark by day, poacher by night.", bench=True),
    PlayerSpec("Anjali Menon", "Edappally", "Midfielder", ("football", "badminton"), "skilled", "advanced",
               foot="left", bio="Left foot, loud voice."),
    PlayerSpec("Vishnu Prasad", "Vyttila", "Defender", ("football",), "verified", "advanced",
               bio="Nobody gets past the Vyttila wall.", bench=True),
    PlayerSpec("Fathima Rasheed", "Kaloor", "Winger", ("football",), "regular", "intermediate"),
    PlayerSpec("Arun Kumar", "Palarivattom", "Goalkeeper", ("football",), "skilled", "advanced",
               bio="Gloves on, phone off.", bench=True),
    PlayerSpec("Sreelakshmi Pillai", "Panampilly Nagar", None, ("badminton",), "skilled", "advanced", foot=None),
    PlayerSpec("Nikhil Varghese", "Kakkanad", "Midfielder", ("football",), "verified", "pro",
               bio="Tiki-taka evangelist.", bench=True),
    PlayerSpec("Joel Thomas", "Fort Kochi", "Forward", ("football",), "regular", "intermediate", bench=True),
    PlayerSpec("Aswathy Krishnan", "Thrippunithura", None, ("pickleball", "badminton"), "regular", "intermediate",
               foot=None),
    PlayerSpec("Adarsh Menon", "Aluva", "Defender", ("football", "cricket"), "regular", "intermediate"),
    PlayerSpec("Gokul Das", "Kalamassery", "Midfielder", ("football",), "skilled", "advanced", bench=True),
    PlayerSpec("Hari Shankar", "Edappally", "Winger", ("football",), "rookie", "beginner"),
    PlayerSpec("Muhammed Shafeeq", "Kaloor", "Forward", ("football",), "skilled", "advanced", foot="both",
               bio="Two feet, zero mercy."),
    PlayerSpec("Kiran Joseph", "Vyttila", "Defender", ("football",), "regular", "intermediate", bench=True),
    PlayerSpec("Meera Nambiar", "Marine Drive", None, ("badminton", "pickleball"), "regular", "intermediate",
               foot=None),
    PlayerSpec("Abhijith Suresh", "Kakkanad", "Goalkeeper", ("football",), "regular", "intermediate"),
    PlayerSpec("Sandeep Kurup", "Palarivattom", "Midfielder", ("football",), "verified", "advanced",
               bio="Organiser of the Sunday 7 AM crew."),
    PlayerSpec("Irfan Ali", "Fort Kochi", "Winger", ("football",), "skilled", "advanced", foot="left"),
    PlayerSpec("Ananya Raj", "Panampilly Nagar", None, ("pickleball",), "rookie", "beginner", foot=None),
    PlayerSpec("Varun Mathew", "Aluva", "Defender", ("cricket", "football"), "regular", "intermediate"),
    PlayerSpec("Jishnu Mohan", "Thrippunithura", "Forward", ("football",), "rookie", "beginner"),
    PlayerSpec("Neethu Paul", "Kalamassery", None, ("badminton",), "regular", "intermediate", foot=None),
    PlayerSpec("Sachin Babu", "Vyttila", "Midfielder", ("football",), "elite", "pro",
               bio="Magic feet, questionable punctuality."),
    PlayerSpec("Amal Jose", "Edappally", "Defender", ("football",), "skilled", "advanced"),
    PlayerSpec("Rohit Chandran", "Kakkanad", "Forward", ("football",), "regular", "intermediate"),
    PlayerSpec("Shyam Sundar", "Marine Drive", None, ("cricket",), "regular", "intermediate", foot=None),
    PlayerSpec("Akshay Unnikrishnan", "Kaloor", "Defender", ("football",), "rookie", "beginner"),
    PlayerSpec("Nimisha George", "Palarivattom", "Winger", ("football",), "regular", "intermediate"),
    PlayerSpec("Ajmal Hussain", "Kalamassery", "Goalkeeper", ("football",), "skilled", "advanced", bench=True),
    PlayerSpec("Devika Suresh", "Edappally", None, ("badminton", "pickleball"), "skilled", "advanced", foot=None),
]

# Target (Bayesian) averages, rating counts and counters per archetype: (lo, hi) ranges.
ARCHETYPES: dict[str, dict] = {
    "verified": {"n": (13, 22), "raters": (8, 13), "skill": (4.2, 4.5), "fair": (4.4, 4.7), "rel": (4.3, 4.6),
                 "no_shows": (0, 0), "played": (30, 70), "hosted": (6, 15), "subs": (1, 6), "xp": (4200, 7800)},
    "elite": {"n": (10, 15), "raters": (7, 10), "skill": (4.35, 4.5), "fair": (3.6, 3.8), "rel": (3.5, 3.7),
              "no_shows": (2, 3), "played": (25, 50), "hosted": (1, 4), "subs": (0, 2), "xp": (3000, 5000)},
    "skilled": {"n": (7, 14), "raters": (5, 9), "skill": (3.45, 3.62), "fair": (3.7, 3.95), "rel": (3.6, 3.95),
                "no_shows": (0, 1), "played": (12, 35), "hosted": (1, 6), "subs": (0, 3), "xp": (1500, 3600)},
    "regular": {"n": (3, 8), "raters": (3, 6), "skill": (2.6, 3.0), "fair": (3.2, 3.7), "rel": (3.1, 3.6),
                "no_shows": (0, 1), "played": (4, 14), "hosted": (0, 2), "subs": (0, 1), "xp": (500, 1500)},
    "rookie": {"n": (0, 2), "raters": (0, 2), "skill": (3.0, 3.3), "fair": (3.2, 3.6), "rel": (3.2, 3.6),
               "no_shows": (0, 0), "played": (1, 3), "hosted": (0, 0), "subs": (0, 0), "xp": (120, 450)},
}

POSITION_TAGS: dict[str | None, tuple[str, ...]] = {
    "Forward": ("Clinical finisher", "Speedster", "Team player"),
    "Winger": ("Speedster", "Great passer", "Engine"),
    "Midfielder": ("Great passer", "Playmaker", "Engine"),
    "Defender": ("Wall at the back", "Keeps it cool", "Always on time"),
    "Goalkeeper": ("Safe hands", "Keeps it cool", "Always on time"),
    None: ("Team player", "Always on time", "Keeps it cool"),
}

MATCH_TITLES = [
    "Thursday Night Fives", "Infopark After-Hours", "Monsoon Warm-up", "Early Kick Club",
    "Friday Floodlights", "Weekend Warriors", "Sunset Sevens", "Office League Friendly",
]

CLIP_TITLES = [
    "Top-bins volley 🚀", "Nutmeg of the week", "Last-ditch block", "Keeper says no!",
    "Solo run from halfway", "One-touch team goal", "Panenka penalty", "Rabona assist 😮",
    "Worldie from the corner", "Double save scramble",
]
CLIP_TAGS = ["goal", "skill", "save", "assist", "defending", "banter"]
