# Folkemødet 2026 – Program Viewer

En enkel, hurtig single-page webapp til at navigere [Folkemødet 2026](https://folkemoedet.dk)'s program.
Søg, filtrér på temaer, hjert dine favoritter, og find vej til arrangementerne via Leaflet-kort eller direkte navigation i Google Maps.

🔗 **Live på [jaisper.github.io/Folkemodet](https://jaisper.github.io/Folkemodet/)**

> 📍 Allinge på Bornholm · 11.–13. juni 2026
> ⚠️ Ikke et officielt Folkemødet-produkt. Data hentes fra [program.folkemoedet.dk](https://program.folkemoedet.dk).

---

## Funktioner

- **Hele programmet** for torsdag, fredag og lørdag — ~3.600 arrangementer
- **🇩🇰 / 🇬🇧 Sprog-toggle** — fuld engelsk oversættelse af titler, undertitler og fulde beskrivelser via Groq LLM
- **Officielle Folkemødet-temaer** som filter-chips med tællere (oversatte i begge sprog)
- **Søg** på tværs af titel, beskrivelse, arrangør, venue og deltagere — virker på tværs af dansk og engelsk
- **Filter** på dag, venue og fritekstsøgning
- **❤️ Egne favoritter** — hjert seancer, gemmes lokalt i browseren via `localStorage` med automatisk backup
- **💾 Eksportér / 📂 Importér favoritter** — gem dine valg som JSON og indlæs senere på en anden enhed
- **📍 Vis på kort** — præcis GPS-position for alle ~400 stadier, kalibreret mod Folkemødets officielle teknikkort
- **🚶 Naviger** med Google Maps gå-rute direkte fra stadets position
- **📄 Officielt PDF-kort** som backup — peger på den relevante zone-PDF
- **Sprog-badge** på hvert event — `[EN]` for events afholdt på engelsk, `[DA]` for danske (vises kun i EN-fanen)
- **Mobile-first design** — responsivt, ingen JS-frameworks, ingen tracking, ingen cookies
- **PWA-venligt** — én HTML-fil (~85 KB), kører offline efter første load

---

## Arkitektur

Hele appen er **én single-file HTML** (`index.html`) der serves statisk fra GitHub Pages.
Programmet hentes som `program.json` ved load. JSON'en opdateres automatisk hver morgen
via en GitHub Action der scraper det officielle program og oversætter det til engelsk via Groq.

```
┌──────────────────────────────────────────────────────────────────┐
│  GitHub Pages (statisk hosting)                                  │
│  ├── index.html         ← hele app'en (CSS + JS + 400 koord.)   │
│  ├── program.json       ← scraped + oversat event-data, dgl.    │
│  └── scripts/scrape.mjs ← Playwright + Groq, kører i Action      │
└──────────────────────────────────────────────────────────────────┘
                            │
                            ▼
         ┌──────────────────────────────────────┐
         │  program.folkemoedet.dk (Nuxt SPA)   │
         │  api.groq.com (LLM-oversættelse)     │
         └──────────────────────────────────────┘
```

### Scraping

`scripts/scrape.mjs` bruger Playwright til at:

1. **Phase 1**: klikke "Vis flere" indtil hele programmet er loadet, ekstrahere event-cards
2. **Phase 2**: besøge hver event-detail-side for at hente:
   - `themes` — officiel taksonomi (singular "Tema"-label)
   - `more` — fuld beskrivelse
   - `speakers` — strukturerede objekter med navn, rolle og org
3. **Smart titel-split**: heuristisk score-baseret splitter der finder grænsen mellem
   titel og undertitel når Folkemødets HTML har dem smeltet sammen (~90% accuracy)
4. **Phase 3**: oversætter alle danske titler, summaries og fulde beskrivelser
   til engelsk via Groq's `openai/gpt-oss-120b` model

Konkurrent (4 parallelle pages), caching pr. event-ID, periodisk save til `program.json.partial` hver 200 events.

### Oversættelse

Daglige oversættelser kører via [Groq](https://groq.com) (pay-as-you-go):

- **Model**: `openai/gpt-oss-120b` — billig, hurtig, god kvalitet
- **Cost**: ~$0.50-1.00 ved første fuld-oversættelse, ~$0.01-0.05/dag for inkrementelle opdateringer
- **Cache**: alle oversættelser gemmes i `program.json` og genbruges på næste run
- **Completeness check**: hvis et event mangler `title_en`, `summary_en` eller `more_en` (eller titel ser "oppustet" ud — typisk tegn på at scraperen klistrede titel og undertitel sammen), re-queues det automatisk
- **Robust parsing**: håndterer JSON-respons i fire forskellige formats (array, wrapped, single object, id-keyed map)
- **Rate-limit aware**: detekterer både RPM- og TPM-loft samt daglig kvote og afbryder pænt med gem-til-fil

### Stade-koordinater

Alle 401 stade-positioner er ekstraheret fra **Folkemødets tre officielle Teknikkort-PDF'er** (cms.folkemoedet.dk) med PyMuPDF.
Hver PDF er kalibreret med 3 brugerverificerede GPS-ankerpunkter (eksakt affin transformation, 0 m anker-fejl):

| Teknikkort | Zoner | Ankre |
|------------|-------|-------|
| TK1 | A, B, C, D, E | A5, C18, D11 |
| TK2 | D, E, F, G, H, N | F1, G18, N18 |
| TK3 | G, H, J, K, N | J27, K24, G30 |

Resulterende præcision: **±1–5 meter** afhængigt af afstand til ankerpunkterne.

### Kortvisning

- **Leaflet** + OpenStreetMap tiles til interaktiv kortvisning
- **Pulserende rød markør** på det specifikke stade
- Knapper: "Naviger med Google Maps" (gå-rute fra brugerens GPS-position) + "Officielt PDF-kort"
  (peger på det relevante teknikkort)

### Favoritter

- Gemmes i `localStorage` under nøgle `folkemodet2026_favorites_v1`
- **Auto-backup**: hver write gemmes også som `folkemodet2026_favorites_v1_backup` med timestamp
- **Auto-restore**: hvis primær nøgle er tom ved load, prøves backup'en automatisk
- **Manuel eksport/import**: download som JSON-fil, indlæs senere på en anden enhed
- Stabil event-ID fra URL (`/events/2026/{id}/...`) bruges som nøgle, så favoritter overlever rebuilds
- Write-verification så vi opdager når browseren blokerer lagringen (private mode, aggressiv cookie-blokering)
- Synlig advarsel hvis lagring fejler

### Sprog (i18n)

- Sprogvalg gemmes i `localStorage` under nøgle `folkemodet2026_lang_v1`
- Statiske UI-strenge har `data-i18n` / `data-i18n-html` / `data-i18n-placeholder` / `data-i18n-aria` attributter
- 30+ Folkemødet-temaer oversat manuelt via statisk ordbog (`THEME_TRANSLATIONS`)
- Event-titler, undertitler og fulde beskrivelser oversat via LLM i scrape-step
- Søgning matcher på tværs af originale og oversatte felter
- `<html lang>` opdateres ved sprogskifte for screen readers

---

## Lokal udvikling

```bash
git clone https://github.com/Jaisper/Folkemodet.git
cd Folkemodet

# Kør lokal preview
python3 -m http.server 8000
# Åbn http://localhost:8000

# Test scraperen lokalt (uden oversættelse — kræver GROQ_API_KEY)
cd scripts
npm install playwright
node scrape.mjs

# Test med begrænset antal events (hurtig debug)
MAX_EVENTS=20 GROQ_API_KEY=gsk_... node scrape.mjs
```

---

## GitHub Action

`.github/workflows/scrape-program.yml` kører dagligt kl. 06:00 UTC og kan også trigges manuelt
under **Actions → Scrape Folkemødet Program → Run workflow**.

- **Manuel trigger** har et input-felt `max_events` — lad det stå tomt for fuld scrape (= produktion),
  eller skriv et tal (fx 20, 100) for at lave en hurtig test der ikke commit'er ændringer
- Test-mode uploader resultatet som workflow-artifact i stedet for at commit'e
- Timeout: 60 minutter (typisk forløb er 15-25 min med oversættelse)
- Retry-push loop med `git pull --rebase` (max 5 forsøg) i tilfælde af samtidige commits
- **GitHub Secret** `GROQ_API_KEY` skal være sat for at aktivere oversættelses-steppet (graceful fallback hvis missing)

---

## Stack

| Komponent | Teknologi |
|-----------|-----------|
| Frontend | Vanilla JS, HTML, CSS – ingen frameworks |
| Kort | [Leaflet](https://leafletjs.com/) + [OpenStreetMap](https://www.openstreetmap.org/) |
| Typografi | [Oswald](https://fonts.google.com/specimen/Oswald) (display) + [Source Sans 3](https://fonts.google.com/specimen/Source+Sans+3) (body) |
| Scraping | [Playwright](https://playwright.dev/) i Node.js |
| Oversættelse | [Groq](https://groq.com) cloud inference — `openai/gpt-oss-120b` |
| Koordinat-ekstraktion | Python: `pymupdf` + `numpy` |
| Hosting | GitHub Pages |
| Automatisering | GitHub Actions (cron + manual dispatch) |

---

## Filer

```
Folkemodet/
├── index.html                          # Hele frontend-appen (~85 KB)
├── program.json                        # Scraped + oversat program (auto-genereret)
├── scripts/
│   └── scrape.mjs                      # Playwright-scraper + Groq-oversætter
├── .github/
│   └── workflows/
│       └── scrape-program.yml          # Daglig cron + manuel trigger
├── img/                                # Custom event-billeder (valgfrit)
└── README.md                           # Denne fil
```

---

## Anerkendelser

- **Folkemødet** for at gøre programmet og kortene offentligt tilgængelige
- **OpenStreetMap-bidragyderne** for det utrolige geografiske datalag
- **Erik Nielsen / Folkemødets tekniske team** for de smukke vektor-teknikkort
- **Groq** for hurtig og billig LLM-inferens der gør oversættelses-steppet praktisk muligt

---

## Licens

MIT. Brug, modificer, deploy som du vil. Ingen affiliering med Folkemødet.

Bygget af [@Jaisper](https://github.com/Jaisper) — bug-reports og PRs er velkomne.
