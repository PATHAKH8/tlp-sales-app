# TL Pathak Stock Live — setup (about 15 minutes)

Stock is saved in your TL Pathak Google Sheet as three new tabs: **Stock**, **Stock_Locations** and **Stock_Log**. The stock app, the dashboard and Quote Maker all read from the same Sheet.

## 1. Backend (Google Apps Script)
1. Open your TL Pathak Google Sheet → **Extensions → Apps Script** → New file `StockAPI.gs` → paste the file.
2. Choose `setup` in the toolbar → **Run** → approve permissions.
   It creates the 3 tabs, your 8 locations, and a Drive folder called "TL Pathak Stock Photos".
3. **Project Settings → Script properties**:
   | Property | Value |
   |---|---|
   | `TOKEN` | Created for you (see the Execution log). This is the team key. |
   | `ADMIN_PIN` | Your own PIN. Replace the default `0000`. |
   | `GEMINI_KEY` | Your Gemini API key. It's used for photo reading and Ask the stock, and stays on the server. |
   | `GEMINI_MODEL` | Optional. Default is `gemini-3.8-flash`. Use any current free-tier model id from ai.google.dev/pricing. |
4. **Deploy → New deployment → Web app** → Execute as **Me** → Who has access **Anyone** → copy the `/exec` URL.
   After any later code change: **Deploy → Manage deployments → Edit → New version**. The URL stays the same.

## 2. Stock app (staff phones)
1. The app lives in this repo's `stock/` folder, so GitHub Pages serves it at **https://pathakh8.github.io/tlp-sales-app/stock/**. Paste your `/exec` URL into `stock/config.json` so staff only need the team key. Don't put the team key in this public repo.
2. Open it → ⚙ → enter your name, the `/exec` URL, the team key and your admin PIN.
3. **Places → Staff setup link** → pick a branch → copy the link and send it on WhatsApp.
   Staff tap it once, enter their name, and start snapping.
   Tip: on the phone, use "Add to Home screen" so it opens like an app.

## 3. Link it into the dashboard
Paste `stock-widget.js` into the dashboard: as a `<script src>`, or the whole file inside a `<script>` tag in single-file HTML. Then:

```html
<div id="tlp-stock"></div>
<script>
  TLPStock.config({ api: 'YOUR_/exec_URL', token: 'YOUR_TEAM_KEY',
                    appUrl: 'https://YOUR-GITHUB.github.io/REPO/stock.html' });
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
- In the app, unlock admin with your PIN (⚙). The **Snap → Purchase invoice** option and the **Buy** tab will appear.
- Every saved invoice writes to two tabs:
  - **Purchase_Invoices**: one row per invoice, with links to the invoice photos in Drive ("TL Pathak Purchase Invoices").
  - **Purchases**: one row per line, with group, rate, GST %, landed cost per unit and supplier. Point your dashboard's buy-price column at this tab.
- From code: `await TLPStock.buyPrices(PIN)` or `TLPStock.buyPrice('6 ft lathe', PIN)`. Use these only in the admin side of your dashboard.
- Purchase data is never sent to staff phones. The server returns it only with the admin PIN.
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
- The team key keeps outsiders out. Anyone who has it can change stock, so change `TOKEN` if a staff member leaves.

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
