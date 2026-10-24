// Optional map tab (D9). Loaded only when opened; tiles need Internet, the list never does.
// Markers are plain circles, so no Leaflet image assets are needed.
import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { bandOf, displayScore, type Report } from '@relief-mesh/shared';
import { NEED_LABEL, ago } from './format.js';

const COLOR = { red: '#b00020', orange: '#c25e00', yellow: '#b8860b', done: '#6b7280' } as const;
const KOCHI: L.LatLngTuple = [9.98, 76.28];

export default function MapView({
  reports,
  hubNow,
  selectedId,
  onSelect,
}: {
  reports: Report[];
  hubNow: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const fitted = useRef(false);
  const [tiles, setTiles] = useState<'loading' | 'ok' | 'failed'>('loading');

  useEffect(() => {
    if (!box.current || map.current) return;
    const m = L.map(box.current, { zoomControl: true }).setView(KOCHI, 11);
    const t = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(m);
    t.on('tileload', () => setTiles('ok'));
    t.on('tileerror', () => setTiles((s) => (s === 'ok' ? s : 'failed')));
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    return () => {
      // Leaving the tab mid-animation would throw inside Leaflet; stop first, then remove.
      try {
        m.stop();
        m.remove();
      } catch {
        /* already gone */
      }
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    const g = layer.current;
    if (!m || !g) return;
    g.clearLayers();
    const points: L.LatLngTuple[] = [];
    for (const r of reports) {
      if (r.lat === null || r.lng === null) continue;
      const band = bandOf(r, hubNow);
      const sel = r.id === selectedId;
      const marker = L.circleMarker([r.lat, r.lng], {
        radius: sel ? 13 : 9,
        color: sel ? '#111' : '#fff',
        weight: sel ? 3 : 2,
        fillColor: COLOR[band],
        fillOpacity: band === 'done' ? 0.5 : 0.9,
      });
      marker.bindTooltip(
        `<strong>${displayScore(r, hubNow)}</strong> ${r.needs.map((n) => NEED_LABEL[n]).join(', ')} · ${r.peopleCount} people · ${ago(r.reportedAt, hubNow)}`,
      );
      marker.on('click', () => onSelect(r.id));
      marker.addTo(g);
      points.push([r.lat, r.lng]);
    }
    if (!fitted.current && points.length) {
      m.fitBounds(L.latLngBounds(points).pad(0.3), { maxZoom: 15, animate: false });
      fitted.current = true;
    }
  }, [reports, hubNow, selectedId, onSelect]);

  const without = reports.filter((r) => r.lat === null).length;
  return (
    <section className="mapwrap">
      <p className={'notice ' + (tiles === 'failed' ? 'bad' : '')} role="status">
        {tiles === 'failed'
          ? 'Map tiles are not loading (no Internet). Pins still show; the Reports list is complete without the map.'
          : 'Map tiles need Internet. The Reports list is complete without the map.'}
        {without > 0 && ` ${without} report${without === 1 ? '' : 's'} without a location ${without === 1 ? 'is' : 'are'} only in the list.`}
      </p>
      <div ref={box} className="map" role="application" aria-label="Map of reports" />
    </section>
  );
}
