# Folkemødet 2026 — Program

Single-file HTML-app der viser hele programmet for Folkemødet 2026 (11.–13. juni, Allinge, Bornholm) med søgning, filtrering, kort og favoritter.

🔗 **Live:** [jaisper.github.io/Folkemodet](https://jaisper.github.io/Folkemodet)

## Funktioner

- **Smart søgning** der håndterer smushed data fra Folkemødets API (`ModeratorKim` matches af både “moderator” og “kim”)
- **Filtre:** dag, venue, tema, favoritter, “Aktuelle” (skjul overståede events)
- **Sprog:** Dansk ↔ Engelsk — alle UI-strenge og event-tekster (titel, summary, beskrivelse) oversat med Groq
- **Kort:** Leaflet + OpenStreetMap med pulserende markør på præcis stade-position (~1-5 m præcision), gå-rute via Google Maps og link til officielt PDF-teknikkort
- **Favoritter:** Hjerte ❤️ events, gemt i `localStorage` med automatisk backup. Eksport/import som JSON via footer-knapperne (💾/📂)
- **Natlige events** sorteres korrekt: et event kl. 00:30 “Torsdag” tilhører natten *efter* torsdag og placeres derefter i tidsplanen
- **Diskret UX:** Scroll-to-top knap, dobbeltklik på event-card for at hoppe til toppen, stillesvarende performance på ~3,900 events

## Arkitektur

```
┌──────────────────────────────────────────────────────────────┐
│  GitHub Actions (daily cron 06:00 UTC)                       │
│    scripts/scrape.mjs                                        │
│    ├─ Playwright: hent listing + detail-pages                │
│    ├─ Smart titel-splitter (heuristik på sammensatte titler) │
│    └─ Groq translation (openai/gpt-oss-120b)                 │
│        ↓                                                     │
│    program.json (~10 MB, ~3,900 events)                      │
└──────────────────────────────────────────────────────────────┘
        ↓ commit til main + GitHub Pages
┌──────────────────────────────────────────────────────────────┐
│  index.html (single-file, vanilla JS, ~95 KB)                │
│    fetch program.json → render → filter/search → kort        │
└──────────────────────────────────────────────────────────────┘
```

### Tech stack

- **Frontend:** Vanilla HTML/CSS/JS, ingen frameworks
- **Kort:** [Leaflet](https://leafletjs.com/) + OpenStreetMap-tiles
- **Scraper:** [Playwright](https://playwright.dev/) (Node.js, concurrency=4)
- **Oversættelse:** [Groq](https://groq.com/) inference med `openai/gpt-oss-120b`
- **GPS-kalibrering:** Python (pymupdf + numpy) — éngangsudtræk fra Folkemødets PDF-teknikkort
- **Hosting:** GitHub Pages
- **Automation:** GitHub Actions

### Filer

|Fil                                   |Formål                                        |
|--------------------------------------|----------------------------------------------|
|`index.html`                          |Hele frontend-appen (HTML + CSS + JS i én fil)|
|`program.json`                        |Scraped data, ~10 MB, committed til repo      |
|`scripts/scrape.mjs`                  |Playwright scraper + Groq oversættelse        |
|`.github/workflows/scrape-program.yml`|Daglig cron + workflow_dispatch               |

## Daglig drift

Den daglige cron kører automatisk kl. 06:00 UTC (08:00 dansk sommertid) med:

- `FAST_MODE=1` — kun nye/ændrede events oversættes (typisk <$0.05/dag)
- `REFETCH_DETAILS=0` — eksisterende detail-cache genbruges

### Manuel kørsel

**Actions → Scrape Folkemødet Program → Run workflow**, vælg input:

|Input            |Default|Hvornår bruges det                                                           |
|-----------------|-------|-----------------------------------------------------------------------------|
|`max_events`     |tom    |Sæt et tal (fx 20) for at teste uden at committe — uploader artifact i stedet|
|`fast_mode`      |ON     |Sluk hvis du vil re-oversætte alt (dyr, ~$0.50-1.50)                         |
|`refetch_details`|OFF    |Tænd hvis scraper-logik er ændret og cached details skal re-hentes           |

### Push-strategi

Lange scrape-kørsler (30+ min) kan kollidere med samtidige commits. Workflow bruger **overskriv-strategi**: gem genereret `program.json` til `/tmp`, `git reset --hard origin/main`, kopier tilbage, commit. Ingen rebase-konflikter.

## Lokal udvikling

```bash
# Frontend (åbn bare filen i browser eller server lokalt)
python3 -m http.server 8000
# → http://localhost:8000

# Kør scraper lokalt
npm install
export GROQ_API_KEY=...
node scripts/scrape.mjs
```

`MAX_EVENTS=10` for at lave en lille test-kørsel uden at committe.

## Kendte begrænsninger

- **~1-1.5% af events** har forkerte `more`/`speakers` på Folkemødets egen side. Scraperen henter det trofast — brugere kan klikke “Officiel side” for at se kilden direkte.
- **Festival-vindue 11.-13. juni 2026** er hardkodet for “Aktuelle”-chip auto-aktivering.
- **GPS-kalibrering** dækker tre teknikkort (TK1-3) i Allinge. Stadenavne uden for disse tre felter får ikke kort-markering.

## Bidrag

Privat projekt. Ingen affiliering med Folkemødet — bare en bruger der ville have en bedre programoplevelse.

Findes der noget der virker mærkeligt? Tjek den officielle side. Hvis problemet ER i appen, lav en issue.

— Jesper / [@Jaisper](https://github.com/Jaisper)
