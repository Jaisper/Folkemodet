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
    // Only treat as cached if we actually captured more/speakers before.
    // Events with only themes (from earlier runs) should be re-fetched to get more+speakers.
    const hasMore = e.more && e.more.length > 0;
    const hasSpeakers = e.speakers && Array.isArray(e.speakers) && e.speakers.length > 0;
    if (hasMore || hasSpeakers) {
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

  try {
    if (toFetch.length > 0) {
    const browser2 = await chromium.launch({ headless: true });
    const ctx2 = await browser2.newContext({
      userAgent: 'Mozilla/5.0 (compatible; FolkemodetScraper/1.0; github.com/Jaisper/Folkemodet)'
    });

    const CONCURRENCY = 4;
    let fetched = 0;
    let errors = 0;
    let diagnostic_logged = 0;
    const SAVE_INTERVAL = 200; // Save partial progress every N events

    // Process in batches
    for (let i = 0; i < toFetch.length; i += CONCURRENCY) {
      const batch = toFetch.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(async (ev) => {
        let page;
        try {
          page = await ctx2.newPage();
        } catch (e) {
          errors++;
          ev.themes = []; ev.more = ""; ev.speakers = [];
          return;
        }
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
            let more = "";
            // Find ANY element whose own text is exactly "Mere om" / "Beskrivelse"
            const findLabelEl = (labels) => {
              const els = Array.from(document.querySelectorAll('*'));
              for (const el of els) {
                // Skip large containers — we want the actual label element
                if (el.children.length > 2) continue;
                const t = (el.textContent || '').trim();
                if (labels.includes(t)) return el;
              }
              return null;
            };

            const collectAfter = (labelEl, maxParts) => {
              if (!labelEl) return "";
              const parts = [];
              // Walk up to find the element that has siblings (the label might be wrapped)
              let anchor = labelEl;
              // If label's parent only contains the label, step up
              while (anchor.parentElement &&
                     anchor.parentElement.children.length === 1 &&
                     anchor.parentElement.tagName !== 'BODY') {
                anchor = anchor.parentElement;
              }
              let sib = anchor.nextElementSibling;
              let safety = 0;
              while (sib && safety < (maxParts || 20)) {
                const txt = (sib.textContent || '').trim();
                if (txt) {
                  if (KNOWN_LABELS.has(txt)) break;
                  // Stop if sibling starts a new known section
                  const firstChild = (sib.querySelector('h1,h2,h3,h4,h5,h6')?.textContent || '').trim();
                  if (KNOWN_LABELS.has(firstChild)) break;
                  parts.push(txt);
                }
                sib = sib.nextElementSibling;
                safety++;
              }
              return parts.join('\n\n').trim();
            };

            const mereEl = findLabelEl(['Mere om', 'Beskrivelse']);
            more = collectAfter(mereEl, 15);
            if (more.length > 2500) more = more.slice(0, 2500) + '…';

            // === SPEAKERS ===
            // Each speaker on a Folkemødet page is a separate child element.
            // The name sits in a <strong>/<b>/<a>, the role+org follows as text.
            // Reading textContent of the whole block loses separators, so we
            // walk the DOM and read each speaker element individually.
            const speakers = [];
            const deltEl = findLabelEl(['Deltagere']);
            if (deltEl) {
              // Find the content container after the label
              let anchor = deltEl;
              while (anchor.parentElement &&
                     anchor.parentElement.children.length === 1 &&
                     anchor.parentElement.tagName !== 'BODY') {
                anchor = anchor.parentElement;
              }

              // Collect candidate speaker elements from following siblings
              const speakerEls = [];
              let sib = anchor.nextElementSibling;
              let safety = 0;
              while (sib && safety < 40) {
                const txt = (sib.textContent || '').trim();
                if (txt && KNOWN_LABELS.has(txt)) break;
                const innerHead = (sib.querySelector('h1,h2,h3,h4,h5,h6')?.textContent || '').trim();
                if (KNOWN_LABELS.has(innerHead)) break;
                if (txt) speakerEls.push(sib);
                sib = sib.nextElementSibling;
                safety++;
              }

              // For each speaker container, try to find sub-elements (one per person)
              const parseSpeakerEl = (el) => {
                // A speaker usually has a bold/strong/link name + trailing text
                const nameEl = el.querySelector('strong, b, a, [class*="name" i]');
                if (nameEl) {
                  const name = (nameEl.textContent || '').trim();
                  // Get text AFTER the name element within this container
                  let rest = (el.textContent || '').trim();
                  if (rest.startsWith(name)) rest = rest.slice(name.length);
                  rest = rest.replace(/^[\s,;:]+/, '').replace(/[\s,;:]+$/, '').trim();
                  const sp = { name };
                  if (rest) {
                    const parts = rest.split(/,/).map(p => p.trim()).filter(Boolean);
                    if (parts.length > 0) sp.role = parts[0];
                    if (parts.length > 1) sp.org = parts.slice(1).join(', ');
                  }
                  return sp;
                }
                // No bold name — treat whole text as "Name, Role, Org"
                const txt = (el.textContent || '').trim();
                if (!txt) return null;
                const parts = txt.split(/,/).map(p => p.trim()).filter(Boolean);
                const sp = { name: parts[0] };
                if (parts.length > 1) sp.role = parts[1];
                if (parts.length > 2) sp.org = parts.slice(2).join(', ');
                return sp;
              };

              for (const el of speakerEls) {
                // Each container might hold MULTIPLE speakers as separate child rows
                const childRows = Array.from(el.children).filter(c => {
                  const ct = (c.textContent || '').trim();
                  return ct.length > 2;
                });
                if (childRows.length > 1 && el.querySelectorAll('strong, b, a').length > 1) {
                  // Multiple speakers: one per child
                  for (const row of childRows) {
                    const sp = parseSpeakerEl(row);
                    if (sp && sp.name) speakers.push(sp);
                  }
                } else {
                  const sp = parseSpeakerEl(el);
                  if (sp && sp.name) speakers.push(sp);
                }
              }
            }

            return { themes, more, speakers: speakers.slice(0, 25) };
          });

          ev.themes = details.themes;
          ev.more = details.more;
          ev.speakers = details.speakers;
          fetched++;

          // Diagnostic: log first 3 events' DOM structure around the labels we're missing
          if (diagnostic_logged < 3 && (!details.more || details.speakers.length === 0)) {
            diagnostic_logged++;
            const diag = await page.evaluate(() => {
              const findAround = (label) => {
                // Find ANY element whose trimmed text starts with the label
                const els = Array.from(document.querySelectorAll('*'));
                for (const el of els) {
                  const t = (el.textContent || '').trim();
                  // Element whose OWN direct text (not children) is the label
                  const ownText = Array.from(el.childNodes)
                    .filter(n => n.nodeType === 3)
                    .map(n => n.textContent.trim()).join('');
                  if (ownText === label || t === label) {
                    return `TAG=${el.tagName} CLASS="${el.className}" PARENT=${el.parentElement?.tagName} | nextSib=${el.nextElementSibling?.tagName}:"${(el.nextElementSibling?.textContent||'').trim().slice(0,80)}"`;
                  }
                }
                return '[label not found as standalone element]';
              };
              return {
                mereOm: findAround('Mere om'),
                deltagere: findAround('Deltagere'),
                tema: findAround('Tema')
              };
            });
            console.log(`\n--- DIAG (${ev.url}) ---`);
            console.log(`  Mere om:   ${diag.mereOm}`);
            console.log(`  Deltagere: ${diag.deltagere}`);
            console.log(`  Tema:      ${diag.tema}`);
            console.log(`--- end ---\n`);
          }

          if (fetched % 50 === 0) console.log(`  ${fetched}/${toFetch.length} fetched (${errors} errors)`);
        } catch (err) {
          errors++;
          ev.themes = [];
          ev.more = "";
          ev.speakers = [];
          if (errors < 5) console.log(`  Error on ${ev.url}: ${err.message}`);
        }
        try { await page.close(); } catch {}
      }));

      // Periodic save so we don't lose work if the run gets killed
      if ((i + CONCURRENCY) % SAVE_INTERVAL < CONCURRENCY && i > 0) {
        try {
          // Apply themes/more/speakers from in-progress data to allEvents
          // (they are already mutated in place since toFetch points to same objects)
          fs.writeFileSync(OUT_FILE + '.partial', JSON.stringify({
            partial: true,
            progress: `${fetched}/${toFetch.length}`,
            events: allEvents
          }, null, 2));
          console.log(`  💾 Saved partial progress at ${fetched} events`);
        } catch (e) {
          console.log(`  Could not save partial: ${e.message}`);
        }
      }
    }
    await browser2.close();
    console.log(`  Done: ${fetched} fetched, ${errors} errors`);
    // Clean up partial file if final save will happen
    try { fs.unlinkSync(OUT_FILE + '.partial'); } catch {}
    }
  } catch (phaseErr) {
    console.error(`\n⚠ Phase 2 hit a fatal error: ${phaseErr.message}`);
    console.error('Proceeding to write whatever data was collected so far.');
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
