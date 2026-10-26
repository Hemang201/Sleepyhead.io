import { Link, NavLink, Outlet } from 'react-router-dom';

import { AdminProvider, ToastViewport, useAdmin } from '../../lib/admin';
import { api } from '../../lib/api';
import { site } from '../../data/site';
import { OwnerGate } from '../../components/admin/OwnerGate';
import { ThemeToggle } from '../../components/ThemeToggle';
import { Spinner } from '../../components/Spinner';
import {
  IconController,
  IconExternal,
  IconHome,
  IconImage,
  IconLayers,
  IconLock,
  IconShield,
  IconSound,
  IconSparkle,
} from '../../components/Icons';

/**
 * The dashboard shell.
 *
 * Access is decided entirely by the server, and it happens in two stages:
 *
 *   1. `/api/admin/session` only reports an `owner` when the Worker matched the
 *      authentication provider's identity against the pinned owner account;
 *   2. `security.session.verified` is only true once a code emailed to the
 *      owner's private address has been accepted for *this* session.
 *
 * Everything below the gate is therefore a reflection of two server answers, and
 * every admin request is authorized again on the Worker regardless.
 */
export default function AdminLayout() {
  return (
    <AdminProvider>
      <AdminShell />
    </AdminProvider>
  );
}

function AdminShell() {
  const { session, security, status, error, reload } = useAdmin();
  const signOut = async () => {
    // The server revokes the session row and clears the cookie; there is no
    // second, provider-side session to end.
    try {
      await api.admin.signOut();
    } catch {
      /* the session expires on its own either way */
    }
    reload();
  };

  if (status === 'loading') {
    return (
      <div className="admin-gate">
        <Spinner shape="ring" size="lg" />
        <p role="status">Checking your session…</p>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="admin-gate">
        <h1 className="section__title" style={{ fontSize: 'var(--step-2)' }}>
          The dashboard could not reach the server
        </h1>
        <p className="section__lead">{error}</p>
        <div className="cluster">
          <button type="button" className="btn btn--primary" onClick={reload}>
            Try again
          </button>
          <Link className="btn btn--ghost" to="/">
            Back to the site
          </Link>
        </div>
      </div>
    );
  }

  if (!session?.ownerConfigured) {
    return <Unconfigured />;
  }

  /*
   * An owner is configured; a verified session is not. The server answers two
   * things the gate may use before sign-in and nothing more: which form is
   * required, and whether a code could be delivered. No address reaches the
   * browser until a code has actually been sent.
   */
  if (!security?.session.verified) {
    const needsSetup = session.gate?.mode === 'setup';
    const noMail = session.gate ? !session.gate.mailConfigured : false;
    const blocked = noMail
      ? 'Email delivery is not configured on the server, so the second factor cannot be sent. The dashboard stays locked until the deployment can send mail.'
      : needsSetup && !session.setupEnabled
        ? 'This deployment has no OWNER_SETUP_TOKEN configured, so the first-run owner cannot be provisioned from here. Set it in the Worker environment, deploy, then reload this page.'
        : null;

    return <OwnerGate mode={needsSetup ? 'setup' : 'signin'} onDone={reload} blocker={blocked} setupEnabled={session.setupEnabled} />;
  }

  // Shown in the header: which identity this session belongs to. It is the login
  // identity — never the private OTP address.
  const signedInAs = security.loginEmail.masked ?? session.owner?.email ?? null;

  return (
    /* The dashboard runs the quiet scheme: cyan for anything interactive,
       blue for structure, and no expressive accents competing with the data. */
    <div className="admin scheme--admin">
      <header className="admin-header">
        <div className="container admin-header__inner">
          <Link className="admin-brand" to="/admin">
            <span className="brand__mark" aria-hidden="true">
              <IconController size={20} />
            </span>
            <span>
              <strong>Arcade dashboard</strong>
              <span className="admin-brand__sub">{site.developerName}</span>
            </span>
          </Link>

          <nav className="admin-nav" aria-label="Dashboard">
            <NavLink to="/admin" end className={({ isActive }) => (isActive ? 'is-active' : undefined)}>
              <IconHome size={16} />
              Overview
            </NavLink>
            <NavLink to="/admin/games" className={({ isActive }) => (isActive ? 'is-active' : undefined)}>
              <IconLayers size={16} />
              Games
            </NavLink>
            <NavLink to="/admin/games/new" className={({ isActive }) => (isActive ? 'is-active' : undefined)}>
              <IconSparkle size={16} />
              Upload game
            </NavLink>
            <NavLink to="/admin/content" className={({ isActive }) => (isActive ? 'is-active' : undefined)}>
              <IconImage size={16} />
              Site content
            </NavLink>
            <NavLink to="/admin/social" className={({ isActive }) => (isActive ? 'is-active' : undefined)}>
              <IconExternal size={16} />
              Social links
            </NavLink>
            <NavLink to="/admin/appearance" className={({ isActive }) => (isActive ? 'is-active' : undefined)}>
              <IconSparkle size={16} />
              Appearance
            </NavLink>
            <NavLink to="/admin/music" className={({ isActive }) => (isActive ? 'is-active' : undefined)}>
              <IconSound size={16} />
              Background music
            </NavLink>
            <NavLink to="/admin/security" className={({ isActive }) => (isActive ? 'is-active' : undefined)}>
              <IconShield size={16} />
              Account security
            </NavLink>
          </nav>

          <div className="admin-header__actions">
            <span className="admin-header__identity" title={signedInAs ? `Verified as ${signedInAs}` : undefined}>
              <IconLock size={14} />
              {signedInAs ?? 'verified'}
            </span>
            {/* The same control as the public header, so the dashboard can be
                switched without going back to the site first. */}
            <ThemeToggle />
            <Link className="btn btn--ghost btn--sm" to="/">
              View site
            </Link>
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => void signOut()}>
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main id="main" className="container admin-main" tabIndex={-1}>
        <Outlet />
      </main>

      <ToastViewport />
    </div>
  );
}

/**
 * Shown when the deployment has no owner configured at all.
 *
 * This is a configuration state, not a sign-in screen: without a login
 * identity, an OTP destination and a setup token in the Worker environment
 * there is nobody who could be authorised, and the dashboard says so rather
 * than offering a form that cannot work.
 */
function Unconfigured() {
  return (
    <div className="admin-gate">
      <span className="page-state__icon" aria-hidden="true">
        <IconShield size={24} />
      </span>
      <h1 className="section__title" style={{ fontSize: 'var(--step-2)' }}>
        This dashboard has no owner yet
      </h1>
      <p className="section__lead">
        Sign-in is password plus a code emailed to a private address, and both are configuration — nothing is claimed from
        a browser. An operator has to finish the deployment before this screen can become a door.
      </p>
      <div className="callout callout--warn" style={{ textAlign: 'left' }}>
        <span className="callout__title">What to set, server-side</span>
        <span>
          <code>OWNER_LOGIN_EMAIL</code> (the administrator identity you type), a private OTP destination in{' '}
          <code>OWNER_OTP_EMAIL</code>, and a one-time <code>OWNER_SETUP_TOKEN</code>. Add a transactional email provider
          (<code>RESEND_API_KEY</code> with a verified <code>EMAIL_FROM</code>), deploy, then reload this page to provision
          the owner.
        </span>
      </div>
      <Link className="btn btn--ghost" to="/">
        Back to the site
      </Link>
    </div>
  );
}
