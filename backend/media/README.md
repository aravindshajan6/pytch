# PYTCH demo match footage

Demo clips for the PYTCH turf-booking app (match highlights / "turf cam" playback).
All three clips are **real, openly licensed footage from Wikimedia Commons**; no
footage was generated. The clips are for demonstration only. The people and teams
in them have nothing to do with PYTCH or any Kochi turf.

```
media/
├── README.md
├── footage/
│   ├── manifest.json      # machine-readable list (file, thumbnail, duration, source, license, attribution)
│   ├── match-01.mp4
│   ├── match-02.mp4
│   └── match-03.mp4
└── thumbs/
    ├── match-01.jpg       # 1280x720
    ├── match-02.jpg
    └── match-03.jpg
```

## Output spec (all files)

| File | Duration | Size | Video | Audio |
|---|---|---|---|---|
| `footage/match-01.mp4` | 55.96 s | 7.6 MB | H.264 High, 1280x720, yuv420p, ~9.8 fps (source rate) | AAC-LC 96 kb/s stereo |
| `footage/match-02.mp4` | 31.99 s | 2.8 MB | H.264 High, 1280x720, yuv420p, 29.97 fps | AAC-LC 96 kb/s stereo |
| `footage/match-03.mp4` | 60.22 s | 8.9 MB | H.264 High, 1280x720, yuv420p, ~14.75 fps (source rate) | AAC-LC 96 kb/s stereo |

Every MP4 is written with `-movflags +faststart`, so the `moov` atom comes before `mdat`
(top-level atom order is `ftyp, moov, free, mdat`) and the clips can stream progressively.

The low frame rates of match-01 and match-03 are the frame rates of the original phone recordings.
They were kept as-is and not padded with duplicated frames.

## Sources and licenses

Both licenses are **share-alike and require attribution**. Wherever these clips are shown
(app UI credits, an about screen, or next to the player), include the attribution line below.
Derivatives, including these transcodes, stay under the same license.

### match-01.mp4: floodlit 5-a-side on artificial turf
- **Source page:** https://commons.wikimedia.org/wiki/File:Kuna-Zona_175456.webm
- **Original file:** https://upload.wikimedia.org/wikipedia/commons/3/3d/Kuna-Zona_175456.webm (VP8/Opus, 1280x720, 55.96 s)
- **Author:** Quahadi Añtó (Commons user `Quahadi`), own work, recorded 2015-01-10
- **Context:** New Year futsal tournament, Orebić, Croatia, 2015. Match "Kuna vs Zona".
- **License:** CC BY-SA 3.0, https://creativecommons.org/licenses/by-sa/3.0/
- **Attribution:** "Kuna-Zona 175456" by Quahadi Añtó, via Wikimedia Commons, CC BY-SA 3.0
- **Changes:** transcoded to H.264/AAC MP4. No crop or other edits.
- **Thumbnail:** frame at 3 s

### match-02.mp4: amateur match filmed from above (shot on goal)
- **Source page:** https://commons.wikimedia.org/wiki/File:Amateurfu%C3%9Fball_Torschuss_von_oben.webm
- **Original file:** https://upload.wikimedia.org/wikipedia/commons/b/ba/Amateurfu%C3%9Fball_Torschuss_von_oben.webm (VP9/Opus, 3840x2160, 31.99 s)
- **Author:** Maximilian Schönherr, own work, recorded 2022-02-05
- **License:** CC BY-SA 4.0, https://creativecommons.org/licenses/by-sa/4.0/
- **Attribution:** "Amateurfußball Torschuss von oben" by Maximilian Schönherr, via Wikimedia Commons, CC BY-SA 4.0
- **Changes:** cropped from 3840x2160 to the pitch area (2240x1260 region at x=810, y=146), scaled to 1280x720, and transcoded to H.264/AAC MP4.
- **Thumbnail:** frame at 12 s

### match-03.mp4: night futsal on an outdoor court
- **Source page:** https://commons.wikimedia.org/wiki/File:Zona_20140111_171421.ogv
- **Original file:** https://upload.wikimedia.org/wikipedia/commons/6/6f/Zona_20140111_171421.ogv (Theora/Opus, 1280x720, 60.23 s)
- **Author:** Quahadi Añtó (Commons user `Quahadi`), own work, recorded 2014-01-11
- **Context:** New Year futsal tournament, Orebić, Croatia, 2014
- **License:** CC BY-SA 3.0, https://creativecommons.org/licenses/by-sa/3.0/
- **Attribution:** "Zona 20140111 171421" by Quahadi Añtó, via Wikimedia Commons, CC BY-SA 3.0
- **Changes:** transcoded to H.264/AAC MP4. No crop or other edits.
- **Thumbnail:** frame at 20 s

## Pipeline

The source files were found through the Wikimedia Commons MediaWiki API:

```bash
# search File: namespace for videos
curl -s "https://commons.wikimedia.org/w/api.php?action=query&list=search&srnamespace=6&srsearch=futsal%20filetype:video&format=json"
# direct URL + license/author metadata
curl -s "https://commons.wikimedia.org/w/api.php?action=query&titles=File:Kuna-Zona%20175456.webm&prop=imageinfo&iiprop=url|extmetadata&format=json"
```

Download (to a temp dir, not kept in the repo):

```bash
curl -L -o kunazona.webm   "https://upload.wikimedia.org/wikipedia/commons/3/3d/Kuna-Zona_175456.webm"
curl -L -o amateur.webm    "https://upload.wikimedia.org/wikipedia/commons/b/ba/Amateurfu%C3%9Fball_Torschuss_von_oben.webm"
curl -L -o zona171421.ogv  "https://upload.wikimedia.org/wikipedia/commons/6/6f/Zona_20140111_171421.ogv"
```

Transcode (ffmpeg 6.1.1):

```bash
X="-c:v libx264 -preset slow -crf 26 -profile:v high -pix_fmt yuv420p -c:a aac -b:a 96k -ac 2 -movflags +faststart"

ffmpeg -y -i kunazona.webm  -vf "scale=1280:720:flags=lanczos,setsar=1" $X footage/match-01.mp4
ffmpeg -y -i amateur.webm   -vf "crop=2240:1260:810:146,scale=1280:720:flags=lanczos,setsar=1" $X footage/match-02.mp4
ffmpeg -y -i zona171421.ogv -vf "scale=1280:720:flags=lanczos,setsar=1" $X footage/match-03.mp4
```

Thumbnails:

```bash
ffmpeg -y -ss 3  -i footage/match-01.mp4 -frames:v 1 -q:v 3 thumbs/match-01.jpg
ffmpeg -y -ss 12 -i footage/match-02.mp4 -frames:v 1 -q:v 3 thumbs/match-02.jpg
ffmpeg -y -ss 20 -i footage/match-03.mp4 -frames:v 1 -q:v 3 thumbs/match-03.jpg
```

Verification:

```bash
ffprobe -v error -show_entries format=duration,size:stream=codec_name,width,height -of json footage/match-01.mp4
# faststart check: moov must precede mdat among the top-level atoms
python3 -c "import struct;f=open('footage/match-01.mp4','rb');o=[]
while (h:=f.read(8)) and len(h)==8:
  s,t=struct.unpack('>I4s',h);o.append(t.decode());f.seek((struct.unpack('>Q',f.read(8))[0]-16) if s==1 else s-8,1)
print(o)"
```
