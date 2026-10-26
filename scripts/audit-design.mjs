/**
 * Brutalist design audit + screenshot pass.
 *
 * Two jobs:
 *   1. Screenshots of every page at every supported width (evidence, and a way
 *      for a human to review the composition quickly).
 *   2. Objective checks on the design system: that the hard frames, crop marks,
 *      section numerals and section textures are actually painted, that the
 *      press interaction moves a control into its shadow, that the player is
 *      framed inline and bare in fullscreen, that contrast still passes AA in
 *      both themes, and that nothing overflows at any width.
 *
 * Read-only: the public site is enough, no owner session required.
 *
 *   npm run dev:full      # terminal 1
 *   npm run audit:design
 */
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync } from 'node:fs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:8787';
const BROWSER_PATH =
  process.env.BROWSER_PATH ?? 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe';
const OUT = process.env.SHOT_DIR ?? 'verification/design';
mkdirSync(OUT, { recursive: true });

const WIDTHS = [320, 375, 390, 768, 1024, 1366, 1920];

// The detail route has to be a game that is actually published. Nothing is
// seeded into the catalogue, so it is discovered from the API (or supplied).
const catalogue = await fetch(`${BASE}/api/catalogue`)
  .then((response) => response.json())
  .catch(() => ({ games: [] }));
const GAME_SLUG = process.env.AUDIT_GAME_SLUG ?? catalogue.games?.[0]?.slug ?? null;

const ROUTES = [
  { path: '/', name: 'home' },
  { path: '/games', name: 'library' },
  { path: GAME_SLUG ? `/games/${GAME_SLUG}` : '/games', name: 'detail' },
  { path: '/about', name: 'about' },
  { path: '/contact', name: 'contact' },
  { path: '/privacy', name: 'privacy' },
];

let failures = 0;
let checks = 0;
function check(label, ok, detail = '') {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
}

/**
 * "Hard" is the property under test, not the colour: a hard shadow has an
 * offset, a zero blur and a zero spread — in whichever theme is active. Both
 * the ink and the accent variants qualify; a soft blur deliberately does not.
 */
function isHardShadow(value, offset = 7) {
  if (!value || value === 'none') return false;
  return value.split(/,(?![^(]*\))/).some((layer) => {
    const parts = layer.trim().split(/\s+/);
    const numbers = parts.filter((part) => /^-?[\d.]+px$/.test(part)).map(parseFloat);
    return numbers.length === 4 && Math.abs(numbers[0]) === offset && Math.abs(numbers[1]) === offset && numbers[2] === 0 && numbers[3] === 0;
  });
}

/**
 * Computed colours arrive in whatever space the browser resolved them to —
 * rgb(), rgba(), or a modern `color(srgb …)` if the value came through
 * color-mix(). Anything else is reported as unknown rather than crashing the
 * ratio maths into NaN.
 */
function parseColour(value) {
  const text = (value ?? '').trim();
  const hex = /^#([0-9a-f]{6})$/i.exec(text);
  if (hex) {
    const digits = hex[1];
    return [0, 2, 4].map((index) => parseInt(digits.slice(index, index + 2), 16));
  }
  const rgb = /rgba?\(([^)]+)\)/.exec(text);
  if (rgb) {
    const parts = rgb[1].split(/[,/\s]+/).filter(Boolean).map(Number);
    if (parts.length >= 3 && parts.slice(0, 3).every((n) => Number.isFinite(n))) return parts.slice(0, 3);
    return null;
  }
  const srgb = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(text);
  if (srgb) return srgb.slice(1, 4).map((n) => Math.round(parseFloat(n) * 255));
  return null;
}

const luminance = ([r, g, b]) => {
  const channel = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};

const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};

const browser = await chromium.launch({ executablePath: BROWSER_PATH });

/**
 * Waits for the opening card to leave before anything is measured.
 *
 * Every page in this audit is a genuine load, so the card is genuinely there —
 * and reading the design system through an opaque overlay would measure the
 * overlay instead of the page. The wait is bounded: a card that overstays its
 * welcome is a failure the dedicated opening checks below report, not something
 * this helper should hang on.
 */
async function settle(page) {
  await page.waitForSelector('[data-boot]', { state: 'detached', timeout: 9000 }).catch(() => {});
  await page.waitForTimeout(120);
}

/* ------------------------------------------------------------- screenshots */

for (const width of WIDTHS) {
  const context = await browser.newContext({
    viewport: { width, height: width < 500 ? 780 : 900 },
    deviceScaleFactor: 1,
    reducedMotion: 'no-preference',
  });
  const page = await context.newPage();
  for (const route of ROUTES) {
    await page.goto(`${BASE}${route.path}`, { waitUntil: 'networkidle' });
    await settle(page);
    await page.waitForTimeout(250);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    check(`overflow: ${route.name} at ${width}px`, overflow <= 1, `${overflow}px`);
    await page.screenshot({ path: `${OUT}/${route.name}-${width}.png`, fullPage: width >= 1024 });
  }
  await context.close();
}

/* -------------------------------------------------- design-system checks */

const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
await settle(page);
await page.waitForSelector('.game-card, .arcade-empty');

// With no published game the screenshot pass above is still useful evidence,
// but the card, player and detail measurements describe an empty site. Say so
// rather than fabricating a fixture or failing on elements that should not be
// there by design.
if ((await page.locator('.game-card').count()) === 0) {
  await context.close();
  await browser.close();
  console.log('\nNo published game: screenshot pass complete, detailed design checks skipped.');
  console.log(`Screenshots: ${OUT}/`);
  process.exit(0);
}

const home = await page.evaluate(() => {
  const css = (selector, pseudo) => {
    const node = document.querySelector(selector);
    return node ? getComputedStyle(node, pseudo) : null;
  };
  const lead = document.querySelector('.game-card--banner');
  const primary = document.querySelector('.btn--primary');
  return {
    theme: document.documentElement.getAttribute('data-theme') ?? 'system',
    sectionIndex: document.querySelector('.sec-head__index')?.textContent?.trim() ?? null,
    sectionIndexStroke: css('.sec-head__index')?.webkitTextStrokeWidth ?? null,
    sectionIndexHidden: document.querySelector('.sec-head__index')?.getAttribute('aria-hidden') ?? null,
    secHeadRule: css('.sec-head', '::before')?.backgroundImage?.slice(0, 60) ?? null,
    heroArtBorder: css('.hero__frame')?.borderTopWidth ?? null,
    heroArtShadow: css('.hero__frame')?.boxShadow ?? null,
    // The mis-registered colour blocks behind the mount: the hero's equivalent
    // of the old crop marks.
    heroFrameBlocks: document.querySelectorAll('.hero__frame-block').length,
    heroFrameArt: document.querySelector('.hero__frame-art img')?.getAttribute('src') ?? null,
    heroNote: document.querySelector('.hero__note')?.textContent?.trim() ?? null,
    leadBorder: lead ? getComputedStyle(lead).borderTopWidth : null,
    leadShadow: lead ? getComputedStyle(lead).boxShadow : null,
    primaryBorder: primary ? getComputedStyle(primary).borderTopWidth : null,
    primaryShadow: primary ? getComputedStyle(primary).boxShadow : null,
    primaryRadius: primary ? getComputedStyle(primary).borderTopLeftRadius : null,
    gridTexture: css('.tex--grid', '::before')?.backgroundImage?.includes('gradient') ?? false,
    stripeTexture: css('.tex--stripe', '::before')?.backgroundImage?.includes('gradient') ?? false,
    halftoneTexture: css('.tex--halftone', '::before')?.backgroundImage?.includes('gradient') ?? false,
    grain: getComputedStyle(document.documentElement, '::after').backgroundImage.includes('data:'),
    monoLabels: document.querySelectorAll('.hero__stamp, .hero__spine, .sec-head__index, .spotlight-card__label').length,
    featureIndexes: [...document.querySelectorAll('.feature-strip__index')].map((n) => n.textContent.trim()),
    heroCols: getComputedStyle(document.querySelector('.hero__spotlight')).gridTemplateColumns,
    heroColWidths: [...document.querySelectorAll('.hero__spotlight > *')].map((node) =>
      Math.round(node.getBoundingClientRect().width),
    ),
    heroAsideCards: document.querySelectorAll('.hero__aside .spotlight-card, .hero__aside .site-note').length,
    heroSocials: document.querySelectorAll('.hero__aside .social-dot').length,
    siteNoteLink: Boolean(document.querySelector('.site-note__link')),
    socialLinksPublished: Number(document.querySelector('[data-social-count]')?.getAttribute('data-social-count') ?? -1),
    bannerWidth: Math.round(document.querySelector('.game-card--banner').getBoundingClientRect().width),
    bannerHeight: Math.round(document.querySelector('.game-card--banner').getBoundingClientRect().height),
    rowCols: getComputedStyle(document.querySelector('.spotlight__grid')).gridTemplateColumns,
    rowCount: document.querySelectorAll('.game-card--row').length,
    rowHeight: Math.round(document.querySelector('.game-card--row').getBoundingClientRect().height),
    headerSearchWidth: Math.round(document.querySelector('.search-trigger').getBoundingClientRect().width),
    themePillHalves: document.querySelectorAll('.theme-pill__half').length,
    themePillActive: document.querySelectorAll('.theme-pill__half[aria-pressed="true"]').length,
    themePillLabels: [...document.querySelectorAll('.theme-pill__half')].map((node) => node.getAttribute('aria-label')),
    displayGradient: css('.hero__title-accent')?.backgroundImage?.startsWith('linear-gradient') ?? false,
    displayStopColour: css('.hero__title-accent')?.color ?? null,
    reasonIndexes: [...document.querySelectorAll('.reason__index')].map((n) => n.textContent.trim()),
  };
});

check('hero: framed artwork with an ink border', home.heroArtBorder === '3px', String(home.heroArtBorder));
check('hero: hard offset shadow on the artwork', isHardShadow(home.heroArtShadow), home.heroArtShadow ?? '');
check('hero: the mount stands on offset colour blocks', home.heroFrameBlocks === 3, `${home.heroFrameBlocks} block(s)`);
check('hero: the mount shows real catalogue artwork', Boolean(home.heroFrameArt), home.heroFrameArt ?? 'none');
check('hero: the hand-written tagline is beside the mount', /Small games/.test(home.heroNote ?? ''), home.heroNote ?? 'missing');
check('hero: three columns at 1440px', home.heroCols.trim().split(/\s+/).length === 3, home.heroCols);
check(
  'hero: the statement, the mount and the cards each get real width',
  home.heroColWidths.length === 3 && home.heroColWidths.every((width) => width >= 200),
  home.heroColWidths.join(' / '),
);
check(
  'hero: the statement is the widest column',
  home.heroColWidths[0] > home.heroColWidths[1] && home.heroColWidths[0] > home.heroColWidths[2],
  home.heroColWidths.join(' / '),
);
check('hero: the right column carries the featured card and the site note', home.heroAsideCards === 2, `${home.heroAsideCards} card(s)`);
// The social row is content: it exists in the hero exactly when the owner has
// published a link, so an empty row is not a failure — but a hero social link
// outside the hero would be.
check(
  'hero: the social row is in the hero when links are published',
  home.heroSocials >= 1 || home.socialLinksPublished <= 0,
  `${home.heroSocials} in the hero; a published band reports ${home.socialLinksPublished}`,
);
check('hero: the site note offers the About page', home.siteNoteLink, home.siteNoteLink ? 'Learn more' : 'missing');
check('header: the search reads as a field, not an icon', home.headerSearchWidth >= 140, `${home.headerSearchWidth}px`);
check(
  'header: the theme control offers both paper palettes, one active',
  home.themePillHalves === 2 && home.themePillActive === 1,
  `${home.themePillHalves} options, ${home.themePillActive} active · ${home.themePillLabels.join(', ')}`,
);
check('headline: the second line carries the display gradient', home.displayGradient, home.displayStopColour ?? '');
check('editorial: oversized outline section numeral', /^0[0-9]$/.test(home.sectionIndex ?? ''), String(home.sectionIndex));
check('editorial: numeral stroke applied', parseFloat(home.sectionIndexStroke ?? '0') >= 2, String(home.sectionIndexStroke));
check('editorial: numeral is decorative only', home.sectionIndexHidden === 'true', String(home.sectionIndexHidden));
check('editorial: dashed rule above the head', /repeating-linear-gradient/.test(home.secHeadRule ?? ''));
check('cards: lead card wears the heavy frame', parseFloat(home.leadBorder ?? '0') >= 2.4, String(home.leadBorder));
check('cards: lead card casts a hard shadow', isHardShadow(home.leadShadow), home.leadShadow ?? '');
check('buttons: ink outline on the primary action', parseFloat(home.primaryBorder ?? '0') >= 2, String(home.primaryBorder));
check('buttons: hard shadow on the primary action', isHardShadow(home.primaryShadow, 4), home.primaryShadow ?? '');
check('buttons: square corners', parseFloat(home.primaryRadius ?? '9') <= 6, String(home.primaryRadius));
check('texture: technical grid band', home.gridTexture);
check('texture: diagonal stripe band', home.stripeTexture);
check('texture: halftone band', home.halftoneTexture);
check('texture: paper grain layer present', home.grain);
check('labels: mono stamps and rails in use', home.monoLabels >= 4, `${home.monoLabels}`);
check('labels: value propositions are numbered', home.featureIndexes.join(',') === '01,02,03', home.featureIndexes.join(','));
check('labels: contact reasons are numbered', home.reasonIndexes.join(',') === '01,02,03,04', home.reasonIndexes.join(','));
check(
  'composition: the banner is the entry point and the rows are compact',
  home.bannerHeight > home.rowHeight * 2 && home.bannerWidth > home.rowHeight * 2,
  `banner ${home.bannerWidth}x${home.bannerHeight}, row ${home.rowHeight}`,
);
check(
  'composition: supporting cards form a 2-column field',
  home.rowCols.trim().split(/\s+/).length === 2,
  home.rowCols,
);
check('composition: four compact rows are offered when the catalogue allows', home.rowCount >= 1, `${home.rowCount} rows`);

/* Press interaction: the control must move *into* its shadow on hover. */
const press = await page.evaluate(() => {
  const s = getComputedStyle(document.querySelector('.hero__actions .btn--primary'));
  return { transform: s.transform, shadow: s.boxShadow };
});
check('interaction: idle button is untranslated', press.transform === 'none' || press.transform === 'matrix(1, 0, 0, 1, 0, 0)', press.transform);

const hoverBox = await page.locator('.hero__actions .btn--primary').boundingBox();
await page.mouse.move(hoverBox.x + hoverBox.width / 2, hoverBox.y + hoverBox.height / 2);
await page.waitForTimeout(300);
const hovered = await page.evaluate(() => {
  const s = getComputedStyle(document.querySelector('.hero__actions .btn--primary'));
  return { transform: s.transform, shadow: s.boxShadow };
});
check('interaction: hovering lifts a button off its shadow', hovered.transform !== 'none' && hovered.transform !== press.transform, hovered.transform);
check('interaction: the shadow grows on hover', hovered.shadow !== press.shadow);

/* ------------------------------------------------------ the player frame -- */

await page.goto(`${BASE}/games/${GAME_SLUG}`, { waitUntil: 'networkidle' });
await page.waitForSelector('.player__frame');

const idleStage = await page.evaluate(() => {
  const s = getComputedStyle(document.querySelector('.player__frame'));
  return { border: s.borderTopWidth, radius: s.borderTopLeftRadius };
});
check(
  'player: the stage is framed in the page',
  parseFloat(idleStage.border) >= 2 && parseFloat(idleStage.radius) <= 8,
  `${idleStage.border} / ${idleStage.radius}`,
);

/* The toolbar only exists once the build is running, so start it for real. */
await page.locator('.player__placeholder .btn--primary').click();
await page.waitForSelector('.player__toolbar', { timeout: 30000 });
await page.waitForTimeout(600);
const running = await page.evaluate(() => {
  const toolbar = document.querySelector('.player__toolbar');
  const button = toolbar.querySelector('button');
  const s = getComputedStyle(button);
  return {
    rule: getComputedStyle(toolbar).borderBottomWidth,
    font: s.fontFamily.split(',')[0].replace(/"/g, ''),
    transform: s.textTransform,
    radius: s.borderTopLeftRadius,
  };
});
check('player: the toolbar carries a hard rule', parseFloat(running.rule) >= 2, String(running.rule));
check('player: toolbar controls are labelled like instruments', /mono/i.test(running.font) && running.transform === 'uppercase', `${running.font} / ${running.transform}`);
check('player: toolbar controls are rectangular', parseFloat(running.radius) <= 6, String(running.radius));

/* The fullscreen reset must exist in the stylesheet (matched by selector, since
   it is a plain rule rather than one inside a media query). */
const fullscreenRules = await page.evaluate(() => {
  const hits = [];
  for (const sheet of document.styleSheets) {
    let rules = [];
    try {
      rules = [...sheet.cssRules];
    } catch {
      continue;
    }
    for (const rule of rules) {
      if (rule.selectorText?.includes('.player__frame') && rule.selectorText.includes('fullscreen')) {
        hits.push(rule.selectorText);
      }
    }
  }
  return hits;
});
check('player: a fullscreen reset exists in the stylesheet', fullscreenRules.length >= 1, fullscreenRules.join(' | '));

/* And it must actually apply: a real Fullscreen API call, then a bare stage. */
const liveFullscreen = await page.evaluate(async () => {
  const frame = document.querySelector('.player__frame');
  await frame.requestFullscreen?.();
  await new Promise((resolve) => setTimeout(resolve, 400));
  const s = getComputedStyle(frame);
  const state = {
    active: document.fullscreenElement !== null,
    border: s.borderTopWidth,
    radius: s.borderTopLeftRadius,
    shadow: s.boxShadow,
  };
  await document.exitFullscreen?.();
  await new Promise((resolve) => setTimeout(resolve, 250));
  return state;
});
check('player: fullscreen engages', liveFullscreen.active, String(liveFullscreen.active));
check(
  'player: fullscreen strips the frame (border 0, radius 0)',
  parseFloat(liveFullscreen.border) === 0 && parseFloat(liveFullscreen.radius) === 0 && liveFullscreen.shadow === 'none',
  `${liveFullscreen.border} / ${liveFullscreen.radius} / ${liveFullscreen.shadow}`,
);

/* Contrast in every theme the site offers, including the mono labels. */
for (const theme of ['dark', 'light']) {
  const themeContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: theme === 'light' ? 'light' : 'dark',
  });
  const themePage = await themeContext.newPage();
  await themePage.addInitScript((value) => {
    localStorage.setItem('hg.theme.v1', value);
    localStorage.setItem('hg.privacy.v1', 'acknowledged');
  }, theme);
  await themePage.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await settle(themePage);
  await themePage.waitForSelector('.game-card');
  const colours = await themePage.evaluate(() => {
    const body = getComputedStyle(document.body);
    const read = (selector) => getComputedStyle(document.querySelector(selector));
    return {
      page: body.backgroundColor,
      text: body.color,
      muted: read('.hero__paragraph').color,
      stamp: read('.feature-strip__index').color,
      rail: read('.hero__stamp').color,
      chip: read('.chip--accent').color,
      chipBg: read('.chip--accent').backgroundColor,
      leadBorder: read('.game-card--banner').borderTopColor,
      leadBorderWidth: read('.game-card--banner').borderTopWidth,
      leadShadow: read('.game-card--banner').boxShadow,
      primaryShadow: read('.btn--primary').boxShadow,
    };
  });

  const pageBg = parseColour(colours.page);
  const pairs = [
    ['body text', colours.text, pageBg],
    ['supporting text', colours.muted, pageBg],
    ['mono index labels', colours.stamp, pageBg],
    ['mono rail labels', colours.rail, pageBg],
    // A chip is a printed block of colour, so its label is measured against the
    // block it sits on — the page behind it is not what a reader sees.
    ['chip labels', colours.chip, parseColour(colours.chipBg) ?? pageBg],
  ];
  for (const [label, value, background] of pairs) {
    const fg = parseColour(value);
    if (!fg) {
      check(`${theme}: ${label} contrast is measurable`, false, `unparsed colour ${value}`);
      continue;
    }
    const ratio = contrast(fg, background);
    check(`${theme}: ${label} meet AA`, ratio >= 4.5, `${ratio.toFixed(2)}:1`);
  }

  /* The display gradient is a colour ramp for the largest type on the site, so
     each stop is measured against the page it is printed on. */
  const gradientStops = await themePage.evaluate(() => {
    const style = getComputedStyle(document.querySelector('.hero__title-accent')).backgroundImage;
    return style.match(/rgba?\([^)]+\)/g) ?? [];
  });
  const stops = gradientStops.map(parseColour).filter(Boolean);
  check(
    `${theme}: the headline gradient has real stops`,
    stops.length >= 3,
    `${stops.length} stop(s)`,
  );
  const worstStop = stops.reduce((worst, stop) => Math.min(worst, contrast(stop, pageBg)), Infinity);
  check(
    `${theme}: every headline gradient stop clears AA for large text`,
    worstStop >= 3,
    `${worstStop.toFixed(2)}:1`,
  );

  /* The hard frames must survive the theme switch, not just the default one. */
  check(
    `${theme}: lead card keeps its hard frame`,
    isHardShadow(colours.leadShadow) && parseFloat(colours.leadBorderWidth) >= 2.4,
    `${colours.leadBorderWidth} ${colours.leadShadow.slice(0, 40)}`,
  );
  check(`${theme}: primary button keeps its hard shadow`, isHardShadow(colours.primaryShadow, 4), colours.primaryShadow.slice(0, 60));

  await themeContext.close();
}

/* Reduced motion: movement stops, the composition and the frames stay. */
const reducedContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
const reducedPage = await reducedContext.newPage();
await reducedPage.goto(`${BASE}/`, { waitUntil: 'networkidle' });
await settle(reducedPage);
await reducedPage.waitForSelector('.game-card');
const still = await reducedPage.evaluate(() => {
  const deco = document.querySelector('.deco-field');
  const mark = document.querySelector('.deco-field .deco');
  const btn = document.querySelector('.hero__actions .btn--primary');
  const lead = document.querySelector('.game-card--banner');
  return {
    decoAnimation: deco ? getComputedStyle(deco).animationName : 'none',
    decoOpacity: deco ? getComputedStyle(deco).opacity : '0',
    markTransform: mark ? getComputedStyle(mark).transform : 'missing',
    markAnimation: mark ? getComputedStyle(mark).animationName : 'missing',
    duration: getComputedStyle(btn).transitionDuration,
    leadBorder: getComputedStyle(lead).borderTopWidth,
    leadShadow: getComputedStyle(lead).boxShadow,
  };
});
await reducedPage.waitForTimeout(700);
const stillAfter = await reducedPage.evaluate(() => {
  const mark = document.querySelector('.deco-field .deco');
  return mark ? getComputedStyle(mark).transform : 'missing';
});
check('reduced motion: decorative animation stops', still.decoAnimation === 'none', still.decoAnimation);
check(
  'reduced motion: marks are frozen, not merely unanimated',
  still.markAnimation === 'none' && still.markTransform !== 'missing' && still.markTransform === stillAfter,
  still.markTransform === stillAfter ? 'transform unchanged over 700 ms' : 'a mark moved',
);
check('reduced motion: the composition stays visible', parseFloat(still.decoOpacity) > 0, still.decoOpacity);
check(
  'reduced motion: transitions are neutralised',
  still.duration
    .split(',')
    .every((value) => /e-0?[4-9]|0\.0000/.test(value.trim()) || parseFloat(value) <= 0.001),
  still.duration,
);
check(
  'reduced motion: hard frames are unaffected',
  parseFloat(still.leadBorder) >= 2 && isHardShadow(still.leadShadow),
  `${still.leadBorder} ${still.leadShadow.slice(0, 40)}`,
);

/* Keyboard focus must stay unmistakable on the new geometry. */
await reducedPage.goto(`${BASE}/games`, { waitUntil: 'networkidle' });
await settle(reducedPage);
await reducedPage.keyboard.press('Tab');
const focus = await reducedPage.evaluate(() => {
  const el = document.activeElement;
  const s = getComputedStyle(el);
  return { tag: el?.tagName, shadow: s.boxShadow, outline: `${s.outlineStyle} ${s.outlineWidth}` };
});
check('a11y: the first tab stop shows a focus ring', /rgb/.test(focus.shadow) || /solid/.test(focus.outline), `${focus.tag} ${focus.outline}`);

await reducedContext.close();

/* ==========================================================================
   THE OPENING SEQUENCE

   A fresh context, so this really is a first visit: the card, the greeting
   rotation, the step counter, and the handover to the typed headline.
   ========================================================================== */

const bootContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
const bootPage = await bootContext.newPage();
const bootErrors = [];
bootPage.on('pageerror', (error) => bootErrors.push(error.message));

const bootStartedAt = Date.now();
await bootPage.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await bootPage.waitForSelector('[data-boot]', { timeout: 4000 }).catch(() => {});

const card = await bootPage.evaluate(() => {
  const node = document.querySelector('[data-boot]');
  if (!node) return { present: false };
  const greeting = node.querySelector('[data-boot-greeting]');
  const centre = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
  const style = getComputedStyle(node);
  const deep = getComputedStyle(document.documentElement).getPropertyValue('--bg-deep').trim();
  return {
    present: true,
    step: Number(node.getAttribute('data-boot-step')),
    total: Number(node.getAttribute('data-boot-total')),
    pending: node.querySelector('[data-boot-pending]')?.textContent?.trim() ?? '',
    barTransform: node.querySelector('[data-boot-bar]')?.style.transform ?? '',
    greetingText: greeting?.textContent?.trim() ?? '',
    greetingHidden: greeting?.getAttribute('aria-hidden') ?? null,
    greetingLang: greeting?.querySelector('span')?.getAttribute('lang') ?? null,
    greetingStack: getComputedStyle(greeting?.querySelector('span') ?? node).fontFamily,
    focusables: node.querySelectorAll('a[href], button, input, select, textarea, [tabindex]').length,
    percent: /%/.test(node.innerText),
    inert: document.getElementById('root').inert === true,
    topmostInsideCard: Boolean(centre?.closest('[data-boot]')),
    zIndex: style.zIndex,
    brand: node.querySelector('.boot__brand')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    tagline: node.querySelector('.boot__tagline')?.textContent?.trim() ?? '',
    barBorder: getComputedStyle(node.querySelector('.boot__bar') ?? node).borderTopWidth,
    barFillColour: getComputedStyle(node.querySelector('.boot__bar-fill') ?? node).backgroundColor,
    barFillGradient: getComputedStyle(node.querySelector('.boot__bar-fill') ?? node).backgroundImage,
    plateMark: getComputedStyle(node, '::after').borderTopStyle,
    textColours: {
      brand: getComputedStyle(node.querySelector('.boot__brand')).color,
      tagline: getComputedStyle(node.querySelector('.boot__tagline')).color,
      status: getComputedStyle(node.querySelector('.boot__status')).color,
    },
    background: deep,
  };
});

check('opening: the card is up while the app initialises', card.present === true);
check(
  'opening: it reports real steps, not a fabricated percentage',
  Number.isFinite(card.total) && card.total >= 2 && card.step >= 0 && card.step <= card.total && !card.percent,
  `step ${card.step}/${card.total}, pending "${card.pending}"`,
);
check(
  'opening: the progress bar reflects those steps',
  /scaleX\((\d*\.?\d+)\)/.test(card.barTransform) &&
    Math.abs(parseFloat(/scaleX\(([\d.]+)\)/.exec(card.barTransform)?.[1] ?? '-1') - card.step / card.total) < 0.01,
  card.barTransform,
);
check('opening: the page underneath is not interactive', card.inert && card.topmostInsideCard);
check('opening: the card holds nothing focusable to trap a keyboard', card.focusables === 0, `${card.focusables}`);
check('opening: it sits above every other layer', Number(card.zIndex) >= 120, card.zIndex);
check(
  'opening: the greeting is decoration, the status is the announcement',
  card.greetingHidden === 'true' && card.pending.length > 0,
  `${card.greetingHidden} / "${card.pending}"`,
);
check('opening: the card carries the studio identity', /Hemang Gupta/i.test(card.brand), card.brand);
check('opening: the tagline is present', card.tagline.length > 0, card.tagline);

/* The card is part of the paper system, not a generic splash screen: the
   greeting speaks in the editorial serif, the bar is a printed rule that fills
   with flat colour, and the screen edge carries a plate mark. */
check(
  'opening: the greeting is set in the editorial serif',
  /Fraunces/i.test(card.greetingStack),
  card.greetingStack.split(',')[0],
);
check(
  'opening: the progress bar is an ink rule, not a light strip',
  parseFloat(card.barBorder) >= 2 && card.barFillGradient === 'none',
  `${card.barBorder} border · fill ${card.barFillGradient === 'none' ? card.barFillColour : 'gradient'}`,
);
check('opening: the screen carries a printer’s plate mark', card.plateMark !== 'none', card.plateMark);

/* Contrast inside the card, against the deep background it is drawn on. */
{
  const deep = parseColour(card.background);
  for (const [label, value] of Object.entries(card.textColours)) {
    const fg = parseColour(value);
    check(
      `opening: ${label} text clears AA on the card`,
      Boolean(fg) && Boolean(deep) && contrast(fg, deep) >= 4.5,
      fg && deep ? `${contrast(fg, deep).toFixed(2)}:1` : `unparsed ${value}`,
    );
  }
}

/* The greeting must actually change, and change script. */
const greetingsSeen = [];
while (Date.now() - bootStartedAt < 6000) {
  const snapshot = await bootPage
    .evaluate(() => {
      const node = document.querySelector('[data-boot]');
      if (!node) return null;
      const greeting = node.querySelector('[data-boot-greeting] span');
      return { text: greeting?.textContent?.trim() ?? '', lang: greeting?.getAttribute('lang') ?? '' };
    })
    .catch(() => null);
  if (!snapshot) break;
  if (snapshot.text && !greetingsSeen.some((entry) => entry.text === snapshot.text)) greetingsSeen.push(snapshot);
  await bootPage.waitForTimeout(150);
}
check(
  'opening: the greeting changes while the card is up',
  greetingsSeen.length >= 2,
  greetingsSeen.map((entry) => entry.text).join(', '),
);

/* Every greeting the site ships, rendered in the greeting stack. */
const shippedGreetings = [...readFileSync('src/lib/boot.ts', 'utf8').matchAll(/text: '([^']+)', lang: '([^']+)'/g)].map(
  ([, text, lang]) => ({ text, lang }),
);
check('opening: the greeting set is the one the source ships', shippedGreetings.length >= 8, `${shippedGreetings.length} greetings`);

const glyphs = await bootPage.evaluate((list) => {
  const stack = getComputedStyle(document.documentElement).getPropertyValue('--font-greeting').trim();
  const canvas = document.createElement('canvas');
  canvas.width = 72;
  canvas.height = 72;
  const context = canvas.getContext('2d');
  const rows = [];
  for (const entry of list) {
    context.font = `700 56px ${stack}`;
    const width = context.measureText(entry.text).width;
    const chars = [];
    for (const character of [...entry.text]) {
      context.clearRect(0, 0, 72, 72);
      context.font = `700 56px ${stack}`;
      context.textBaseline = 'top';
      context.fillStyle = '#fff';
      context.fillText(character, 6, 6);
      const data = context.getImageData(0, 0, 72, 72).data;
      let ink = 0;
      let hash = 7;
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] > 8) {
          ink += 1;
          hash = (hash * 31 + i) % 2147483647;
        }
      }
      chars.push({ character, ink, hash });
    }
    rows.push({ ...entry, width, chars });
  }
  return rows;
}, shippedGreetings);

const brokenText = glyphs.filter((row) => /[\uFFFD]/.test(row.text) || [...row.text].length === 0);
check('opening: every greeting survives the pipeline intact', brokenText.length === 0, `${glyphs.length} checked`);
const tooNarrow = glyphs.filter((row) => row.width < [...row.text].length * 12);
check(
  'opening: every greeting renders at a plausible width',
  tooNarrow.length === 0,
  tooNarrow.map((row) => `${row.text} ${row.width.toFixed(0)}`).join(', ') || 'all measured',
);
/* Tofu boxes are identical rectangles: in a real face the glyphs of a CJK
   greeting differ from one another. Devanagari is excluded because a combining
   sequence is shaped as a cluster, so per-character bitmaps are meaningless —
   for it, the codepoint and width checks above are the honest limit. */
const cjk = glyphs.filter((row) => ['ja', 'zh', 'ko'].includes(row.lang));
const tofu = cjk.filter((row) => {
  const hashes = new Set(row.chars.map((entry) => entry.hash));
  return row.chars.length > 1 && (hashes.size === 1 || row.chars.some((entry) => entry.ink === 0));
});
check(
  'opening: CJK greetings render glyphs, not missing-glyph boxes',
  cjk.length >= 2 && tofu.length === 0,
  tofu.map((row) => row.text).join(', ') || `${cjk.length} scripts rendered distinctly`,
);
check(
  'opening: the greeting stack names a CJK and a Devanagari fallback',
  /Noto Sans JP|Hiragino|Malgun|Microsoft YaHei/i.test(card.greetingStack) &&
    /Noto Sans Devanagari/i.test(card.greetingStack),
  card.greetingStack.slice(0, 90),
);
check(
  'opening: the greeting face covers Latin itself',
  glyphs.filter((row) => row.lang === 'en').every((row) => row.chars.every((entry) => entry.ink > 0)),
  card.greetingStack.slice(0, 30),
);

await bootPage.waitForSelector('[data-boot]', { state: 'detached', timeout: 9000 }).catch(() => {});
const bootElapsed = Date.now() - bootStartedAt;
check('opening: it leaves on its own', bootElapsed < 6000, `${bootElapsed} ms from load`);
check(
  'opening: the page becomes interactive again',
  await bootPage.evaluate(() => document.getElementById('root').inert === false),
);

/* -------------------------------------------------------- typed headline */

const typed = () =>
  bootPage.evaluate(() => {
    const h1 = document.querySelector('#hero-heading');
    const visual = document.querySelector('[data-typed-headline]');
    return {
      state: h1?.getAttribute('data-typed') ?? null,
      accessible: h1?.querySelector('.visually-hidden')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      visual: visual?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      /* The visual copy is two block lines, so its text is joined with the
         space the line break stands for: that is what the accessible string
         carries too. */
      visualLines: [...(visual?.querySelectorAll('.hero__title-line') ?? [])]
        .map((node) => node.textContent?.replace(/\s+/g, ' ').trim() ?? '')
        .join(' ')
        .trim(),
      visualHidden: visual?.closest('[aria-hidden="true"]') !== null,
      caret: Boolean(document.querySelector('[data-typed-caret]')),
      stageHeight: Math.round(document.querySelector('.hero__title-stage')?.getBoundingClientRect().height ?? 0),
      subheadTop: Math.round(document.querySelector('.hero__subhead')?.getBoundingClientRect().top ?? 0),
      font: getComputedStyle(document.querySelector('.hero__title')).fontFamily.slice(0, 24),
      lineWidths: [...document.querySelectorAll('.hero__title-ghost .hero__title-line')].map((node) =>
        Math.round(node.getBoundingClientRect().width),
      ),
    };
  });

/* Sample while the headline is genuinely mid-type. The state attribute is the
   app's own report that the animation is running, and the assertion below then
   checks that the visible copy is a prefix of the finished sentence. */
await bootPage
  .waitForFunction(() => document.querySelector('#hero-heading')?.getAttribute('data-typed') === 'typing', null, {
    timeout: 4000,
  })
  .catch(() => {});
const typingSample = await typed();
await bootPage.screenshot({ path: `${OUT}/hero-typing.png` });
await bootPage.waitForFunction(() => document.querySelector('#hero-heading')?.getAttribute('data-typed') === 'done', null, {
  timeout: 6000,
}).catch(() => {});
const typedDone = await typed();
await bootPage.screenshot({ path: `${OUT}/hero-typed.png` });

check(
  'headline: the exact phrase is the accessible heading',
  typingSample.accessible.toUpperCase() === 'SMALL GAMES. BIG IDEAS.',
  `"${typingSample.accessible}"`,
);
check(
  'headline: the typed copy is decorative, never a second heading',
  typingSample.visualHidden === true,
  String(typingSample.visualHidden),
);
check(
  'headline: it is mid-type when the card leaves',
  typingSample.state === 'typing' && typingSample.visual.length < typingSample.accessible.replace(/ /g, '').length,
  `${typingSample.visual.length}/${typingSample.accessible.replace(/ /g, '').length} characters`,
);
check('headline: the typing actually finishes', typedDone.state === 'done', typedDone.state ?? 'never finished');
check(
  'headline: the finished text matches the accessible text',
  typedDone.visualLines.toUpperCase() === typedDone.accessible.toUpperCase(),
  `"${typedDone.visualLines}" vs "${typedDone.accessible}"`,
);
check('headline: the caret clears when it is done', typedDone.caret === false);
check(
  'headline: nothing shifts as it types',
  Math.abs(typedDone.stageHeight - typingSample.stageHeight) <= 1 &&
    Math.abs(typedDone.subheadTop - typingSample.subheadTop) <= 1,
  `stage ${typingSample.stageHeight} → ${typedDone.stageHeight}, subhead ${typingSample.subheadTop} → ${typedDone.subheadTop}`,
);
check(
  'headline: the two lines do not wrap into more',
  typedDone.lineWidths.length === 2 && typedDone.lineWidths.every((width) => width > 40),
  typedDone.lineWidths.join(' / '),
);
check('headline: it is set in the heavy grotesque', /Space Grotesk/i.test(typedDone.font), typedDone.font);
check(
  'headline: the finish rule is drawn under it',
  await bootPage.evaluate(() => {
    const rule = document.querySelector('.hero__title-rule');
    return Boolean(rule) && getComputedStyle(rule).transform !== 'matrix(0, 0, 0, 1, 0, 0)';
  }),
);

/* Typing once per page load: leave and come back. */
await bootPage.click('a[href="/about"]');
await bootPage.waitForURL('**/about', { timeout: 10000 });
await bootPage.click('a[href="/"]');
await bootPage.waitForURL((url) => new URL(url).pathname === '/', { timeout: 10000 });
await bootPage.waitForSelector('#hero-heading');
check(
  'headline: it does not type itself again on the way back',
  (await bootPage.evaluate(() => document.querySelector('#hero-heading')?.getAttribute('data-typed'))) === 'done',
);
check(
  'opening: it does not come back during in-app navigation',
  (await bootPage.evaluate(() => Boolean(document.querySelector('[data-boot]')))) === false,
);
check('opening: nothing threw while it played', bootErrors.length === 0, bootErrors.join(' | ') || 'no page errors');

/* ------------------------------------------------------------ entrance */

const entrance = await bootPage.evaluate(() => {
  const marked = [...document.querySelectorAll('[data-reveal], [data-reveal-group]')];
  const below = [...document.querySelectorAll('#contact [data-reveal], #contact [data-reveal-group]')];
  return {
    jsReveal: document.documentElement.classList.contains('js-reveal'),
    marked: marked.length,
    hiddenAbove: marked.filter(
      (node) => node.getBoundingClientRect().top < window.innerHeight && getComputedStyle(node).opacity === '0',
    ).length,
    belowHidden: below.filter((node) => getComputedStyle(node).opacity === '0').length,
    belowTotal: below.length,
    childrenHidden: [...document.querySelectorAll('#contact [data-reveal-group] > *')].filter(
      (node) => getComputedStyle(node).opacity === '0',
    ).length,
  };
});
check('entrance: the system is armed only with JavaScript and motion allowed', entrance.jsReveal === true);
check('entrance: sections are marked to reveal', entrance.marked >= 5, `${entrance.marked} marked`);
check('entrance: nothing already on screen is left hidden', entrance.hiddenAbove === 0, `${entrance.hiddenAbove}`);
check(
  'entrance: below-the-fold sections start hidden',
  entrance.belowTotal > 0 && entrance.belowHidden > 0,
  `${entrance.belowHidden}/${entrance.belowTotal} hidden before scrolling`,
);
check('entrance: a group hides its children, not itself', entrance.childrenHidden > 0, `${entrance.childrenHidden}`);

await bootPage.evaluate(() => {
  const target = document.querySelector('#contact');
  if (target) window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY + 40, behavior: 'instant' });
});
await bootPage.waitForTimeout(800);
const revealed = await bootPage.evaluate(() => {
  const below = [...document.querySelectorAll('#contact [data-reveal], #contact [data-reveal-group]')];
  return {
    revealed: below.filter((node) => node.classList.contains('is-revealed')).length,
    total: below.length,
    stillHidden: below.filter((node) => getComputedStyle(node).opacity === '0').length,
  };
});
check(
  'entrance: scrolling reveals them, once, without leaving any behind',
  revealed.revealed === revealed.total && revealed.stillHidden === 0,
  `${revealed.revealed}/${revealed.total} revealed, ${revealed.stillHidden} still hidden`,
);

/* -------------------------------------------------- colour + typography */

const palette = await bootPage.evaluate(() => {
  const schemes = [...document.querySelectorAll('[class*="scheme--"]')].map((node) => ({
    name: [...node.classList].find((entry) => entry.startsWith('scheme--')),
    a: getComputedStyle(node).getPropertyValue('--scheme-a').trim(),
    grad: getComputedStyle(node).getPropertyValue('--scheme-grad').trim(),
  }));    const eyebrow = document.querySelector('#featured-games .sec-head__flourish');
  const section = document.querySelector('#featured-games');
  return {
    schemeNames: schemes.map((entry) => entry.name),
    accents: [...new Set(schemes.map((entry) => entry.a))],
    gradients: [...new Set(schemes.map((entry) => entry.grad))],
    eyebrowColour: eyebrow ? getComputedStyle(eyebrow).color : '',
    sectionAccent: section ? getComputedStyle(section).getPropertyValue('--scheme-a').trim() : '',
    textures: {
      pixel: getComputedStyle(document.querySelector('.tex--pixel'), '::before')?.backgroundImage ?? '',
      aurora: getComputedStyle(document.querySelector('.tex--aurora'), '::before')?.backgroundImage ?? '',
      halftoneLg: getComputedStyle(document.querySelector('.tex--halftone-lg'), '::before')?.backgroundImage ?? '',
    },
  };
});

check('colour: sections carry their own scheme', palette.schemeNames.length >= 4, palette.schemeNames.join(', '));
check('colour: the schemes differ from each other', palette.accents.length >= 4, palette.accents.join(' '));
check('colour: they carry different gradients too', palette.gradients.length >= 3, `${palette.gradients.length} ramps`);
check(
  'colour: a band\u2019s accent is wired into its content, not just declared',
  Boolean(palette.eyebrowColour) && parseColour(palette.eyebrowColour)?.join() === parseColour(palette.sectionAccent)?.join(),
  `${palette.eyebrowColour} vs ${palette.sectionAccent}`,
);
{
  const fg = parseColour(palette.eyebrowColour);
  const bg = parseColour(await bootPage.evaluate(() => getComputedStyle(document.body).backgroundColor));
  check(
    'colour: the band accent is readable as text',
    Boolean(fg) && Boolean(bg) && contrast(fg, bg) >= 4.5,
    fg && bg ? `${contrast(fg, bg).toFixed(2)}:1 on the page` : 'unparsed',
  );
}
check(
  'texture: the new patterns are painted',
  /gradient/.test(palette.textures.pixel) && /gradient/.test(palette.textures.aurora) && /gradient/.test(palette.textures.halftoneLg),
  Object.entries(palette.textures)
    .map(([name, value]) => `${name}:${/gradient/.test(value) ? 'yes' : 'no'}`)
    .join(' '),
);
check(
  'typography: the display face is Syne and it is loaded',
  await bootPage.evaluate(() => document.fonts.check('700 3rem "Syne Variable"')),
);

/* Reduced motion: no opening rotation, no reveal hiding, headline at once. */
const stillBootContext = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  reducedMotion: 'reduce',
  colorScheme: 'dark',
});
const stillBootPage = await stillBootContext.newPage();
await stillBootPage.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await stillBootPage.waitForSelector('[data-boot]', { timeout: 4000 }).catch(() => {});
/* The home page is a lazily-loaded route, so "the headline is complete" can only
   be judged once the headline exists. Waiting for it does not weaken the check:
   if the typing had started, `data-typed` would read "typing" here, and if the
   route never mounted the wait times out and the attribute stays absent — both
   still fail below. Reading it before the element exists was a race. */
await stillBootPage.waitForSelector('#hero-heading[data-typed]', { timeout: 10000 }).catch(() => {});
const reducedCard = await stillBootPage.evaluate(() => {
  const node = document.querySelector('[data-boot]');
  const greeting = node?.querySelector('[data-boot-greeting] span');
  return {
    present: Boolean(node),
    text: greeting?.textContent?.trim() ?? '',
    wordAnimation: greeting ? getComputedStyle(greeting).animationDuration : '',
    headline: document.querySelector('#hero-heading')?.getAttribute('data-typed') ?? '',
    jsReveal: document.documentElement.classList.contains('js-reveal'),
    hidden: [...document.querySelectorAll('[data-reveal], [data-reveal-group]')].filter(
      (node) => getComputedStyle(node).opacity === '0' || [...node.children].some((child) => getComputedStyle(child).opacity === '0'),
    ).length,
  };
});
check('reduced motion: the card still opens the site', reducedCard.present === true);
check(
  'reduced motion: the greeting is static, with no rotation animation',
  reducedCard.text.length > 0 && (reducedCard.wordAnimation === '' || parseFloat(reducedCard.wordAnimation) <= 0.001),
  `"${reducedCard.text}" animation ${reducedCard.wordAnimation || 'none'}`,
);
check('reduced motion: nothing is hidden for an entrance', reducedCard.jsReveal === false && reducedCard.hidden === 0, `${reducedCard.hidden} hidden`);
check('reduced motion: the headline is complete immediately', reducedCard.headline === 'done', reducedCard.headline);
await stillBootContext.close();

/* ==========================================================================
   THE PAPER REDESIGN

   The checks that only exist because of this redesign: the paper palette
   itself, the editorial serif, the flowing word ribbon, the scroll-progress
   rule, the back-to-top control and the shared loading indicators. Everything
   is measured the way the rest of this audit measures — computed styles and
   geometry, never an opinion about a screenshot.
   ========================================================================== */

const paperPages = {};
for (const theme of ['light', 'dark']) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: theme === 'light' ? 'light' : 'dark',
  });
  const page = await ctx.newPage();
  await page.addInitScript((value) => {
    localStorage.setItem('hg.theme.v1', value);
    localStorage.setItem('hg.privacy.v1', 'acknowledged');
  }, theme);
  paperPages[theme] = { ctx, page };
}

for (const theme of ['light', 'dark']) {
  const { page } = paperPages[theme];
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await settle(page);

  const palette = await page.evaluate(() => {
    const body = getComputedStyle(document.body);
    const current = document.querySelector('.nav-link[aria-current="page"]');
    const primary = document.querySelector('.hero__actions .btn--primary');
    return {
      bg: body.backgroundColor,
      text: body.color,
      // The current page is marked with a drawn rule under the word (the
      // reference's treatment), so the rule itself is what gets measured.
      navRuleBg: current ? getComputedStyle(current, '::after').backgroundColor : '',
      navRuleHeight: current ? getComputedStyle(current, '::after').height : '',
      navRuleInk: current ? getComputedStyle(current).color : '',
      navBg: current ? getComputedStyle(current).backgroundColor : '',
      primaryBg: primary ? getComputedStyle(primary).backgroundColor : '',
      primaryLabel: primary ? getComputedStyle(primary).color : '',
      primaryBgImage: primary ? getComputedStyle(primary).backgroundImage : '',
      primaryBorderWidth: primary ? getComputedStyle(primary).borderTopWidth : '',
      primaryBorder: primary ? getComputedStyle(primary).borderTopColor : '',
    };
  });

  const bg = parseColour(palette.bg);
  const text = parseColour(palette.text);
  /* Paper is warm: the sheet's own axis is red ≥ green > blue. Graphite is not:
     its channels sit within a few units of each other on the blue-grey axis, so
     a full screen reads as grey without a green or olive cast. */
  const warm = (rgb) => rgb && rgb[0] >= rgb[1] && rgb[1] >= rgb[2];
  const neutral = (rgb) => Boolean(rgb) && Math.max(...rgb) - Math.min(...rgb) <= 6 && !(rgb[1] > rgb[0] && rgb[1] > rgb[2]);

  if (theme === 'light') {
    check(
      'paper: the light theme is warm cream — red ≥ green > blue, and not white',
      Boolean(bg) && bg[0] < 255 && warm(bg) && bg[1] > bg[2] && luminance(bg) > 0.8,
      palette.bg,
    );
  } else {
    check(
      'paper: the dark theme is neutral graphite — balanced channels, not black',
      Boolean(bg) && neutral(bg) && luminance(bg) > 0.01 && luminance(bg) < 0.09,
      `${palette.bg} · spread ${bg ? Math.max(...bg) - Math.min(...bg) : '?'}`,
    );
  }
  check(
    `${theme}: body text clears AA on the paper`,
    Boolean(text && bg) && contrast(text, bg) >= 4.5,
    text && bg ? `${contrast(text, bg).toFixed(2)}:1` : 'unparsed',
  );
  check(
    `${theme}: the current page is marked by a drawn ink rule`,
    Boolean(parseColour(palette.navRuleBg)) &&
      parseFloat(palette.navRuleHeight) >= 1.5 &&
      parseFloat(palette.navRuleHeight) <= 4 &&
      Boolean(parseColour(palette.navRuleInk)) &&
      (parseColour(palette.navRuleBg)?.[0] ?? 0) !== (bg?.[0] ?? -1),
    `${palette.navRuleBg} · ${palette.navRuleHeight} · ${palette.navRuleInk}`,
  );
  check(
    `${theme}: the primary action is flat ink-edged colour, not a gradient`,
    palette.primaryBgImage === 'none' && parseFloat(palette.primaryBorderWidth) >= 2,
    `${palette.primaryBgImage.slice(0, 30)} · ${palette.primaryBorderWidth} ${palette.primaryBorder}`,
  );
}

/* --- the signature ribbon ------------------------------------------------ */

await paperPages.light.page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
await settle(paperPages.light.page);

const ribbon = await paperPages.light.page.evaluate(() => {
  const node = document.querySelector('[data-ribbon]');
  if (!node) return { present: false };
  const band = node.closest('.ribbon-band');
  const layers = [...node.querySelectorAll('text.ribbon__text')].filter((text) => text.getAttribute('font-size'));
  const rect = (element) => element?.getBoundingClientRect() ?? null;
  const overlaps = (a, b) => Boolean(a && b) && !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
  const bandRect = rect(band);
  const stage = rect(document.querySelector('.hero__title-stage'));
  const cta = rect(document.querySelector('.hero__actions .btn--primary'));
  const progress = document.querySelector('.scroll-progress');
  do {
    window.scrollTo(0, 0);
  } while (false);
  return {
    present: true,
    ariaHidden: node.getAttribute('aria-hidden'),
    pointerEvents: getComputedStyle(node).pointerEvents,
    motion: node.dataset.ribbonMotion,
    fit: Number(node.dataset.ribbonFit),
    animations: node.querySelectorAll('animate').length,
    fontSize: layers.map((text) => Number(text.getAttribute('font-size'))),
    pathLength: Math.round(node.querySelector('defs path').getTotalLength()),
    contentLength: Math.round(layers[layers.length - 1]?.getComputedTextLength() ?? 0),
    bandHeight: Math.round(bandRect?.height ?? 0),
    crossesTitle: overlaps(bandRect, stage),
    crossesCta: overlaps(bandRect, cta),
    progressPresent: Boolean(progress),
  };
});

check(
  'ribbon: the word ribbon is on the home page',
  ribbon.present === true && ribbon.bandHeight > 100,
  ribbon.present ? `${ribbon.bandHeight}px band` : 'no ribbon',
);
check(
  'ribbon: it is decoration only — hidden from assistive tech, no pointer events',
  ribbon.ariaHidden === 'true' && ribbon.pointerEvents === 'none',
  `${ribbon.ariaHidden} · ${ribbon.pointerEvents}`,
);
check(
  'ribbon: two layers of words travel along the curve',
  ribbon.fontSize?.length === 2 && ribbon.animations >= 2 && ribbon.motion === 'on',
  `${ribbon.fontSize?.map((size) => size.toFixed(1)).join(' / ')} · ${ribbon.animations} animate · ${ribbon.motion}`,
);
check(
  'ribbon: the trail sits behind the main line, visibly smaller',
  (ribbon.fontSize?.[0] ?? 0) < (ribbon.fontSize?.[1] ?? 0) * 0.6,
  ribbon.fontSize?.map((size) => size.toFixed(1)).join(' / '),
);
check(
  'ribbon: the loop closes — the content is a whole number of path lengths',
  Number.isFinite(ribbon.fit) &&
    Math.round(ribbon.fit) >= 2 &&
    Math.abs(ribbon.fit - Math.round(ribbon.fit)) <= 0.02,
  `${ribbon.fit} path lengths, ${ribbon.contentLength} units of text on ${ribbon.pathLength}`,
);
check(
  'ribbon: it never crosses the headline or the primary action',
  ribbon.crossesTitle === false && ribbon.crossesCta === false,
  `title ${ribbon.crossesTitle ? 'overlapped' : 'clear'}, action ${ribbon.crossesCta ? 'overlapped' : 'clear'}`,
);

const ribbonOnGame = await paperPages.light.page.evaluate(async () => {
  const response = await fetch('/api/catalogue');
  const body = await response.json().catch(() => ({}));
  const slug = body.games?.find((game) => game.playable)?.slug ?? body.games?.[0]?.slug;
  return slug ?? null;
});
if (ribbonOnGame) {
  await paperPages.light.page.goto(`${BASE}/games/${ribbonOnGame}`, { waitUntil: 'networkidle' });
  await settle(paperPages.light.page);
  const onGamePage = await paperPages.light.page.locator('[data-ribbon]').count();
  check('ribbon: it stays off the game page, so it can never sit over gameplay', onGamePage === 0, `${onGamePage} on /games/${ribbonOnGame}`);
}

/* --- the scroll rule and the back-to-top control ------------------------- */

await paperPages.light.page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
await settle(paperPages.light.page);

const scrollUi = await paperPages.light.page.evaluate(async () => {
  const bar = document.querySelector('.scroll-progress');
  const readBar = () => (bar ? getComputedStyle(bar).transform : 'none');
  const findTop = () =>
    [...document.querySelectorAll('.floating-action')].find((node) =>
      /back to top/i.test(node.getAttribute('aria-label') ?? ''),
    );
  const atTop = { transform: readBar(), backToTop: findTop() ? 1 : 0 };
  /* Scroll until the position stops moving. Reaching the bottom can mount
     content (the recently-played strip) and the browser's own smooth scrolling
     can still be in flight, so a fixed number of passes is a guess; this is a
     measurement. */
  let last = -1;
  for (let pass = 0; pass < 6; pass += 1) {
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'auto' });
    await new Promise((resolve) => setTimeout(resolve, 280));
    const now = document.documentElement.scrollTop;
    if (now === last) break;
    last = now;
  }
  const button = findTop();
  const atBottom = {
    transform: readBar(),
    buttonPresent: Boolean(button),
    label: button?.getAttribute('aria-label') ?? '',
    position: button ? getComputedStyle(button.parentElement).position : '',
    shadow: button?.parentElement ? getComputedStyle(button.parentElement) : null,
  };
  const scale = (value) => {
    const match = /matrix\(([^)]+)\)/.exec(value ?? '');
    return match ? Number(match[1].split(',')[0]) : null;
  };
  return {
    barPresent: Boolean(bar),
    barRole: bar?.getAttribute('role') ?? '',
    barPosition: bar ? getComputedStyle(bar).position : '',
    barHeight: bar ? Math.round(parseFloat(getComputedStyle(bar).height)) : 0,
    atTopScale: scale(atTop.transform),
    atBottomScale: scale(atBottom.transform),
    buttonAtTop: atTop.backToTop,
    buttonAtBottom: atBottom.buttonPresent,
    buttonLabel: atBottom.label,
    stackPosition: atBottom.position,
  };
});

check(
  'scroll rule: a real progress bar tracks the document',
  scrollUi.barPresent && scrollUi.barRole === 'progressbar' && scrollUi.barPosition === 'fixed' && scrollUi.barHeight <= 6,
  `${scrollUi.barPosition} · ${scrollUi.barHeight}px · role ${scrollUi.barRole}`,
);
check(
  'scroll rule: it starts at zero and fills as the page is read',
  scrollUi.atTopScale !== null && scrollUi.atTopScale <= 0.02 && (scrollUi.atBottomScale ?? 0) >= 0.98,
  `${scrollUi.atTopScale} → ${scrollUi.atBottomScale}`,
);
check(
  'back to top: hidden at the top of the page, present after scrolling',
  scrollUi.buttonAtTop === 0 && scrollUi.buttonAtBottom === true && /back to top/i.test(scrollUi.buttonLabel),
  `${scrollUi.buttonAtTop} at top, ${scrollUi.buttonAtBottom ? 'shown' : 'missing'} below · "${scrollUi.buttonLabel}"`,
);
check(
  'back to top: it lives in the fixed control stack',
  scrollUi.stackPosition === 'fixed',
  scrollUi.stackPosition,
);

/* --- loading indicators -------------------------------------------------- */

const indicators = await paperPages.dark.page.evaluate(() => {
  const host = document.createElement('div');
  host.style.position = 'fixed';
  host.style.top = '-1000px';
  host.innerHTML =
    '<span class="spinner spinner--ring spinner--sm"></span>' +
    '<span class="spinner spinner--dots"><span></span><span></span><span></span></span>';
  document.body.appendChild(host);
  const ring = getComputedStyle(host.querySelector('.spinner--ring'));
  const dots = host.querySelector('.spinner--dots');
  const dot = getComputedStyle(dots.querySelector('span'));
  const result = {
    animation: ring.animationName,
    /* The head is the accent edge; the track is the remaining edges. */
    head: ring.borderTopColor,
    track: ring.borderLeftColor,
    size: Math.round(parseFloat(ring.width)),
    dotSize: Math.round(parseFloat(dot.width)),
    dotHeight: Math.round(parseFloat(dot.height)),
    dotAnimation: dot.animationName,
  };
  host.remove();
  return result;
});

check(
  'indicator: the shared spinner family is wired to the tokens',
  indicators.animation !== 'none' && indicators.size <= 24 && indicators.dotAnimation !== 'none',
  `${indicators.animation} at ${indicators.size}px · dots ${indicators.dotAnimation}`,
);
check(
  'indicator: the spinner head and track are different colours, so a still frame still reads',
  Boolean(indicators.head) && indicators.head !== indicators.track,
  `${indicators.head} on ${indicators.track}`,
);
check(
  'indicator: the dot sequence uses squares',
  indicators.dotSize === indicators.dotHeight && indicators.dotSize > 0,
  `${indicators.dotSize}×${indicators.dotHeight}`,
);

/* --- the privacy notice -------------------------------------------------- */

const bannerCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
const bannerPage = await bannerCtx.newPage();
await bannerPage.goto(`${BASE}/`, { waitUntil: 'networkidle' });
await settle(bannerPage);
const banner = await bannerPage.evaluate(() => {
  const node = document.querySelector('.cookie-banner');
  if (!node) return { present: false };
  const style = getComputedStyle(node);
  return {
    present: true,
    borderWidth: parseFloat(style.borderTopWidth),
    shadow: style.boxShadow,
    radius: parseFloat(style.borderTopLeftRadius),
    position: style.position,
    width: Math.round(node.getBoundingClientRect().width),
    height: Math.round(node.getBoundingClientRect().height),
  };
});
check('privacy notice: it is a printed card, not a modal', banner.present === true && banner.position === 'fixed' && banner.height < 420, banner.present ? `${banner.width}×${banner.height}` : 'absent');
check(
  'privacy notice: ink frame and hard offset shadow',
  banner.borderWidth >= 2 && isHardShadow(banner.shadow) && banner.radius <= 4,
  `${banner.borderWidth}px · ${banner.radius}px radius · ${banner.shadow?.slice(0, 44)}`,
);
await bannerCtx.close();

/* --- textures ------------------------------------------------------------ */

const TOKENS = [
  'tex--paper',
  'tex--block',
  'tex--cluster',
  'tex--grid',
  'tex--halftone',
  'tex--stripe',
  'tex--pixel',
  'tex--rays',
  'tex--aurora',
];
const textures = new Set();
for (const route of ['/', '/games', '/about', '/contact']) {
  const page = paperPages.light.page;
  await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' });
  await settle(page);
  const found = await page.evaluate((tokens) => {
    const names = new Set();
    let painted = false;
    for (const node of document.querySelectorAll('.tex')) {
      for (const token of tokens) if (node.classList.contains(token)) names.add(token);
      const before = getComputedStyle(node, '::before');
      if (before.backgroundImage && before.backgroundImage !== 'none') painted = true;
    }
    return { names: [...names], painted };
  }, TOKENS);
  found.names.forEach((name) => textures.add(name));
  if (found.painted) textures.add('painted');
}
check(
  'texture: the patterns paint, and the new paper ones are in use',
  textures.has('painted') && textures.has('tex--paper') && (textures.has('tex--block') || textures.has('tex--cluster')),
  [...textures].join(', '),
);

/* --- reduced motion keeps the ribbon, statically ------------------------- */

const stillPaperCtx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  colorScheme: 'light',
  reducedMotion: 'reduce',
});
const stillPaperPage = await stillPaperCtx.newPage();
await stillPaperPage.goto(`${BASE}/`, { waitUntil: 'networkidle' });
await settle(stillPaperPage);
const stillRibbon = await stillPaperPage.evaluate(() => {
  const node = document.querySelector('[data-ribbon]');
  if (!node) return { present: false };
  const layers = [...node.querySelectorAll('text.ribbon__text')].filter((text) => text.getAttribute('font-size'));
  return {
    present: true,
    motion: node.dataset.ribbonMotion,
    animations: node.querySelectorAll('animate').length,
    words: (layers[layers.length - 1]?.textContent ?? '').trim().length,
  };
});
check(
  'reduced motion: the ribbon is still there, standing still',
  stillRibbon.present === true && stillRibbon.motion === 'static' && stillRibbon.animations === 0 && stillRibbon.words > 40,
  `${stillRibbon.motion} · ${stillRibbon.animations} animations · ${stillRibbon.words} characters of words`,
);
await stillPaperCtx.close();
for (const theme of ['light', 'dark']) await paperPages[theme].ctx.close();

await bootContext.close();
await context.close();
await browser.close();

console.log(`\n${checks - failures}/${checks} design checks passed.`);
console.log(`Screenshots: ${OUT}/`);
if (failures > 0) process.exitCode = 1;
