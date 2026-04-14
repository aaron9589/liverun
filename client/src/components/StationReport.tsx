import { useState } from 'react';
import type { Timetable } from '../types';

interface Props {
  timetable: Timetable;
  initialStationId: string | null;
  onClose: () => void;
}

function timeLabel(t: string | null | undefined): string {
  return t ?? '—';
}

type ServiceType = 'originates' | 'terminates' | 'calls';

interface ReportRow {
  trainId: string;
  trainName: string;
  trainRef: string;
  arrival: string | null;
  departure: string | null;
  serviceType: ServiceType;
  trainNotes: string;
  specialInstructions: string;
  color: string;
}

function minutesOf(t: string | null | undefined): number {
  if (!t) return Infinity;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function serviceTag(type: ServiceType): string {
  if (type === 'originates') return '[ORG]';
  if (type === 'terminates') return '[TRM]';
  return '[CAL]';
}

function buildPrintHtml(
  station: { name: string } | undefined,
  timetable: Timetable,
  rows: ReportRow[],
): string {
  const tableRows = rows.length === 0
    ? `<tr><td colspan="5">No trains scheduled at this location.</td></tr>`
    : rows.map((row, i) => {
        const name = `${row.trainName} ${serviceTag(row.serviceType)}`;
        const instr = row.specialInstructions ? `! ${row.specialInstructions}` : '';
        const rowStyle = i % 2 === 0 ? 'background-color:#f7f7e6;' : 'background-color:#ffffff;';
        return `<tr style="${rowStyle}">
          <td>${name}</td>
          <td style="text-align:center;">${timeLabel(row.arrival)}</td>
          <td style="text-align:center;">${timeLabel(row.departure)}</td>
          <td>${row.trainNotes || ''}</td>
          <td>${instr}</td>
        </tr>`;
      }).join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Register of Train Arrivals/Departures by Location</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Lexend:wght@400;700&display=swap" rel="stylesheet">
  <style>
    @page {
      size: A5 landscape;
      margin: 0.25in;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Courier New', Courier, monospace; font-size: 6pt; color: #000; background: white; }
    h2 { font-family: 'Courier New', Courier, monospace; font-size: 7pt; font-weight: normal; }
    h3 { font-family: 'Courier New', Courier, monospace; font-size: 6pt; font-weight: normal; }
    small { font-family: 'Courier New', Courier, monospace; font-size: 5pt; }
    .page-header { padding-bottom: 6px; }
    .page-header-rule { border-top: 1px dashed #000; margin: 4px 0; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; word-wrap: break-word; }
    thead { display: table-header-group; }
    th { font-family: Lexend, Arial, sans-serif; font-size: 6pt; font-weight: bold; letter-spacing: 0.02em; border: 1px solid #000; padding: 2px 3px; text-align: left; position: static; background: white; color: #000; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    td { font-family: Lexend, Arial, sans-serif; font-size: 6pt; font-weight: normal; letter-spacing: 0.01em; border: 1px solid #000; padding: 2px 3px; word-wrap: break-word; }
    tr { page-break-inside: avoid; }
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  </style>
</head>
<body>
  <div class="page-header">
    <h2>${timetable.name}</h2>
    <h3>Register of Train Arrivals/Departures by Location</h3>
    <h3>${station?.name ?? 'Station'}</h3>
    <div class="page-header-rule"></div>
    <small>Session: ${timetable.start_time}&#8211;${timetable.end_time}</small>
  </div>
  <table>
    <thead>
      <tr>
        <th style="width:14%;">TRAIN</th>
        <th style="width:7%;text-align:center;">ARR</th>
        <th style="width:7%;text-align:center;">DEP</th>
        <th style="width:33%;">NOTES</th>
        <th style="width:39%;">INSTRUCTIONS</th>
      </tr>
    </thead>
    <tbody>${tableRows}</tbody>
  </table>
  <div style="margin-top:4px;">
    <small>${rows.length} train${rows.length !== 1 ? 's' : ''} scheduled</small>
  </div>
</body>
</html>`;
}

export function StationReport({ timetable, initialStationId, onClose }: Props) {
  const [stationId, setStationId] = useState<string>(
    initialStationId ?? (timetable.stations[0]?.id ?? '')
  );

  const station = timetable.stations.find((s) => s.id === stationId);

  const rows: ReportRow[] = timetable.trains
    .flatMap((train) => {
      const stop = train.stops.find((s) => s.station_id === stationId);
      if (!stop) return [];
      const serviceType: ServiceType =
        !stop.arrival && stop.departure ? 'originates' :
        stop.arrival && !stop.departure ? 'terminates' : 'calls';
      return [{
        trainId: train.id,
        trainName: train.name,
        trainRef: train.train_id ?? '',
        arrival: stop.arrival,
        departure: stop.departure,
        serviceType,
        trainNotes: train.notes ?? '',
        specialInstructions: stop.special_instructions ?? '',
        color: train.color,
      }];
    })
    .sort((a, b) => minutesOf(a.arrival ?? a.departure) - minutesOf(b.arrival ?? b.departure));

  function handlePrint() {
    const win = window.open('', '_blank', 'width=1100,height=700');
    if (!win) return;
    win.document.write(buildPrintHtml(station, timetable, rows));
    win.document.close();
    win.focus();
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-slate-900 rounded-2xl border border-slate-700 shadow-2xl w-full max-w-2xl flex flex-col max-h-[85vh]">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 shrink-0">
            <div>
              <h2 className="text-lg font-semibold text-white">
                {station?.name ?? 'Station'} — Train Schedule
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">{timetable.name}</p>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              ✕
            </button>
          </div>

          {/* Station selector */}
          <div className="px-6 py-4 border-b border-slate-800 shrink-0">
            <label className="block text-xs font-medium text-slate-400 mb-1">Location</label>
            <select
              value={stationId}
              onChange={(e) => setStationId(e.target.value)}
              className="w-full rounded-lg bg-slate-800 border border-slate-600 px-3 py-2 text-white focus:outline-none focus:border-blue-500 text-sm"
            >
              {timetable.stations.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          {/* Table */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {rows.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-8">
                No trains scheduled at {station?.name ?? 'this location'}.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-slate-500 uppercase tracking-wide border-b border-slate-800">
                    <th className="text-left pb-2 pr-4 font-medium">Train</th>
                    <th className="text-left pb-2 pr-4 font-medium">Arrives</th>
                    <th className="text-left pb-2 pr-4 font-medium">Departs</th>
                    <th className="text-left pb-2 pr-4 font-medium">Notes</th>
                    <th className="text-left pb-2 font-medium">Instructions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {rows.map((row) => (
                    <tr key={row.trainId} className="align-top">
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-2">
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: row.color }}
                          />
                          <span className="text-white font-medium">{row.trainName}</span>
                          <ServiceBadge type={row.serviceType} />
                        </div>

                      </td>
                      <td className="py-3 pr-4 font-mono text-slate-300 whitespace-nowrap">
                        {timeLabel(row.arrival)}
                      </td>
                      <td className="py-3 pr-4 font-mono text-slate-300 whitespace-nowrap">
                        {timeLabel(row.departure)}
                      </td>
                      <td className="py-3 pr-4 text-slate-300 text-xs">
                        {row.trainNotes || <span className="text-slate-600">—</span>}
                      </td>
                      <td className="py-3">
                        {row.specialInstructions ? (
                          <p className="text-amber-300 text-xs">⚠ {row.specialInstructions}</p>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-3 border-t border-slate-800 shrink-0 flex items-center justify-between">
            <span className="text-xs text-slate-500">
              {rows.length} train{rows.length !== 1 ? 's' : ''} scheduled
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={handlePrint}
                className="px-4 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm transition-colors flex items-center gap-1.5"
              >
                <PrintIcon />
                Print
              </button>
              <button
                onClick={onClose}
                className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function ServiceBadge({ type }: { type: ServiceType }) {
  if (type === 'originates') return (
    <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-emerald-900/60 text-emerald-300 border border-emerald-700 shrink-0">
      Originates
    </span>
  );
  if (type === 'terminates') return (
    <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-blue-900/60 text-blue-300 border border-blue-700 shrink-0">
      Terminates
    </span>
  );
  return (
    <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-slate-700/60 text-slate-400 border border-slate-600 shrink-0">
      Calls
    </span>
  );
}

function PrintIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 6 2 18 2 18 9" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <rect x="6" y="14" width="12" height="8" />
    </svg>
  );
}
