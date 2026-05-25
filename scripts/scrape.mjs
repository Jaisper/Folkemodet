// Folkemødet 2026 program scraper
// Run: node scripts/scrape.mjs
// Output: program.json in repo root

import { chromium } from 'playwright';
import fs from 'fs';

const PROGRAM_URL = 'https://program.folkemoedet.dk/2026';
const OUT_FILE = 'program.json';

const DAY_MAP = {
  '11': 'Torsdag',
  '12': 'Fredag',
  '13': 'Lørdag',
  '14': 'Søndag'
};

async function scrape() {
  console.log('Launching browser...');
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (compatible; FolkemodetScraper/1.0; github.com/Jaisper/Folkemodet)'
  });
  const page = await ctx.newPage();

  console.log(`Visiting ${PROGRAM_URL}...`);
  await page.goto(PROGRAM_URL, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2000);

  const allEvents = [];
  const seenIds = new Set();

  // The page has day-filter buttons. We iterate each day, click it, then load all events.
  // Day buttons: text matches "Torsdag", "Fredag", "Lørdag"
  const dayButtons = ['Torsdag', 'Fredag', 'Lørdag', 'Søndag'];

  for (const dayLabel of dayButtons) {
    console.log(`\n=== Processing ${dayLabel} ===`);
    try {
      // Click day filter button
      const btn = page.locator(`button:has-text("${dayLabel}"), a:has-text("${dayLabel}")`).first();
      if (await btn.count() === 0) {
        console.log(`No button for ${dayLabel}, skipping`);
        continue;
      }
      await btn.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(1500);

      // Repeatedly click "Vis flere events" until it's gone
      let clickCount = 0;
      const maxClicks = 100; // safety
      while (clickCount < maxClicks) {
        const moreBtn = page.locator('button:has-text("Vis flere"), a:has-text("Vis flere")').first();
        const visible = await moreBtn.isVisible().catch(() => false);
        if (!visible) break;
        await moreBtn.scrollIntoViewIfNeeded().catch(() => {});
        await moreBtn.click().catch(() => {});
        clickCount++;
        await page.waitForTimeout(700);
        if (clickCount % 10 === 0) console.log(`  Clicked "Vis flere" ${clickCount}x`);
      }
      console.log(`  Done expanding (${clickCount} clicks)`);

      // Extract all events on page
      const events = await page.evaluate(() => {
        const out = [];
        const links = document.querySelectorAll('a[href*="/events/2026/"]');
        links.forEach(link => {
          const href = link.getAttribute('href') || '';
          const idMatch = href.match(/\/events\/2026\/(\d+)\//);
          if (!idMatch) return;
          const id = idMatch[1];

          // Walk children to extract structured fields. The layout text starts with KL.HH:MM-HH:MM
          const text = link.textContent || '';
          const timeMatch = text.match(/^KL\.(\d{2}:\d{2})-(\d{2}:\d{2})(.*)$/s);
          if (!timeMatch) return;
          const [, start, end, rest] = timeMatch;

          // The rest is: <title><description>Arrangører<orgs><venue>
          // Title and description are concatenated; we recover title from URL slug
          const slugMatch = href.match(/\/events\/2026\/\d+\/(.+)$/);
          let title = '';
          if (slugMatch) {
            title = slugMatch[1]
              .replace(/-/g, ' ')
              .replace(/aa/g, 'å').replace(/ae/g, 'æ').replace(/oe/g, 'ø')
              .replace(/\b\w/g, c => c.toUpperCase());
            // Restore lowercase for connectors
            title = title.replace(/\b(Og|I|På|Til|Med|Af|For|En|Et|Den|Det|De|Som|Når|Hvor|Hvad|Du|Vi|Er|Skal|Kan|Ikke)\b/g,
              w => w.toLowerCase());
            // Always capitalize first letter
            title = title.charAt(0).toUpperCase() + title.slice(1);
          }

          // Try to split "rest" into title/desc + organizers + venue
          // The text "Arrangører" separates the two halves
          const arrIdx = rest.indexOf('Arrangører');
          let summary = rest;
          let organizers = '';
          let venue = '';
          if (arrIdx !== -1) {
            summary = rest.substring(0, arrIdx).trim();
            const after = rest.substring(arrIdx + 'Arrangører'.length).trim();
            // Venue pattern at end: <code> - <name>, where code is e.g. "B4", "G12", "J27"
            const venueMatch = after.match(/([A-ZÆØÅ]\d{1,3}\s*-\s*.+)$/);
            if (venueMatch) {
              venue = venueMatch[1].trim();
              organizers = after.substring(0, venueMatch.index).trim();
            } else {
              organizers = after;
            }
          }

          out.push({
            id,
            title,
            summary,
            time: `${start}-${end}`,
            organizers,
            venue,
            url: href.startsWith('http') ? href : `https://program.folkemoedet.dk${href}`
          });
        });
        return out;
      });

      let added = 0;
      for (const ev of events) {
        if (seenIds.has(ev.id)) continue;
        seenIds.add(ev.id);
        ev.day = dayLabel;
        allEvents.push(ev);
        added++;
      }
      console.log(`  Found ${events.length} events on page, ${added} new`);
    } catch (err) {
      console.error(`Error on ${dayLabel}: ${err.message}`);
    }
  }

  await browser.close();

  // Sort: by day order, then by start time
  const DAY_ORDER = { 'Torsdag': 0, 'Fredag': 1, 'Lørdag': 2, 'Søndag': 3 };
  allEvents.sort((a, b) => {
    const da = DAY_ORDER[a.day] ?? 99;
    const db = DAY_ORDER[b.day] ?? 99;
    if (da !== db) return da - db;
    return a.time.localeCompare(b.time);
  });

  const out = {
    scraped_at: new Date().toISOString(),
    source: PROGRAM_URL,
    event_count: allEvents.length,
    events: allEvents
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2));
  console.log(`\n✓ Wrote ${allEvents.length} events to ${OUT_FILE}`);
}

scrape().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
