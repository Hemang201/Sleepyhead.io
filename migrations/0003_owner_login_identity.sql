-- Owner identity, separate from the OTP destination.
--
-- The dashboard no longer takes its identity from an external provider. The
-- administrator's login address is stored here so a deployment can show which
-- identity is configured without ever sending the address to a browser. The
-- address that receives verification codes remains `auth_email`; the public
-- contact address remains in site_content('contact'). All three are different
-- values and are never written together.

ALTER TABLE owner_auth ADD COLUMN login_email TEXT;
