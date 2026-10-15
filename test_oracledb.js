/* =============================================================================
   test_oracledb.js  -  Smoke test for the FreeSQL (Oracle 26ai) connection.

   How to use it
   -------------
   1. Download the FreeSQL wallet zip (Wallet_*.zip) from the FreeSQL/OCI
      console.  Unzip it into a folder, e.g.  C:\oracle_wallet\ .
   2. Make sure the unzipped folder contains these files:
         tnsnames.ora
         sqlnet.ora
         ewallet.p12
         cwallet.sso
         truststore.jks / truststore.pem
   3. Set the TNS_ADMIN environment variable to that folder
         set TNS_ADMIN=C:\oracle_wallet
   4. Install the driver and run this file
         npm install oracledb
         node test_oracledb.js
   ============================================================================= */

const oracledb = require('oracledb');
const fs = require('fs');
const path = require('path');

// Load .env (gitignored) so TNS_ADMIN, ORACLE_USER, ORACLE_PASSWORD and
// ORACLE_TNS_ALIAS don't have to be exported manually for every run.
require('dotenv').config();

// 1) Load the wallet before anything else.  initOracleClient switches the
//    driver to THICK mode, which is what understands Oracle wallets and
//    mTLS (tcps://).  Thin mode does NOT support mTLS wallets.
const TNS_ADMIN = process.env.TNS_ADMIN;
if (!TNS_ADMIN) {
  console.error('TNS_ADMIN is not set.  Point it at the unzipped wallet folder.');
  process.exit(1);
}
if (!fs.existsSync(path.join(TNS_ADMIN, 'tnsnames.ora'))) {
  console.error('tnsnames.ora not found in', TNS_ADMIN);
  process.exit(1);
}
oracledb.initOracleClient({ configDir: TNS_ADMIN, walletLocation: TNS_ADMIN });

// 2) The actual connection settings.  Use the TNS alias that tnsnames.ora
//    defines (e.g. "26ai_un3c1" matches the connectString you used to paste,
//    but the *wallet* version is "<name>_tcp" / "<name>_tcps" etc. -
//    open tnsnames.ora and pick the alias that uses PROTOCOL=TCPS).
//
//    The tnsnames.ora in the FreeSQL wallet usually gives an alias like
//    "26ai_un3c1_tcps" or "26ai_un3c1_high".  Use that exact string here.
// Credentials come from the environment.  See .env (gitignored) for the
// actual values.  The connectString alias must match an entry in
// <TNS_ADMIN>/tnsnames.ora that uses PROTOCOL=TCPS.
const dbConfig = {
  user:          process.env.ORACLE_USER,
  password:      process.env.ORACLE_PASSWORD,
  connectString: process.env.ORACLE_TNS_ALIAS || '26ai_un3c1_tcps',
  // External auth is off; we are using a plain user/password.
};

async function run() {
  let connection;
  try {
    connection = await oracledb.getConnection(dbConfig);
    console.log('Connection was successful!');

    // Show the Oracle banner / version
    const r = await connection.execute(
      `SELECT BANNER, BANNER_FULL FROM V$VERSION FETCH FIRST 1 ROW ONLY`
    );
    console.log('Server says :', r.rows[0]);

    // and the schema we are connected as
    const r2 = await connection.execute(
      `SELECT SYS_CONTEXT('USERENV','CURRENT_USER') AS me,
              SYS_CONTEXT('USERENV','SERVICE_NAME')  AS svc
         FROM DUAL`
    );
    console.log('Connected as:', r2.rows[0]);
  } catch (err) {
    console.error('ERROR:', err.message);
    if (err.errorNum) console.error('ORA-', err.errorNum);
  } finally {
    if (connection) {
      try { await connection.close(); } catch (e) { console.error(e); }
    }
  }
}

run();
