# Folkemødet 2026 – Program Viewer

En enkel, hurtig single-page webapp til at navigere [Folkemødet 2026](https://folkemoedet.dk)’s program.
Søg, filtrér på temaer, hjert dine favoritter, og find vej til arrangementerne via Leaflet-kort eller direkte navigation i Google Maps.

🔗 **Live på [jaisper.github.io/Folkemodet](https://jaisper.github.io/Folkemodet/)**

> 📍 Allinge på Bornholm · 11.–13. juni 2026
> ⚠️ Ikke et officielt Folkemødet-produkt. Data hentes fra [program.folkemoedet.dk](https://program.folkemoedet.dk).

-----

## Funktioner

- **Hele programmet** for torsdag, fredag og lørdag — ~3.600 arrangementer
- **Officielle Folkemødet-temaer** som filter-chips med tællere
- **Søg** på tværs af titel, beskrivelse, arrangør, venue og deltagere
- **Filter** på dag, venue og fritekstsøgning
- **❤️ Egne favoritter** — hjert seancer, gemmes lokalt i browseren via `localStorage`
- **📍 Vis på kort** — præcis GPS-position for alle ~400 stadier, kalibreret mod Folkemødets officielle teknikkort
- **🚶 Naviger** med Google Maps gå-rute direkte fra stadets position
- **📄 Officielt PDF-kort** som backup — peger på den relevante zone-PDF
- **Mobile-first design** — responsivt, ingen JS-frameworks, ingen tracking, ingen cookies
- **PWA-venligt** — én HTML-fil (~66 KB), kører offline efter første load

-----

## Arkitektur

Hele appen er **én single-file HTML** (`index.html`) der serves statisk fra GitHub Pages.
Programmet hentes som `program.json` ved load. JSON’en opdateres automatisk hver morgen
via en GitHub Action der scraper det officielle program.

```
┌──────────────────────────────────────────────────────────────┐
│  GitHub Pages (statisk hosting)                              │
│  ├── index.html        ← hele app'en (CSS + JS + 400 koord.) │
│  ├── program.json      ← scraped event-data, opdateres dgl.  │
│  └── scripts/scrape.mjs ← Playwright-scraper, kører i Action │
└──────────────────────────────────────────────────────────────┘
                            │
                            ▼
            program.folkemoedet.dk (Nuxt SPA)
```

### Scraping

`scripts/scrape.mjs` bruger Playwright til at:

1. **Phase 1**: klikke “Vis flere” indtil hele programmet er loadet, ekstrahere event-cards
1. **Phase 2**: besøge hver event-detail-side for at hente:
- `themes` — officiel taksonomi (singular “Tema”-label)
- `more` — fuld beskrivelse
- `speakers` — strukturerede objekter med navn, rolle og org

Konkurrent (4 parallelle pages), caching pr. event-ID, periodisk save til `program.json.partial` hver 200 events.

### Stade-koordinater

Alle 401 stade-positioner er ekstraheret fra **Folkemødets tre officielle Teknikkort-PDF’er** (cms.folkemoedet.dk) med PyMuPDF.
Hver PDF er kalibreret med 3 brugerverificerede GPS-ankerpunkter (eksakt affin transformation, 0 m anker-fejl):

|Teknikkort|Zoner           |Ankre        |
|----------|----------------|-------------|
|TK1       |A, B, C, D, E   |A5, C18, D11 |
|TK2       |D, E, F, G, H, N|F1, G18, N18 |
|TK3       |G, H, J, K, N   |J27, K24, G30|

Resulterende præcision: **±1–5 meter** afhængigt af afstand til ankerpunkterne.

### Kortvisning

- **Leaflet** + OpenStreetMap tiles til interaktiv kortvisning
- **Pulserende rød markør** på det specifikke stade
- Knapper: “Naviger med Google Maps” (gå-rute fra brugerens GPS-position) + “Officielt PDF-kort”
  (peger på det relevante teknikkort)

### Favoritter

- Gemmes i `localStorage` under nøgle `folkemodet2026_favorites_v1`
- Stabil event-ID fra URL (`/events/2026/{id}/...`) bruges som nøgle, så favoritter overlever rebuilds
- Write-verification så vi opdager når browseren blokerer lagringen (private mode, aggressiv cookie-blokering)
- Synlig advarsel hvis lagring fejler

-----

## Lokal udvikling

```bash
git clone https://github.com/Jaisper/Folkemodet.git
cd Folkemodet

# Kør lokal preview
python3 -m http.server 8000
# Åbn http://localhost:8000

# Test scraperen
cd scripts
npm install playwright
node scrape.mjs
```

-----

## GitHub Action

`.github/workflows/scrape-program.yml` kører dagligt kl. 06:00 UTC og kan også trigges manuelt
under **Actions → Scrape Folkemødet Program → Run workflow**.

- Timeout: 55 minutter (typisk forløb er 15-30 min)
- Retry-push loop med `git pull --rebase` (max 5 forsøg) i tilfælde af samtidige commits

-----

## Stack

|Komponent            |Teknologi                                                                                                                             |
|---------------------|--------------------------------------------------------------------------------------------------------------------------------------|
|Frontend             |Vanilla JS, HTML, CSS – ingen frameworks                                                                                              |
|Kort                 |[Leaflet](https://leafletjs.com/) + [OpenStreetMap](https://www.openstreetmap.org/)                                                   |
|Typografi            |[Oswald](https://fonts.google.com/specimen/Oswald) (display) + [Source Sans 3](https://fonts.google.com/specimen/Source+Sans+3) (body)|
|Scraping             |[Playwright](https://playwright.dev/) i Node.js                                                                                       |
|Koordinat-ekstraktion|Python: `pymupdf` + `numpy`                                                                                                           |
|Hosting              |GitHub Pages                                                                                                                          |
|Automatisering       |GitHub Actions (cron + manual dispatch)                                                                                               |

-----

## Anerkendelser

- **Folkemødet** for at gøre programmet og kortene offentligt tilgængelige
- **OpenStreetMap-bidragyderne** for det utrolige geografiske datalag
- **Erik Nielsen / Folkemødets tekniske team** for de smukke vektor-teknikkort

-----

## Licens

MIT. Brug, modificer, deploy som du vil. Ingen affiliering med Folkemødet.

Bygget af [@Jaisper](https://github.com/Jaisper) — bug-reports og PRs er velkomne.
