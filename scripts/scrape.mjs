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

        // Helper: get text from first matching child, with whitespace preserved
        const getText = (root, selectors) => {
          for (const sel of selectors) {
            const el = root.querySelector(sel);
            if (el && el.textContent && el.textContent.trim()) {
              return el.textContent.trim();
            }
          }
          return '';
        };

        // Walk DOM and insert spaces at block element boundaries
        const getStructuredText = (root) => {
          const BLOCK_TAGS = new Set(['DIV', 'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
            'LI', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'BR', 'TD', 'TR']);
          const parts = [];
          const walk = (node) => {
            if (node.nodeType === Node.TEXT_NODE) {
              const t = node.textContent;
              if (t && t.trim()) parts.push(t);
              return;
            }
            if (node.nodeType !== Node.ELEMENT_NODE) return;
            const isBlock = BLOCK_TAGS.has(node.tagName);
            if (isBlock && parts.length && !/\s$/.test(parts[parts.length - 1])) {
              parts.push(' '); // boundary space
            }
            for (const child of node.childNodes) walk(child);
            if (isBlock && parts.length && !/\s$/.test(parts[parts.length - 1])) {
              parts.push(' ');
            }
          };
          walk(root);
          return parts.join('').replace(/\s+/g, ' ').trim();
        };

        // Helper: slug → readable Danish (last-resort fallback only)
        const slugToTitle = (slug) => {
          if (!slug) return '';
          let s = slug
            .replace(/-/g, ' ')
            .replace(/\baa\b/gi, 'å')
            .replace(/\bae\b/gi, 'æ')
            .replace(/\boe\b/gi, 'ø');
          return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
        };

        links.forEach(link => {
          const href = link.getAttribute('href') || '';
          const idMatch = href.match(/\/events\/2026\/(\d+)\//);
          if (!idMatch) return;
          const id = idMatch[1];

          // STRATEGY 1: Extract title from heading elements
          let title = getText(link, ['h2', 'h3', 'h4', 'h5', 'h1',
            '[class*="title" i]', '[class*="heading" i]', '[class*="name" i]']);

          // Use structured text walking that preserves block boundaries
          const text = getStructuredText(link);

          // Time
          let time = '';
          const timeMatch = text.match(/KL\.?\s*(\d{1,2}[:.]\d{2})\s*[-–—]\s*(\d{1,2}[:.]\d{2})/i);
          if (timeMatch) {
            time = `${timeMatch[1].replace('.', ':')}-${timeMatch[2].replace('.', ':')}`;
          }

          // STRATEGY 2: If no heading found, parse text layout
          if (!title) {
            const restMatch = text.match(/KL\.?\s*\d{1,2}[:.]\d{2}\s*[-–—]\s*\d{1,2}[:.]\d{2}\s*(.*)$/is);
            const rest = restMatch ? restMatch[1] : text;
            const arrIdx = rest.indexOf('Arrangører');
            const beforeArr = arrIdx !== -1 ? rest.substring(0, arrIdx) : rest;
            const firstSentence = beforeArr.match(/^(.+?[.?!])\s/);
            if (firstSentence) {
              title = firstSentence[1].trim();
            } else if (beforeArr.length < 200) {
              title = beforeArr.trim();
            }
          }

          // STRATEGY 3: Reconstruct from URL slug
          if (!title) {
            const slugMatch = href.match(/\/events\/2026\/\d+\/(.+?)\/?$/);
            if (slugMatch) title = slugToTitle(slugMatch[1]);
          }

          title = title.replace(/\s+/g, ' ').trim();
          if (title.length > 300) title = title.slice(0, 300) + '…';

          // Extract summary / organizers / venue from rest
          const restMatch = text.match(/KL\.?\s*\d{1,2}[:.]\d{2}\s*[-–—]\s*\d{1,2}[:.]\d{2}\s*(.*)$/is);
          const rest = restMatch ? restMatch[1] : '';

          let afterTitle = rest;
          // Try to strip title from beginning of rest (it's often duplicated)
          if (title) {
            const lowerRest = rest.toLowerCase();
            const lowerTitle = title.toLowerCase();
            if (lowerRest.startsWith(lowerTitle)) {
              afterTitle = rest.substring(title.length).trim();
            }
          }

          const arrIdx = afterTitle.indexOf('Arrangører');
          let summary = '';
          let organizers = '';
          let venue = '';
          if (arrIdx !== -1) {
            summary = afterTitle.substring(0, arrIdx).trim();
            const after = afterTitle.substring(arrIdx + 'Arrangører'.length).trim();
            const venueMatch = after.match(/([A-ZÆØÅ]\d{1,3}\s*-\s*.+)$/);
            if (venueMatch) {
              venue = venueMatch[1].trim();
              organizers = after.substring(0, venueMatch.index).trim();
            } else {
              organizers = after;
            }
          } else {
            summary = afterTitle.trim();
          }

          // Strip leading punctuation from summary
          summary = summary.replace(/^[\s.,;:!?-]+/, '');
          if (summary.length > 400) summary = summary.slice(0, 400) + '…';

          out.push({
            id,
            title,
            summary,
            time,
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

  // === PHASE 2: enrich events with themes from detail pages ===
  // We re-open browser for parallel page contexts.
  // Details rarely change for an event, so we cache by ID from previous program.json
  let prevEvents = [];
  try {
    const prev = JSON.parse(fs.readFileSync(OUT_FILE, 'utf8'));
    prevEvents = prev.events || [];
  } catch {}
  const detailCache = new Map();
  for (const e of prevEvents) {
    const hasThemes = e.themes && Array.isArray(e.themes) && e.themes.length > 0;
    const hasMore = e.more && e.more.length > 0;
    if (hasThemes || hasMore) {
      detailCache.set(e.id, {
        themes: e.themes || [],
        more: e.more || "",
        speakers: e.speakers || []
      });
    }
  }
  console.log(`\n=== PHASE 2: Event detail enrichment ===`);
  console.log(`Cached details for ${detailCache.size} events from previous run`);

  // Identify events we still need to fetch
  const toFetch = allEvents.filter(e => !detailCache.has(e.id));
  console.log(`Need to fetch details for ${toFetch.length} new/uncached events`);

  if (toFetch.length > 0) {
    const browser2 = await chromium.launch({ headless: true });
    const ctx2 = await browser2.newContext({
      userAgent: 'Mozilla/5.0 (compatible; FolkemodetScraper/1.0; github.com/Jaisper/Folkemodet)'
    });

    const CONCURRENCY = 8;
    let fetched = 0;
    let errors = 0;
    let diagnostic_logged = 0;

    // Process in batches
    for (let i = 0; i < toFetch.length; i += CONCURRENCY) {
      const batch = toFetch.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(async (ev) => {
        const page = await ctx2.newPage();
        try {
          await page.goto(ev.url, { waitUntil: 'networkidle', timeout: 30000 });
          // Wait for the "Tema" label to appear in DOM (Nuxt hydration)
          await page.waitForFunction(() => {
            const els = document.querySelectorAll('h1,h2,h3,h4,h5,h6,strong,b,div,span,p,label,dt');
            for (const el of els) {
              const t = (el.textContent || '').trim();
              if (t === 'Tema' || t === 'Temaer') return true;
            }
            return false;
          }, { timeout: 5000 }).catch(() => {});

          const details = await page.evaluate(() => {
            // Helper: find label element and return text of next content element
            const findLabelValue = (labelTexts) => {
              const allEls = Array.from(document.querySelectorAll(
                'h1,h2,h3,h4,h5,h6,strong,b,div,span,p,label,dt'
              ));
              for (const el of allEls) {
                const t = (el.textContent || '').trim();
                if (labelTexts.includes(t)) {
                  // Try next sibling first
                  let candidate = el.nextElementSibling;
                  let safety = 0;
                  while (candidate && safety < 5) {
                    const txt = (candidate.textContent || '').trim();
                    if (txt && txt.length > 1
                        && !labelTexts.includes(txt)
                        && !KNOWN_LABELS.has(txt)) {
                      return { element: candidate, text: txt };
                    }
                    candidate = candidate.nextElementSibling;
                    safety++;
                  }
                  // Try parent siblings
                  if (el.parentElement) {
                    const siblings = Array.from(el.parentElement.children);
                    const idx = siblings.indexOf(el);
                    for (let i = idx + 1; i < Math.min(idx + 4, siblings.length); i++) {
                      const txt = (siblings[i].textContent || '').trim();
                      if (txt && txt.length > 1
                          && !labelTexts.includes(txt)
                          && !KNOWN_LABELS.has(txt)) {
                        return { element: siblings[i], text: txt };
                      }
                    }
                  }
                  return null;
                }
              }
              return null;
            };

            const KNOWN_LABELS = new Set([
              'Tema', 'Temaer', 'Emneord', 'Mere om', 'Beskrivelse',
              'Deltagere', 'Arrangører', 'Arrangør', 'Lokation', 'Detaljer',
              'Sprog', 'Underholdning', 'Livestream', 'Tegnsprogtolkes',
              'Teleslynge', 'Kørestolstilgængelig', 'Hjemmeside'
            ]);

            // === THEMES ===
            const themes = [];
            const themaResult = findLabelValue(['Tema', 'Temaer', 'Emneord']);
            if (themaResult && themaResult.text.length < 200) {
              themes.push(themaResult.text);
            }

            // === MORE (full description) ===
            // The "Mere om" section usually contains multi-paragraph rich text.
            // We want the WHOLE block, not just the first paragraph.
            let more = "";
            const allEls = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6,strong,b'));
            for (const el of allEls) {
              const t = (el.textContent || '').trim();
              if (t === 'Mere om' || t === 'Beskrivelse') {
                // Collect text from next siblings until we hit another known label
                const parts = [];
                let sib = el.nextElementSibling;
                let safety = 0;
                while (sib && safety < 20) {
                  const sibText = (sib.textContent || '').trim();
                  if (!sibText) { sib = sib.nextElementSibling; safety++; continue; }
                  // Stop if we hit another section heading
                  if (KNOWN_LABELS.has(sibText)) break;
                  // Stop if this sibling CONTAINS a known label (next section start)
                  const innerLabels = Array.from(sib.querySelectorAll('h1,h2,h3,h4,h5,h6'));
                  let hitSection = false;
                  for (const inner of innerLabels) {
                    if (KNOWN_LABELS.has((inner.textContent || '').trim())) {
                      hitSection = true; break;
                    }
                  }
                  if (hitSection) break;
                  parts.push(sibText);
                  sib = sib.nextElementSibling;
                  safety++;
                }
                more = parts.join('\n\n').trim();
                if (more.length > 2000) more = more.slice(0, 2000) + '…';
                break;
              }
            }

            // === SPEAKERS ===
            // The "Deltagere" section lists speakers. Each speaker is typically
            // "Name, Role, Org" or just "Name" — we collect them as objects.
            const speakers = [];
            for (const el of allEls) {
              const t = (el.textContent || '').trim();
              if (t === 'Deltagere') {
                let sib = el.nextElementSibling;
                let safety = 0;
                while (sib && safety < 30) {
                  const sibText = (sib.textContent || '').trim();
                  if (!sibText) { sib = sib.nextElementSibling; safety++; continue; }
                  if (KNOWN_LABELS.has(sibText)) break;
                  const innerLabels = Array.from(sib.querySelectorAll('h1,h2,h3,h4,h5,h6'));
                  let hitSection = false;
                  for (const inner of innerLabels) {
                    if (KNOWN_LABELS.has((inner.textContent || '').trim())) {
                      hitSection = true; break;
                    }
                  }
                  if (hitSection) break;
                  // Each speaker may be in own element or comma-separated within one
                  // Try to split intelligently: name in bold/strong, then role/org follows
                  // Look for child structure
                  const strongEls = Array.from(sib.querySelectorAll('strong, b'));
                  if (strongEls.length > 0) {
                    // Multiple speakers as <strong>Name</strong>, role, org<br>...
                    for (const strong of strongEls) {
                      const name = (strong.textContent || '').trim();
                      if (!name) continue;
                      // Get text immediately after this strong, up to next strong or br
                      let after = "";
                      let node = strong.nextSibling;
                      while (node) {
                        if (node.nodeType === 1 && (node.tagName === 'STRONG' || node.tagName === 'B' || node.tagName === 'BR')) break;
                        if (node.nodeType === 3) after += node.textContent;
                        else if (node.nodeType === 1) after += (node.textContent || '');
                        node = node.nextSibling;
                      }
                      // Parse "Name, Role, Org" pattern from raw text
                      const cleaned = after.replace(/^[\s,;:]+/, '').replace(/[\s,;:]+$/, '').trim();
                      const sp = { name };
                      if (cleaned) {
                        const parts = cleaned.split(/,/).map(p => p.trim()).filter(Boolean);
                        if (parts.length > 0) sp.role = parts[0];
                        if (parts.length > 1) sp.org = parts.slice(1).join(', ');
                      }
                      speakers.push(sp);
                    }
                  } else {
                    // Fallback: treat each line as one speaker
                    const lines = sibText.split(/\n+/).map(l => l.trim()).filter(Boolean);
                    for (const line of lines) {
                      const parts = line.split(/,/).map(p => p.trim()).filter(Boolean);
                      if (parts.length === 0) continue;
                      const sp = { name: parts[0] };
                      if (parts.length > 1) sp.role = parts[1];
                      if (parts.length > 2) sp.org = parts.slice(2).join(', ');
                      speakers.push(sp);
                    }
                  }
                  sib = sib.nextElementSibling;
                  safety++;
                }
                break;
              }
            }

            return { themes, more, speakers: speakers.slice(0, 20) };
          });

          ev.themes = details.themes;
          ev.more = details.more;
          ev.speakers = details.speakers;
          fetched++;

          // Diagnostic: log first 3 events' DOM snippet if extraction empty
          if (diagnostic_logged < 3 && details.themes.length === 0 && !details.more && details.speakers.length === 0) {
            diagnostic_logged++;
            const snippet = await page.evaluate(() => {
              const html = document.body.innerHTML;
              const idx = html.indexOf('Tema');
              if (idx === -1) return '[no "Tema" found in HTML]';
              return html.substring(Math.max(0, idx - 50), Math.min(html.length, idx + 800));
            });
            console.log(`\n--- DIAGNOSTIC (${ev.url}) ---`);
            console.log(snippet.replace(/\s+/g, ' ').slice(0, 600));
            console.log(`--- end diagnostic ---\n`);
          }

          if (fetched % 50 === 0) console.log(`  ${fetched}/${toFetch.length} fetched (${errors} errors)`);
        } catch (err) {
          errors++;
          ev.themes = [];
          ev.more = "";
          ev.speakers = [];
        }
        await page.close();
      }));
    }
    await browser2.close();
    console.log(`  Done: ${fetched} fetched, ${errors} errors`);
  }

  // Apply cached details
  for (const ev of allEvents) {
    if (detailCache.has(ev.id)) {
      const cached = detailCache.get(ev.id);
      if (!ev.themes || ev.themes.length === 0) ev.themes = cached.themes;
      if (!ev.more) ev.more = cached.more;
      if (!ev.speakers || ev.speakers.length === 0) ev.speakers = cached.speakers;
    }
    if (!ev.themes) ev.themes = [];
    if (!ev.more) ev.more = "";
    if (!ev.speakers) ev.speakers = [];
  }

  // Build official theme catalog: all unique themes across all events
  const themeFreq = new Map();
  for (const ev of allEvents) {
    for (const t of (ev.themes || [])) {
      themeFreq.set(t, (themeFreq.get(t) || 0) + 1);
    }
  }
  const officialThemes = [...themeFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));
  console.log(`\nFound ${officialThemes.length} unique themes`);
  console.log(`Top 20:`, officialThemes.slice(0, 20).map(t => `${t.name} (${t.count})`).join(', '));

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
    themes: officialThemes,
    events: allEvents
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2));
  console.log(`\n✓ Wrote ${allEvents.length} events to ${OUT_FILE}`);
}

scrape().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
