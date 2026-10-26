import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { startOfflineSupport } from './lib/offline';

/* Self-hosted variable fonts, subset by unicode-range: the browser downloads
   only the Latin files it needs, with no third-party font requests.

   Four tiers: Syne is the display face (headlines, page titles, game titles),
   Fraunces is the editorial serif (expressive phrases, pull quotes, the second
   half of the hero headline — roman and italic), Space Grotesk is the
   graphic voice (sub-heads, nav, labels) and Inter carries body copy and forms.

   Fraunces ships weight-only subsets here on purpose: the SOFT and WONK axes
   would add download weight for an effect the paper layout does not need. */
import '@fontsource-variable/syne/wght.css';
import '@fontsource-variable/fraunces/wght.css';
import '@fontsource-variable/fraunces/wght-italic.css';
import '@fontsource-variable/space-grotesk/wght.css';
import '@fontsource-variable/inter/wght.css';

import './styles/tokens.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/components.css';
import './styles/pages.css';
import './styles/admin.css';
/* The opening card is its own sheet: it is the one surface that must not be
   affected by a page-level rule, and it is only ever on screen for a moment. */
import './styles/boot.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);

/* Offline support is opt-in and conservative: the shell is cached, game builds
   are deliberately left alone so a large download is never cached silently. */
startOfflineSupport();
