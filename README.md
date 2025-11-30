# Rubin Lightcurve Explorer (minimal)

## Co to robi
Statyczna strona, która:
- wykonuje ADQL (przez proxy) i pobiera "forced source" / long-cadence dane,
- grupuje dane po `objectId`, rysuje krzywe blasku w canvas,
- umożliwia dopisanie nazwy/kategorii/opisu,
- zapisuje adnotacje i PNG krzywej w `localStorage`,
- eksportuje tabelę CSV (z PNG jako data-uri).

## Deployment (szybki)
1. Skopiuj pliki do repozytorium GitHub:
   - `index.html` w root (GitHub Pages).
   - `server/` (Express) wdroż na Vercel/Heroku/Netlify.

2. Wdrożenie proxy:
   - Vercel: utwórz projekt z katalogiem `server/`, ustaw zmienne środowiskowe `TAP_URL` i (opcjonalnie) `TAP_TOKEN`.
   - Netlify: możesz użyć Netlify Functions lub hostować Express w Layer (lub Heroku).

3. Ustaw ADQL POST URL:
   - Jeśli proxy jest wdrożone w `https://my-proxy.example.com/api/adql`, z konsoli przeglądarki wywołaj:
     `window.setAdqlUrl('https://my-proxy.example.com/api/adql')`
     lub edytuj `ADQL_POST_URL` w `index.html`.

## Dostosowanie ADQL
- Domyślny ADQL używa tabeli `dp02_dc2_catalogs.ForcedSource` oraz kolumn `objectId, ra, dec, mjd, psfFluxMag`.
- Dostosuj `DEFAULT_ADQL_TABLE` lub popraw aliasy kolumn w `index.html` jeśli Twój TAP używa innych nazw (DR vs DP).

## Uwaga o CORS / Tokenie
- TAP-e często nie wystawiają CORS dla stron publicznych lub wymagają tokenu. Proxy rozwiązuje oba problemy (w proxy ustaw TAP_TOKEN, jeśli potrzeba).

## Pomoc
Jeśli chcesz, dostosuję:
- ADQL do konkretnego schematu/tabeli (podaj nazwę tabeli i endpoint),
- gotowy deploy na Vercel z ustawionymi zmiennymi (dam instrukcję krok po kroku).
