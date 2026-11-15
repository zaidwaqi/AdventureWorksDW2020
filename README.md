# AdventureWorksDW2020 ERD

A local interactive schema explorer. The browser UI is static HTML, CSS, and JavaScript; a small Node.js server reads SQL Server catalog metadata and serves it to the UI. Database credentials stay on the local server and are never sent to the browser.

## Run

1. Install Node.js 18 or newer.
2. In PowerShell, set your SQL Server connection details for the current terminal:

   ```powershell
   $env:DB_SERVER = "sqldw.database.windows.net"
   $env:DB_NAME = "AdventureWorksDW2020"
   $env:DB_USER = "your-read-only-login"
   $env:DB_PASSWORD = "your-password"
   ```

   `DB_SERVER` is the server host, not a `server\database` pair. If your server or database differs, update the values accordingly.
3. Install dependencies and start the app:

   ```powershell
   npm install
   npm start
   ```
4. Open <http://localhost:3000>.

The login needs permission to read SQL Server catalog metadata (for example, `VIEW DEFINITION`) and should be read-only. The app only queries table, column, primary-key, and foreign-key metadata. It does not read table data.
