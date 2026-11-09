TRIPS AGENDA - OPENROUTESERVICE VERSION (installable web app, works offline)
Appointment agenda with kilometre tracking. French / English.
This version does not use Google: place search and distances come from OpenRouteService (HeiGIT),
the map comes from OpenStreetMap. Free, no credit card.

1) HOST THE FILES (once)
   This folder contains only the app, no data. There are no subfolders.
   - GitHub: create a repository, Add file > Upload files, select ALL the files of the unzipped folder
     (18 files), wait until the upload finishes, then Commit changes.
     Check that every file appears in the repository, including leaflet.js and the .png icons.
   - Settings > Pages > Deploy from a branch > main / (root). Address: https://YOUR-NAME.github.io/REPOSITORY-NAME/
   Android (Chrome): menu (3 dots) > "Install app".   iPhone (Safari): Share > "Add to Home Screen".
   On first launch, choose a PIN (4 to 8 digits).
   This version keeps its own data: it never reads the data of the Google version, even on the same domain.
   To bring your data over: Settings > Backup in the old version, then "Restore a backup" here.

2) CREATE YOUR OPENROUTESERVICE KEY (once, free)
   a. Go to account.heigit.org, create an account (e-mail) and sign in.
   b. Create an API token / key (free "Standard" plan). Copy it.
   c. In the app: Settings > OpenRouteService key > paste it > "Test the key".
      The 3 lines must show a green check. A red cross shows the cause (key refused, quota, browser block).
   Important:
   - The old address api.openrouteservice.org stops in early November 2026. The app uses the new one,
     api.heigit.org. An existing key also works on the new address.
   - Unlike Google, the key cannot be restricted to your website. Keep it private: it stays on your phone
     and is never in the hosted files or in backups. If it leaks, generate a new one.
   - Free quotas are shown in your account. Previously: about 2,000 distance calculations and
     1,000 place searches per day. Each trip between the same two places is calculated only once, and
     place search waits until you have typed 3 letters.

3) USING THE APP
   Places     : add your places (search, point on the map, long Google Maps link, or coordinates
                "33.89, 35.50"). Set your home. Short links (maps.app.goo.gl) cannot be read.
   Agenda     : "+" for an appointment (date, start, end, departure, arrival). The distance (by car) is
                calculated automatically and can be corrected by hand. "Finish" updates the real end time.
                One return home per day, from the last arrival. It works like an appointment: start time
                (end of the last appointment) and end time (start + estimated driving time, 30 min if unknown),
                Finish, Edit (times, departure, distance), Directions and Cancel return.
   Mileage    : km per day, week, month, year or custom range, with cost (km x amount per km),
                Excel and PDF export.
   Offline    : agenda and places work without internet (the map and place search need internet).
                A distance that could not be calculated is retried when the connection returns
                (or use the "Calculate" button).
   Quality    : OpenStreetMap knows cities and main roads well, shops and street numbers less so.
                Check your usual places, and correct coordinates or distance by hand if needed.

4) YOUR DATA
   Stored only in the browser of THIS phone. Lost if you clear the site data or uninstall the app.
   The PIN locks the app; browser data is not encrypted on the phone.
   Settings > Backup: shareable file (WhatsApp, Drive, e-mail...), optional AES encryption with a password
   (without it the backup cannot be read), weekly/monthly reminder.
   The key and the PIN are never included in a backup.

5) UPDATING
   Replace the files on GitHub (all of them, including sw.js), then open the app twice:
   the 1st opening downloads the new version, the 2nd one shows it. Your data is kept.

Credits: data (c) OpenStreetMap contributors; services by OpenRouteService / HeiGIT;
map library Leaflet (BSD-2 licence, LEAFLET-LICENSE.txt).
