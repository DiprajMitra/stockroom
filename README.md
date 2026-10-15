# Inventory Control System

A full-stack inventory management application with role-based access control, built for the **CSE212 (B2) Database Systems Lab** at the **University of Asia Pacific**.

The system tracks products, categories, suppliers, purchases, and sales, and computes tax on every transaction — with defence-in-depth authorisation enforced at both the API layer and the database layer.

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Quick Start](#quick-start)
- [Database Setup](#database-setup)
- [Demo Accounts](#demo-accounts)
- [Optional: TNS alias from a FreeSQL wallet](#optional-tns-alias-from-a-freesql-wallet)
- [Project Structure](#project-structure)
- [Security Notes](#security-notes)
- [Smoke Test](#smoke-test)
- [Contributing](#contributing)
- [License](#license)
- [Team](#team)

---

## Overview

This project is a database-driven inventory control system that demonstrates a complete CRUD workflow over a normalised relational schema. It is designed as a teaching artifact for a database systems course, with explicit attention to:

- A well-modelled schema (roles, users, categories, suppliers, products, purchases, sales).
- PL/SQL triggers, packages, and stored procedures that enforce business rules.
- A Node.js/Express backend that mediates all access between the browser and the database.
- A vanilla JavaScript frontend served as a single-page application.
- Role-based access control enforced at three independent layers.

---

## Features

- **Overview Dashboard** — Today's sales, inventory value, product count, and low-stock alerts at a glance.
- **Product Management** — Add, update, delete, and search products with SKU uniqueness, price, reorder level, and per-product tax override.
- **Categories** — Group products and set default tax rates (0–100%). Past sales retain the rate that was in effect at the time of sale.
- **Suppliers** — Maintain supplier contact details and view per-supplier purchase history.
- **Purchases** — Record stock received from suppliers; product stock is incremented atomically.
- **Sales** — Bill customers with automatic tax calculation; over-selling is rejected at the database level.
- **Receipts** — One-click printable receipts with subtotal, tax, and grand total.
- **Tax and Stock Reports** — Current stock by category, low-stock alerts, sales per day, best sellers, and tax collected by period.
- **Users and Roles** — Admin-managed staff accounts with three roles: Admin, Sales staff, and Inventory clerk.
- **Defence in Depth** — Authorisation is enforced in the Express server *and* in PL/SQL triggers and stored procedures, so the database refuses the operation even if the server check is bypassed.

---

## Tech Stack

| Layer       | Technology                                                   |
|-------------|--------------------------------------------------------------|
| Frontend    | HTML5, CSS3, Vanilla JavaScript                              |
| Backend     | Node.js, Express 5                                           |
| Database    | Oracle 26ai (FreeSQL / Oracle Autonomous) — mTLS via wallet  |
| DB Driver   | `oracledb` (thick mode)                                      |
| Auth        | Session token stored server-side; hashed passwords in DB     |
| Fonts       | Manrope, IBM Plex Mono (Google Fonts)                        |

---

## Architecture

```
+------------------+        HTTP/JSON        +------------------+        SQL/PLSQL       +------------------+
|   Browser SPA    |  ---------------------> |  Express Server  |  ---------------------> |  Oracle 26ai DB   |
|  (index.html)    |   /api/*  + static /   |    (server.js)   |     oracledb (TCPS)   |  (FreeSQL wallet) |
|  +  js/api.js    |                        |  role-gate 403   |                        |  triggers + procs |
+------------------+                        +------------------+                        +------------------+
```

Role checks happen at three independent layers:

1. **Server** — every `/api/*` handler verifies the session role and returns `403` if disallowed.
2. **Triggers** — `trg_purchases_bi` and `trg_sales_bi` call `check_role(...)` and raise `ORA-20001` if the role is not allowed.
3. **Stored procedures** — for example, `sp_create_purchase` re-checks the role as a final safety net.

---

## Quick Start

### 1. Prerequisites

- **Node.js** 18+ and **npm**
- An **Oracle 26ai / FreeSQL** workspace (or any Oracle 19c+ instance with the required privileges)
- **Oracle Instant Client 23ai** on the machine that runs `npm start` (`libclntsh.so` on Linux, `oci.dll` on Windows, `libclntsh.dylib` on macOS). The free [Basic Light](https://www.oracle.com/bz/database/technologies/instant-client/linux-x86-64-downloads.html) package is enough.
- A free TCP path to `db.freesql.com:2484` (or your instance's host/port)

> **No wallet is required for the default setup.** FreeSQL accepts an EZ connect string over public TCPS and authenticates the server with a public CA-signed cert; the client only validates the cert, no `cwallet.sso` is needed. If you want to harden the connection with `SSL_SERVER_DN_MATCH` cert pinning, see [Optional: TNS alias from a FreeSQL wallet](#optional-tns-alias-from-a-freesql-wallet) below.

### 2. Clone the repository

```bash
git clone https://github.com/<your-org>/inventory-control-system.git
cd inventory-control-system
```

### 3. Install dependencies

```bash
npm install
```

This installs `express`, `oracledb`, and `dotenv`.

### 4. Configure environment variables

The server reads its config from a `.env` file at startup (loaded by `dotenv`), so you only need to edit one place.

```bash
cp .env.example .env
```

Then open `.env` and fill in three values:

| Variable                  | Meaning                                                                                                |
|---------------------------|--------------------------------------------------------------------------------------------------------|
| `ORACLE_USER`             | Your FreeSQL schema user (for example, `SQL_XXXX_SCHEMA_XXXX`).                                        |
| `ORACLE_PASSWORD`         | That schema user's password.                                                                           |
| `ORACLE_CONNECT_STRING`   | Full EZ connect string. The default `tcps://db.freesql.com:2484/26ai_un3c1` is the public FreeSQL endpoint. |

Example `.env`:

```env
ORACLE_USER=YOUR_SCHEMA_USER
ORACLE_PASSWORD=your_password_here
ORACLE_CONNECT_STRING=tcps://db.freesql.com:2484/26ai_un3c1
```

> `.env` is **gitignored** — never commit it. Any values already in your shell environment take precedence over `.env`, so production deploys that inject secrets at the platform level are unaffected.

If you prefer to skip `.env` and export variables in your shell instead, that still works:

**Windows (CMD)**

```bat
set ORACLE_USER=YOUR_SCHEMA
set ORACLE_PASSWORD=YOUR_PASSWORD
set ORACLE_CONNECT_STRING=tcps://db.freesql.com:2484/26ai_un3c1
```

**Windows (PowerShell)**

```powershell
$env:ORACLE_USER = "YOUR_SCHEMA"
$env:ORACLE_PASSWORD = "YOUR_PASSWORD"
$env:ORACLE_CONNECT_STRING = "tcps://db.freesql.com:2484/26ai_un3c1"
```

**macOS / Linux**

```bash
export ORACLE_USER=YOUR_SCHEMA
export ORACLE_PASSWORD=YOUR_PASSWORD
export ORACLE_CONNECT_STRING=tcps://db.freesql.com:2484/26ai_un3c1
```

### 5. Provision the database

See the [Database Setup](#database-setup) section below for the full schema, views, triggers, package, and seed data.

### 7. Start the server

```bash
npm start
```

The server will boot without errors if the wallet and credentials are configured correctly. By default:

- **Frontend:**  http://localhost:3000/
- **API root:**  http://localhost:3000/api/

Open the frontend URL in your browser and log in with one of the [demo accounts](#demo-accounts).

> **Prerequisite check.** Before the server can serve traffic, one thing must be true on the machine running `npm start`:
>
> 1. The Oracle Client libraries are present (`libclntsh.so` on Linux, `oci.dll` on Windows, `libclntsh.dylib` on macOS). If missing, `oracledb` throws `DPI-1047` on boot. Install **Oracle Instant Client** for your OS.
>
> No wallet is needed for the default EZ connect string setup. If you opt into the [wallet / TNS alias path](#optional-tns-alias-from-a-freesql-wallet) instead, `TNS_ADMIN` must also point at a folder containing `tnsnames.ora` and `cwallet.sso`.

### 8. (Optional) Run the database smoke test

```bash
npm run test:db
```

Expected output: `Connection was successful!` and the Oracle banner.

---

## Optional: TNS alias from a FreeSQL wallet

The default config uses an **EZ connect string** (`tcps://host:port/service`) and connects straight over public TCPS — no wallet, no `tnsnames.ora` lookup, no cert pinning. This is the simplest setup and works for development and most teaching deployments.

If you want to harden the connection (for example, to enforce `SSL_SERVER_DN_MATCH` so the client refuses any cert that doesn't match the wallet's expected DN), download the wallet from the FreeSQL/OCI console and switch to the TNS-alias path:

1. In the FreeSQL/OCI console, open your database and download the wallet zip.
2. Unzip it somewhere readable, e.g. `~/oracle_wallet/`. The folder will contain `tnsnames.ora`, `sqlnet.ora`, `cwallet.sso`, `ewallet.p12`, and a truststore.
3. Edit `.env`:
   ```env
   ORACLE_CONNECT_STRING=
   TNS_ADMIN=/home/you/oracle_wallet
   ORACLE_TNS_ALIAS=26ai_un3c1_tcps
   ```
4. Restart the server. `initOracleClient` will load the wallet and `oracledb` will resolve `ORACLE_TNS_ALIAS` from `tnsnames.ora`.

When `TNS_ADMIN` is set, the server takes the wallet path. When it is empty, the server falls back to the EZ connect string.

---

## Database Setup

All SQL files live in the [`database/`](database/) folder.

| File                                      | Purpose                                                                                                |
|-------------------------------------------|--------------------------------------------------------------------------------------------------------|
| `inventory_control_system_oracle.sql`     | Full Oracle 26ai (FreeSQL) DDL + DML + views + triggers + package + report procedures. Idempotent.     |
| `seed_bangladesh_demo.sql`                | Standalone Bangladesh-flavoured seed data for re-seeding an existing schema.                           |
| `inventory_control_system.sql`            | The original MySQL 8.0+ script (kept for reference).                                                  |

### First-time setup (Oracle 26ai / FreeSQL)

1. Sign in to the **FreeSQL worksheet** as your schema user (for example, `SQL_XXXX_SCHEMA_XXXX`).
2. Open `database/inventory_control_system_oracle.sql` in the worksheet.
3. Press **F5** (*Run Script*).

The script will:

- Drop any previous copy of the schema.
- Create **tables**, **views**, **triggers**, the **PL/SQL package**, the role-check procedure, and the report procedures.
- Insert **seed data**: 7 users, 8 categories, 6 suppliers, 20 products, 5 purchases, 15 sales spread over 6 days (4 products will end up below their reorder level).

### Re-seeding with the Bangladesh demo data

Paste and run this block in the worksheet first. It wipes transactional data but keeps the three demo logins:

```sql
BEGIN
  app_ctx_pkg.set_role('admin');
  DELETE FROM sale_items;
  DELETE FROM sales;
  DELETE FROM purchase_items;
  DELETE FROM purchases;
  UPDATE products SET current_stock = 0;
  DELETE FROM products;
  DELETE FROM suppliers;
  DELETE FROM categories;
  DELETE FROM users WHERE username NOT IN ('zubaer','nasim','dipraj');
  DELETE FROM roles;
  app_ctx_pkg.set_role(NULL);
END;
/
COMMIT;
/
```

Then open `database/seed_bangladesh_demo.sql` and press **F5**.

---

## Demo Accounts

The three primary accounts are always available. The other four are inserted by `seed_bangladesh_demo.sql`.

| Role             | Username   | Password   |
|------------------|------------|------------|
| Admin            | `zubaer`   | `admin123` |
| Sales staff      | `nasim`    | `sales123` |
| Sales staff      | `arif`     | `arif123`  |
| Sales staff      | `tania`    | `tania123` |
| Inventory clerk  | `dipraj`   | `stock123` |
| Inventory clerk  | `rakib`    | `rakib123` |
| Inventory clerk  | `sumaiya`  | `sumaiya123` |

> The login page also has one-click "fill" buttons for the three primary accounts.

---

## Project Structure

```
inventory-control-system/
|-- index.html                            # Frontend (login + dashboard + all CRUD pages)
|-- css/
|   `-- style.css                         # Styling
|-- js/
|   |-- api.js                            # HTTP client (talks to /api/*)
|   `-- script.js                         # UI behaviour and rendering
|-- server.js                             # Express server + Oracle data access
|-- test_oracledb.js                      # One-shot Oracle connection smoke test
|-- database/
|   |-- inventory_control_system_oracle.sql   # Oracle 26ai / FreeSQL schema + seed
|   |-- seed_bangladesh_demo.sql              # Re-seed with BD demo data
|   `-- inventory_control_system.sql         # Original MySQL 8.0+ script
|-- .env.example                          # Template for .env (commit this; copy to .env)
|-- .gitignore                            # Excludes .env, node_modules, scratch files
|-- package.json
`-- README.md
```

---

## Security Notes

- **Passwords** are stored as hashes in the `users` table.
- **Sessions** are in-memory tokens, which is acceptable for a classroom demo; swap for Redis or a JWT scheme in production.
- **SQL injection** is prevented by using bind variables throughout `server.js`.
- **mTLS** is **not** required by FreeSQL. The default setup uses a public CA-signed server cert and validates it via the system trust store. For production-grade cert pinning, see the [wallet / TNS alias path](#optional-tns-alias-from-a-freesql-wallet).
- **Defence in depth** — authorisation is verified in the server, in triggers, and in stored procedures. See the [Architecture](#architecture) section.

If you fork this project for anything beyond a classroom demo, please:

1. ~~Move the database password out of `server.js` and into environment variables.~~ **Done** — the server now reads `ORACLE_USER` and `ORACLE_PASSWORD` from `.env` via `dotenv`.
2. Replace the in-memory session store with a persistent one.
3. Add rate limiting and CSRF protection to the API.
4. Enable HTTPS termination at a reverse proxy (Nginx, Caddy, and so on).

---

## Smoke Test

Verify your Oracle connectivity independently of the full server. `test_oracledb.js` reads the same `.env` file as the server, so a working `.env` covers both:

```bash
# Make sure .env is in place first (see step 4)
npm run test:db
```

If you prefer to export variables in the shell instead, the script will pick those up too:

```bash
# Windows
set TNS_ADMIN=C:\path\to\oracle_wallet

# macOS / Linux
export TNS_ADMIN=/path/to/oracle_wallet

npm run test:db
```

---

## Contributing

1. Fork the repository.
2. Create a feature branch: `git checkout -b feat/your-feature`
3. Commit your changes: `git commit -m "Add your feature"`
4. Push the branch: `git push origin feat/your-feature`
5. Open a Pull Request.

Please keep credentials out of version control and update the README when you change the setup steps.

---

## License

This project is licensed under the **MIT License**.

```
MIT License

Copyright (c) 2025 Md. Zubaer, Nasim Mahmud, Dipraj Mitra Chandon

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## Team

**CSE212 (B2) — Database Systems Lab**  
**University of Asia Pacific**

| Name                       | Student ID  |
|----------------------------|-------------|
| Md. Zubaer                 | 24101106    |
| Nasim Mahmud               | 24201104    |
| Dipraj Mitra Chandon       | 24201091    |

**Submitted to:** Dr. Subhra Prosun Paul
