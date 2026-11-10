# TL Pathak Sales App (Google Sheets + Apps Script)

- `index.html` – the app (host it on GitHub Pages).
- `config.json` – holds the web app URL so the whole team is connected.
- `apps-script/Code.gs` – the backend. It is pasted into a Google Sheet, not served from GitHub.

## Set up once (about 10 minutes)

### A. Backend (Google)
1. Create a new Google Sheet named **TL Pathak App Data**, using the Google account that owns the master catalog sheet.
2. Extensions → Apps Script. Delete what is there, paste all of `apps-script/Code.gs`, Save.
3. Choose the function `setup` and press Run. Allow the permissions (Advanced → Go to project, if Google warns that the app is unverified).
4. Deploy → New deployment → type **Web app** → Execute as **Me** → Who has access **Anyone** → Deploy. Copy the URL ending in `/exec`.

### B. App (GitHub)
5. Put the URL in `config.json`: `{ "apiUrl": "https://script.google.com/macros/s/.../exec" }`
6. Create a GitHub repo, upload `index.html`, `config.json` and this README. Settings → Pages → Deploy from branch → main / root.

### C. First use
7. Open the app and **register yourself first**. The first account becomes the administrator.
8. Change the master catalog sheet's sharing to **Restricted**. The app now reads it through the script.
9. Team members register in the app. Approve them in the app's admin screen, or tick `approved` in the **Users** tab.
   Tick `can_view_cost` only for people who may see purchase rates.

## Day to day
- Dealers, company logo and the sheet list are saved to the Google Sheet and shared with everyone straight away.
- Forgotten password: in the Google Sheet, menu **TL Pathak App → Reset a user password**.
- Remove a user: untick `approved` or delete the row in the Users tab.
- If you ever change `Code.gs`: Deploy → Manage deployments → Edit → Version: New version → Deploy (the URL stays the same).

## How purchase rates are protected
The script removes any catalog column whose header contains: cost, purchase, standard_price, buy price,
buying, dealer price, landed. Change `COST_HEADER` at the top of `Code.gs` if your headers differ.
Admins and users with `can_view_cost` receive those columns.
