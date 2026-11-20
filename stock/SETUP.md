# TL Pathak Stock Live — setup (about 15 minutes)

Stock is saved in your TL Pathak Google Sheet as three new tabs: **Stock**, **Stock_Locations** and **Stock_Log**. The stock app, the dashboard and Quote Maker all read from the same Sheet.

## 1. Backend (Google Apps Script)
1. Open your TL Pathak Google Sheet → **Extensions → Apps Script** → New file `StockAPI.gs` → paste the file.
2. Choose `setup` in the toolbar → **Run** → approve permissions.
   It creates the tabs (including **Stock_Users**), the admin account, your 8 locations, and a Drive folder called "TL Pathak Stock Photos".
3. **Project Settings → Script properties**:
   | Property | Value |
   |---|---|
   | `APP_SHEET_ID`, `APP_TOKEN_SECRET` | To share the dashboard's logins (see section 2). |
   | `GEMINI_KEY` | Your Gemini API key. It's used for photo reading and Ask the stock, and stays on the server. |
   | `GEMINI_MODEL` | Optional. Default is `gemini-3.8-flash`. Use any current free-tier model id from ai.google.dev/pricing. |
4. **Deploy → New deployment → Web app** → Execute as **Me** → Who has access **Anyone** → copy the `/exec` URL.
   After any later code change: **Deploy → Manage deployments → Edit → New version**. The URL stays the same.

## 2. Logins — same accounts as the TL Pathak dashboard (recommended)
The stock app can use the **same Users tab** as your dashboard / sales app. Same email, same password, same "Register here → admin approves" flow.
1. Open the dashboard's Google Sheet (**TL Pathak App Data**) and copy its ID from the URL (the long part between `/d/` and `/edit`).
2. Open the dashboard's Apps Script → **Project Settings → Script properties** and copy the value of `TOKEN_SECRET`.
3. In the **stock** Apps Script → **Script properties**, add:
   | Property | Value |
   |---|---|
   | `APP_SHEET_ID` | the dashboard sheet ID from step 1 |
   | `APP_TOKEN_SECRET` | the `TOKEN_SECRET` value from step 2 |
4. Run `setup()` again. It makes sure **pathakh@gmail.com** is an admin there. Sign in with your **dashboard password**.

How it works after that:
- **One sign-in for both apps.** Anyone signed in to the dashboard on a phone opens the stock app already signed in, and the other way round.
- **New people:** they tap **Register here** in either app, and you approve them in the dashboard's Users tab or in the stock app (**⚙ → Users & passwords → Approve**).
- **Who sees what:**
  - **Admin** (dashboard role "admin") manages everything.
  - **"Sees buy prices"** (the dashboard's `can_view_cost` tick) shows purchase bills, price lists, costs and margins.
  - Everyone else snaps machines, moves and sells stock, and records sales bills.
- **Access lists:** if a dashboard user has an `access` list (for example `finder,quotes`), add `stock` to it to let them in. Approving or saving them in the stock app does this for you.
- **Passwords:** password resets from the stock app give a one-time password, and the person picks a new one at first sign-in. The new password then works in the dashboard too.

*(Standalone, without `APP_SHEET_ID`: accounts live in the stock sheet's **Stock_Users** tab. `setup()` prints a one-time password for pathakh@gmail.com in View → Logs. Registration and approval work the same way.)*

## 2b. Stock app on phones
- The app is at **https://pathakh8.github.io/tlp-sales-app/stock/**.
- Put your stock `/exec` link in `stock/config.json` (safe in this public repo; never put passwords there).
- On the phone, use "Add to Home screen" so it opens like an app.

## 3. Link it into the dashboard
Paste `stock-widget.js` into the dashboard: as a `<script src>`, or the whole file inside a `<script>` tag in single-file HTML. Then:

```html
<div id="tlp-stock"></div>
<script>
  TLPStock.config({ api: 'YOUR_/exec_URL',
                    appUrl: 'https://pathakh8.github.io/tlp-sales-app/stock/' });
  TLPStock.mount('#tlp-stock');      // live stock card: totals, branches, search
  // TLPStock.embed('#tlp-stock');   // OR: the full stock app inside a dashboard tab
</script>
```

**Show stock next to a product (dashboard catalog or Quote Maker):**
```js
const a = await TLPStock.availability('6 ft lathe');
// a.text  → "Howrah HQ Showroom 3 · Bengaluru Showroom 1"
// a.free  → 3 (units not reserved or in transit)
```

**Read it directly from the Sheet:** your dashboard already syncs Sheets through GViz/XLSX, so it can also read the `Stock` tab. Its columns include `group`, `locationName`, `qty`, `status` and `specsText`.

## 4. Purchase invoices & buy prices (admin only)
- Sign in as an admin. The **Snap → Purchase bill** option, and the **Buys / Lists / Costs** sections in Bills, will appear.
- Every saved invoice writes to two tabs:
  - **Purchase_Invoices**: one row per invoice, with links to the invoice photos in Drive ("TL Pathak Purchase Invoices").
  - **Purchases**: one row per line, with group, rate, GST %, landed cost per unit and supplier. Point your dashboard's buy-price column at this tab.
- From code: `await TLPStock.buyPrices()` or `TLPStock.buyPrice('6 ft lathe')`, after an admin has signed in on that browser (the dashboard card shows a sign-in form).
- Purchase data is never sent to staff phones. The server returns it only to admin accounts.
- After updating `StockAPI.gs`, run `setup()` once more so it creates the two new tabs and the invoice folder. Then **Deploy → Manage deployments → Edit → New version**.

## 5. Sales invoices & clients
- **Snap → Sales bill:** photograph the bill you gave the customer. The AI reads the buyer's name, GSTIN, phone, email, address, the machines (with serial numbers) and the rates.
- Saving does three things:
  - takes the machines out of stock at the branch you picked
  - adds or updates the client in the **Clients** tab
  - writes the bill to **Sales_Invoices** and each line to **Sales**
- Bill photos are stored in the Drive folder "TL Pathak Sales Invoices".
- The **Clients** tab works as your CRM list, so the dashboard and Quote Maker can read customers from there.
- Margin (sale rate minus landed buy cost) is worked out in the app and shown to admins only.

## 6. Manufacturer price lists (admin)
- Go to **Bills → Lists → Add price list**. You can add photos of the pages, a PDF (up to 40 pages) or an Excel/CSV file.
- The AI pulls out every priced item and sorts it by category and stock group. Spares are kept separate as "(spares)". It also picks up the dealer discount if the list mentions one.
- These are saved to the **Price_Lists** tab (one row per list) and **Price_List_Items** (one row per model), including the net price after your discount.
- The **Costs** tab compares your real invoice prices with the cheapest net price from your price lists. When you have no purchase invoice for a machine, the margin is worked out from the price list.

## Good to know
- "Real time" means every phone and the dashboard checks for changes every 8–20 seconds.
- Photos are stored in your Google Drive. Anyone with a photo's link can view it.
- Each person has their own email and password. Passwords are stored only as salted hashes in the **Stock_Users** tab. Sign-ins last 30 days per phone. Disabling a user signs them out everywhere.

## Automatic updates
- **The app:** every change pushed to `stock/` on `main` goes live on GitHub Pages within about a minute. Staff just refresh.
- **The backend (optional):** `.github/workflows/stock-apps-script.yml` pushes `stock/apps-script/` to Google and redeploys the **same** `/exec` URL whenever it changes. To switch it on:
  1. On your computer: `npm i -g @google/clasp@2`, then `clasp login`. Copy the contents of `~/.clasprc.json`.
  2. In GitHub, go to **Settings → Secrets and variables → Actions** and add:
     - `CLASPRC_JSON`: the copied file
     - `STOCK_SCRIPT_ID`: Apps Script → Project Settings → Script ID
     - `STOCK_DEPLOYMENT_ID`: Deploy → Manage deployments → Deployment ID
  3. Enable the Apps Script API at https://script.google.com/home/usersettings.
  Use a **separate** Apps Script project just for the stock app (bound to your Sheet). clasp replaces every file in that project.
  Until the secrets are added, the workflow skips quietly, and you can keep pasting `StockAPI.gs` by hand.
