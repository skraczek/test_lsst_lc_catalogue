// Rubin Lightcurve Explorer
// Single-file React app + optional Node proxy example and deployment notes.
// Save this as README style combined file. The main React component is at the bottom
// (App.jsx). Tailwind classes are used and the app expects to be served as a static
// site (GitHub Pages). Because TAP endpoints often require CORS/auth, a small
// proxy (Node) is provided in the "server-proxy" section below — deploy it as a
// serverless function (Netlify, Vercel) or small Express app. If you prefer
// no-backend, you can modify fetchTarget to directly call a CORS-enabled TAP.

/* --------------------------------------------------------------------------
   README / Deployment notes (PL)
   --------------------------------------------------------------------------
   Co robi aplikacja:
   - pozwala wpisać RA, DEC i promień żeby pobrać "long cadence" / forced-source data
     przez ADQL (endpoint musi być dostępny przez /api/adql proxy albo bezpośrednio)
   - wyświetla kolejne krzywe blasku (renderowane klient-side przy pomocy canvas/Chart.js)
   - pozwala dopisać do danego obiektu: nazwę, kategorię i opis
   - tworzy tabelę/galerię elementów z PNG krzywej, opisem, współrzędnymi
   - anotacje są domyślnie zapisywane w localStorage (możesz wskazać serwer do przechowywania)

   Co musisz zrobić, żeby odpalić na GitHub Pages:
   1) Utwórz repo (np. `rubin-lightcurve-explorer`) i wrzuć pliki z sekcji `front-end`.
   2) Jeśli twój TAP endpoint wymaga tokena/CORS, wdroż mały proxy (sekcja `server-proxy`) jako
      funkcję serverless (Netlify/Vercel) albo jako mały Express na VPS.
      Skonfiguruj w nim zmienne środowiskowe: TAP_URL i (opcjonalnie) TAP_TOKEN.
   3) W ustawieniach GitHub Pages wskaż branch `main` / folder `docs` albo użyj workflow CI
      który deployuje build (jeśli używasz bundlera). Ten projekt jest jednak "single-file"
      i może działać jako statyczny HTML bez build kroków.

   Uwaga techniczna:
   - Qserv / TAP Rubinowy może mieć inne nazwy schematów i kolumn (DP vs DR). Sprawdź
     schema browser i w razie potrzeby dostosuj ADQL w `buildAdqlForRegion`.
   - Jeśli chcesz trwale przechowywać adnotacje wielu użytkowników, rozważ backend
     (Firebase, Supabase, GitHub Issues/Discussions API, czy prosty DB + serverless API).

   --------------------------------------------------------------------------
   server-proxy (optional) - Node.js Express / serverless function example
   --------------------------------------------------------------------------
   // Save as server/index.js (or use as Netlify/Vercel serverless function)

   /*
   const express = require('express');
   const fetch = require('node-fetch');
   const bodyParser = require('body-parser');
   const app = express();
   app.use(bodyParser.json());

   const TAP_URL = process.env.TAP_URL || 'https://data.lsst.cloud/api/tap';
   const TAP_TOKEN = process.env.TAP_TOKEN || '';

   app.post('/api/adql', async (req, res) => {
     try {
       const { adql } = req.body;
       if (!adql) return res.status(400).json({ error: 'no adql provided' });
       const resp = await fetch(TAP_URL + '/sync', {
         method: 'POST',
         headers: {
           'Content-Type': 'application/x-www-form-urlencoded',
           ...(TAP_TOKEN ? { Authorization: `Bearer ${TAP_TOKEN}` } : {}),
         },
         body: `REQUEST=doQuery&LANG=ADQL&FORMAT=json&QUERY=${encodeURIComponent(adql)}`,
       });
       const text = await resp.text();
       // try parse JSON, otherwise forward as text
       try { res.json(JSON.parse(text)); } catch(e) { res.type('text').send(text); }
     } catch (err) {
       console.error(err);
       res.status(500).json({ error: err.message });
     }
   });

   const port = process.env.PORT || 3000;
   app.listen(port, () => console.log('proxy listening on', port));
   */

/* --------------------------------------------------------------------------
   front-end (single-file React component)
   --------------------------------------------------------------------------
   Save this as src/App.jsx and serve as index.html with React + ReactDOM from CDNs,
   or use your bundler. This file is self-contained and uses fetch('/api/adql') to
   request ADQL results. If you don't use a proxy, change ADQL_POST_URL to the TAP
   full URL and be aware of CORS/auth.
*/

import React, { useState, useEffect, useRef } from 'react';

export default function App() {
  // configuration
  const ADQL_POST_URL = '/api/adql'; // <- change to your proxy or full TAP endpoint

  const [ra, setRa] = useState('150.0');
  const [dec, setDec] = useState('2.0');
  const [radius, setRadius] = useState('0.2'); // degrees
  const [limit, setLimit] = useState(20);
  const [loading, setLoading] = useState(false);
  const [objects, setObjects] = useState([]); // {objectId, ra, dec, measurements: [{mjd, mag, magerr}], annotations}
  const [currentIndex, setCurrentIndex] = useState(0);

  const chartRef = useRef(null);

  useEffect(() => {
    // load annotations from localStorage
    const stored = localStorage.getItem('rle_annotations_v1');
    if (stored) {
      try { const ann = JSON.parse(stored); setObjects(ann); } catch(e){}
    }
  }, []);

  useEffect(() => {
    // save to localStorage whenever objects change
    localStorage.setItem('rle_annotations_v1', JSON.stringify(objects));
  }, [objects]);

  function buildAdqlForRegion(raVal, decVal, radiusDeg, limitVal) {
    // NOTE: adjust schema/table/column names to your Rubin instance.
    // This ADQL expects a table `forced_source` with columns: objectId, ra, dec, mjd, mag
    // Replace with the actual table names in your TAP schema.
    return `
SELECT objectId, ra, dec, mjd, psfFluxMag as mag, psfFluxMagErr as magerr, filter
FROM dp02_dc2_catalogs.ForcedSource
WHERE CONTAINS(POINT('ICRS', ra, dec), CIRCLE('ICRS', ${raVal}, ${decVal}, ${radiusDeg}))=1
ORDER BY objectId, mjd
LIMIT ${limitVal * 1000}
`;
  }

  function groupByObject(rows) {
    // rows: array of row objects
    const map = new Map();
    for (const r of rows) {
      const oid = r.objectId || r.objid || r.id || r['object id'] || r['objectId'];
      if (!map.has(oid)) map.set(oid, { objectId: oid, ra: r.ra ?? r.coord_ra, dec: r.dec ?? r.coord_dec, measurements: [] });
      map.get(oid).measurements.push({ mjd: Number(r.mjd), mag: Number(r.mag), magerr: Number(r.magerr), filter: r.filter });
    }
    return Array.from(map.values()).map(obj => ({ ...obj, measurements: obj.measurements.sort((a,b)=>a.mjd-b.mjd) }));
  }

  async function fetchRegion() {
    setLoading(true);
    try {
      const adql = buildAdqlForRegion(ra, dec, radius, limit);
      const resp = await fetch(ADQL_POST_URL, {
        method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ adql })
      });
      const data = await resp.json();
      // Try to interpret VOTable/JSON results. This assumes TAP returned JSON rows array.
      // If your TAP returns VOtable or a different format, adapt parser.
      let rows = [];
      if (Array.isArray(data)) rows = data; // already rows
      else if (data && data.result && Array.isArray(data.result)) rows = data.result;
      else if (data && data.data) rows = data.data; // some TAP wrappers
      else if (data && data.rows) rows = data.rows;
      else if (data && data['fields'] && data['data']) {
        // ADQL sync JSON: fields + data
        const fields = data.fields.map(f=>f.name);
        rows = data.data.map(r=>{
          const obj = {};
          for(let i=0;i<fields.length;i++) obj[fields[i]] = r[i];
          return obj;
        });
      }

      const objs = groupByObject(rows).slice(0, limit);
      // merge with existing annotations (if any)
      const merged = objs.map(o => {
        const existing = objects.find(x=>x.objectId==o.objectId);
        return existing ? { ...o, annotations: existing.annotations || {} } : { ...o, annotations: { name:'', category:'', note:'' } };
      });
      setObjects(merged);
      setCurrentIndex(0);
    } catch (err) {
      console.error(err);
      alert('Błąd podczas pobierania. Sprawdź konsolę i proxy.');
    } finally { setLoading(false); }
  }

  function saveAnnotationForCurrent(changes) {
    setObjects(prev => prev.map((o, idx) => idx===currentIndex ? { ...o, annotations: { ...o.annotations, ...changes } } : o));
  }

  function exportTableCSV() {
    const rows = objects.map(o => {
      const png = o.png || '';
      const name = o.annotations?.name || '';
      const cat = o.annotations?.category || '';
      const note = (o.annotations?.note || '').replace(/\n/g, ' ');
      return `"${o.objectId}","${o.ra}","${o.dec}","${name}","${cat}","${note}","${png}"`;
    });
    const header = 'objectId,ra,dec,name,category,note,png';
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'rubin_annotations.csv'; a.click(); URL.revokeObjectURL(url);
  }

  function renderCurrentChartAsPng() {
    const obj = objects[currentIndex];
    if (!obj) return;
    const cvs = chartRef.current?.querySelector('canvas');
    if (!cvs) return;
    const png = cvs.toDataURL('image/png');
    setObjects(prev => prev.map((o, idx) => idx===currentIndex ? { ...o, png } : o));
    alert('Zapisano PNG do listy (localStorage). Możesz eksportować CSV by zapisać do pliku.');
  }

  return (
    <div className="min-h-screen p-6 bg-gray-50">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-3xl font-bold mb-4">Rubin Lightcurve Explorer (front-end)</h1>

        <section className="mb-6 p-4 bg-white rounded-2xl shadow-sm">
          <div className="flex gap-3 flex-wrap">
            <label className="flex items-center gap-2">RA<input className="input" value={ra} onChange={e=>setRa(e.target.value)} /></label>
            <label className="flex items-center gap-2">DEC<input className="input" value={dec} onChange={e=>setDec(e.target.value)} /></label>
            <label className="flex items-center gap-2">Radius [deg]<input className="input" value={radius} onChange={e=>setRadius(e.target.value)} /></label>
            <label className="flex items-center gap-2">Limit (objects)<input type="number" className="input w-24" value={limit} onChange={e=>setLimit(Number(e.target.value))} /></label>
            <button className="btn" onClick={fetchRegion} disabled={loading}>{loading ? 'Ładowanie...' : 'Pobierz ADQL'}</button>
            <button className="btn" onClick={exportTableCSV}>Eksport CSV</button>
          </div>

          <p className="text-sm text-gray-500 mt-2">Uwaga: dostosuj ADQL w kodzie do nazw tabel w Twoim TAP. Ten front-end używa POST /api/adql.</p>
        </section>

        <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2 p-4 bg-white rounded-2xl shadow-sm">
            <h2 className="text-xl font-semibold mb-2">Podgląd krzywej ({currentIndex+1}/{objects.length})</h2>
            {objects.length>0 ? (
              <div>
                <div ref={chartRef} className="w-full h-64 mb-3">
                  <LightcurveChart measurements={objects[currentIndex].measurements} />
                </div>
                <div className="flex gap-2 items-center">
                  <button className="btn" onClick={() => setCurrentIndex(i => Math.max(0, i-1))}>Prev</button>
                  <button className="btn" onClick={() => setCurrentIndex(i => Math.min(objects.length-1, i+1))}>Next</button>
                  <button className="btn" onClick={renderCurrentChartAsPng}>Zapisz PNG</button>
                </div>

                <div className="mt-4">
                  <h3 className="font-semibold">Adnotacje</h3>
                  <AnnotationEditor obj={objects[currentIndex]} onSave={saveAnnotationForCurrent} />
                </div>
              </div>
            ) : (
              <p>Brak obiektów. Wykonaj zapytanie ADQL.</p>
            )}
          </div>

          <div className="p-4 bg-white rounded-2xl shadow-sm">
            <h2 className="text-xl font-semibold mb-2">Lista / Galeria</h2>
            <div className="space-y-3 max-h-[60vh] overflow-auto">
              {objects.map((o, idx) => (
                <div key={o.objectId} className={`p-2 rounded-lg border ${idx===currentIndex ? 'border-indigo-400' : 'border-gray-200'}`}>
                  <div className="flex items-center gap-3">
                    <div className="w-20 h-14 bg-gray-100 flex items-center justify-center overflow-hidden">
                      {o.png ? <img src={o.png} alt="lc" className="w-full" /> : <div className="text-xs text-gray-400">no png</div>}
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-medium">{o.annotations?.name || o.objectId}</div>
                      <div className="text-xs text-gray-500">{o.ra}, {o.dec}</div>
                      <div className="text-xs text-gray-600 mt-1">{o.annotations?.category}</div>
                    </div>
                    <div>
                      <button className="btn" onClick={()=>setCurrentIndex(idx)}>Open</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <footer className="mt-6 text-sm text-gray-500">Wersja demo — adnotacje lokalne. Aby zapisywać centralnie, wdroż backend API i zmień fetch w `saveAnnotationForCurrent`.</footer>
      </div>
    </div>
  );
}


function AnnotationEditor({ obj, onSave }){
  const [name, setName] = useState(obj.annotations?.name||'');
  const [category, setCategory] = useState(obj.annotations?.category||'');
  const [note, setNote] = useState(obj.annotations?.note||'');
  useEffect(()=>{ setName(obj.annotations?.name||''); setCategory(obj.annotations?.category||''); setNote(obj.annotations?.note||''); }, [obj]);
  return (
    <div className="space-y-2">
      <input className="w-full input" placeholder="Nazwa" value={name} onChange={e=>setName(e.target.value)} />
      <input className="w-full input" placeholder="Kategoria" value={category} onChange={e=>setCategory(e.target.value)} />
      <textarea className="w-full textarea" rows={3} placeholder="Opis / notatki" value={note} onChange={e=>setNote(e.target.value)} />
      <div className="flex gap-2">
        <button className="btn" onClick={()=>onSave({ name, category, note })}>Zapisz</button>
      </div>
    </div>
  );
}

function LightcurveChart({ measurements }){
  const canvasRef = useRef(null);
  useEffect(()=>{
    if (!canvasRef.current) return;
    const cvs = canvasRef.current;
    const ctx = cvs.getContext('2d');
    // simple draw: MJD vs mag (invert y)
    ctx.clearRect(0,0,cvs.width,cvs.height);
    if (!measurements || measurements.length===0){ ctx.fillStyle='#888'; ctx.fillText('no data', 10, 20); return; }
    const margin = 40; const w = cvs.width - margin*2; const h = cvs.height - margin*2;
    const mjds = measurements.map(m=>m.mjd); const mags = measurements.map(m=>m.mag);
    const minM = Math.min(...mjds); const maxM = Math.max(...mjds);
    const minMag = Math.min(...mags); const maxMag = Math.max(...mags);
    function sx(m){ return margin + ( (m - minM) / (maxM - minM || 1) ) * w; }
    function sy(m){ return margin + (1 - ( (m - minMag) / (maxMag - minMag || 1) )) * h; }
    // axes
    ctx.strokeStyle = '#ccc'; ctx.beginPath(); ctx.moveTo(margin, margin); ctx.lineTo(margin, margin+h); ctx.lineTo(margin+w, margin+h); ctx.stroke();
    // points and line
    ctx.strokeStyle = '#0070f3'; ctx.fillStyle='#0070f3'; ctx.beginPath();
    measurements.forEach((pt,i)=>{
      const x = sx(pt.mjd); const y = sy(pt.mag);
      if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    }); ctx.stroke();
    measurements.forEach(pt=>{ const x=sx(pt.mjd); const y=sy(pt.mag); ctx.beginPath(); ctx.arc(x,y,2,0,Math.PI*2); ctx.fill(); });
    // labels
    ctx.fillStyle='#333'; ctx.fillText('MJD', cvs.width/2, cvs.height-6); ctx.fillText('mag (lower up)', 6, 12);
  }, [measurements]);

  return <div className="w-full h-full" style={{ minHeight: 220 }}><canvas ref={canvasRef} width={800} height={320} style={{ width: '100%', height: '100%' }} /></div>;
}

/* --------------------------------------------------------------------------
   Styling (add to your index.html head or global CSS)
   --------------------------------------------------------------------------
   .input { padding: 0.4rem .6rem; border-radius: .5rem; border: 1px solid #e5e7eb; }
   .textarea { padding: .5rem; border-radius: .5rem; border: 1px solid #e5e7eb; }
   .btn { padding: .4rem .7rem; background: #4f46e5; color: white; border-radius: .625rem; }

   You can also include Tailwind CDN in index.html for richer styling.

   Example index.html (simplified):
   <!doctype html>
   <html>
     <head>
       <meta charset="utf-8" />
       <meta name="viewport" content="width=device-width, initial-scale=1" />
       <title>Rubin Lightcurve Explorer</title>
       <script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
       <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
       <link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">
     </head>
     <body>
       <div id="root"></div>
       <script type="module" src="/src/App.jsx"></script>
     </body>
   </html>

   --------------------------------------------------------------------------
   Final notes:
   - Dostosuj ADQL do konkretnego schematu (DP vs DR). Jeśli chcesz, mogę przygotować
     wariant ADQL pod konkretną tabelę (podaj nazwę schematu/tabeli lub wskaż endpoint).
   - Jeśli chcesz, mogę też przygotować prosty Netlify/Vercel function z deploy-ready
     plikiem server/index.js i plikiem `netlify.toml`.
*/
