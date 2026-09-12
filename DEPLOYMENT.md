# cPanel deployment

The canonical application is the Express/EJS site started by `server.js`. In cPanel, create a Node.js application and set its startup file to `server.js`.

## Before uploading

1. Revoke the mailbox/app password currently present in the local `.env`, then create a new mailbox password. Do not upload `.env`.
2. Keep `node_modules/` out of the upload. Upload `package.json` and `package-lock.json` so cPanel can run `npm install`.
3. Upload the application files, including `views/`, `styles/`, `scripts/`, `images/`, `db/`, and `data/db.json`. The JSON file is only a local fallback; production should use MySQL.

## Create the database

1. In cPanel, open **MySQL Databases** and create a database and database user.
2. Add the user to the database with **All Privileges**. Record the exact prefixed names, for example `cpaneluser_zecoimpact`.
3. Open **phpMyAdmin**, select the new database, choose **Import**, and upload `db/schema.sql`.
4. If the host rejects `CREATE DATABASE` or `USE`, remove those two statements from the import and run the remaining `CREATE TABLE` statements while the cPanel database is selected.

## Configure the Node app

In **Setup Node.js App**, set the application root, domain, startup file `server.js`, and the Node version supported by the host. Add every variable from `.env.example` in the application's **Environment Variables** panel. Use the names supplied by cPanel for `DB_USER` and `DB_DATABASE`. For email, set `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, and `CONTACT_RECIPIENT`; do not upload the real SMTP password in a project file.

For cPanel email, use the SMTP settings shown in **Email Accounts > Connect Devices**. Usually the mailbox host is `mail.your-domain`, port `465` with `MAIL_SECURE=true`, or port `587` with `MAIL_SECURE=false`. `MAIL_USER` and `MAIL_FROM` should be the domain mailbox, while `CONTACT_RECIPIENT` is the address that receives notifications.

Restart the application after saving the variables. The server verifies MySQL during startup when `USE_MYSQL=true` and will fail visibly if the schema or credentials are wrong.

## Install, seed, and verify from external PowerShell

Open PowerShell outside VS Code and run:

```powershell
Set-Location 'C:\path\to\z-ecoimpact'
npm install
node scripts\test-mysql.js
node scripts\migrate-to-mysql.js
```

The migration inserts the products from `data/db.json` and skips products already present. On cPanel, run these commands in **Terminal** or through the Node app's SSH shell after setting the same environment variables; otherwise run the migration locally only if the database allows remote connections.

## Smoke test

Open these URLs after the app restarts:

- `https://your-domain/api/health` should return JSON with `status: "ok"` and `storage: "mysql"`.
- `https://your-domain/products` should show the seeded products.
- `https://your-domain/admin` should redirect to `/admin/login`; sign in using `ADMIN_USER` and `ADMIN_PASSWORD`.
- Submit `/contact` and confirm the message is saved and the notification arrives at `CONTACT_RECIPIENT`.

If the domain currently serves the root `index.html` directly from Apache, point the domain/application routing to the Node.js app or remove the duplicate static entry pages. Otherwise the static and Express sites can appear inconsistent.
