import { useState, useEffect } from 'react';

export function useLocalStorage<T>(key: string, initialValue: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw !== null ? (JSON.parse(raw) as T) : initialValue;
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // ignore storage errors
    }
  }, [key, value]);

  return [value, setValue];
}

export function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Escape a string for use as an XML attribute value. */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Export a timetable to CATS XML format.
 * Mapping:
 *   TRAIN_SYMBOL = train.name
 *   ENGINE       = train.train_id
 *   TRAIN_NAME   = train.notes (only when notes < 50 chars)
 *   DEPARTURE    = first stop departure (or arrival)
 *   f3           = first stop station name
 *   f4           = last stop station name
 */
export function exportCatsXml(timetable: import('./types').Timetable): string {
  const stationMap = new Map(timetable.stations.map((s) => [s.id, s]));

  const trainedit = `    <TRAINEDIT>
      <EDITRECORD FIELD_KEY="TRAIN_SYMBOL" FIELD_VISIBLE="true" FIELDLABEL="TRAIN_SYMBOL" FIELD_EDIT="true" FIELD_MANDATORY="true" FIELD_WIDTH="160" ALIGNMENT="CENTER" FIELD_DEFAULT="" FIELD_CLASS="String" />
      <EDITRECORD FIELD_KEY="DEPARTURE" FIELD_VISIBLE="true" FIELDLABEL="DEPARTURE" FIELD_EDIT="true" FIELD_MANDATORY="true" FIELD_WIDTH="87" ALIGNMENT="CENTER" FIELD_DEFAULT="" FIELD_CLASS="TimeSpec" />
      <EDITRECORD FIELD_KEY="ENGINE" FIELD_VISIBLE="true" FIELDLABEL="ENGINE" FIELD_EDIT="true" FIELD_MANDATORY="true" FIELD_WIDTH="143" ALIGNMENT="CENTER" FIELD_DEFAULT="" FIELD_CLASS="String" />
      <EDITRECORD FIELD_KEY="f3" FIELD_VISIBLE="true" FIELDLABEL="ORIGIN" FIELD_EDIT="true" FIELD_MANDATORY="false" FIELD_WIDTH="104" ALIGNMENT="CENTER" FIELD_DEFAULT="" FIELD_CLASS="String" />
      <EDITRECORD FIELD_KEY="f4" FIELD_VISIBLE="true" FIELDLABEL="DESTINATION" FIELD_EDIT="true" FIELD_MANDATORY="false" FIELD_WIDTH="100" ALIGNMENT="CENTER" FIELD_DEFAULT="" FIELD_CLASS="String" />
      <EDITRECORD FIELD_KEY="CREW" FIELD_VISIBLE="true" FIELDLABEL="DRIVER NAME" FIELD_EDIT="true" FIELD_MANDATORY="true" FIELD_WIDTH="164" ALIGNMENT="CENTER" FIELD_DEFAULT="" FIELD_CLASS="ExtraList" />
      <EDITRECORD FIELD_KEY="TRAIN_NAME" FIELD_VISIBLE="true" FIELDLABEL="TRAIN_NAME" FIELD_EDIT="true" FIELD_MANDATORY="true" FIELD_WIDTH="108" ALIGNMENT="CENTER" FIELD_DEFAULT="" FIELD_CLASS="String" />
      <EDITRECORD FIELD_KEY="TRANSPONDING" FIELD_VISIBLE="false" FIELDLABEL="TRANSPONDING" FIELD_EDIT="true" FIELD_MANDATORY="true" FIELD_WIDTH="75" ALIGNMENT="CENTER" FIELD_DEFAULT="" FIELD_CLASS="String" />
      <EDITRECORD FIELD_KEY="CABOOSE" FIELD_VISIBLE="false" FIELDLABEL="CABOOSE" FIELD_EDIT="true" FIELD_MANDATORY="true" FIELD_WIDTH="54" ALIGNMENT="CENTER" FIELD_DEFAULT="" FIELD_CLASS="String" />
      <EDITRECORD FIELD_KEY="ONDUTY" FIELD_VISIBLE="false" FIELDLABEL="ONDUTY" FIELD_EDIT="true" FIELD_MANDATORY="true" FIELD_WIDTH="50" ALIGNMENT="CENTER" FIELD_DEFAULT="" FIELD_CLASS="TimeSpec" />
      <EDITRECORD FIELD_KEY="FONT" FIELD_VISIBLE="false" FIELDLABEL="FONT" FIELD_EDIT="true" FIELD_MANDATORY="true" FIELD_WIDTH="75" ALIGNMENT="CENTER" FIELD_DEFAULT="FONT_LABEL" FIELD_CLASS="FontSpec" />
      <EDITRECORD FIELD_KEY="LENGTH" FIELD_VISIBLE="false" FIELDLABEL="LENGTH" FIELD_EDIT="true" FIELD_MANDATORY="true" FIELD_WIDTH="75" ALIGNMENT="CENTER" FIELD_DEFAULT="0" FIELD_CLASS="Integer" />
      <EDITRECORD FIELD_KEY="WEIGHT" FIELD_VISIBLE="false" FIELDLABEL="WEIGHT" FIELD_EDIT="true" FIELD_MANDATORY="true" FIELD_WIDTH="75" ALIGNMENT="CENTER" FIELD_DEFAULT="0" FIELD_CLASS="Integer" />
      <EDITRECORD FIELD_KEY="CARS" FIELD_VISIBLE="false" FIELDLABEL="CARS" FIELD_EDIT="true" FIELD_MANDATORY="true" FIELD_WIDTH="75" ALIGNMENT="CENTER" FIELD_DEFAULT="0" FIELD_CLASS="Integer" />
      <EDITRECORD FIELD_KEY="AUTOTERMINATE" FIELD_VISIBLE="false" FIELDLABEL="AUTOTERMINATE" FIELD_EDIT="true" FIELD_MANDATORY="true" FIELD_WIDTH="50" ALIGNMENT="CENTER" FIELD_DEFAULT="false" FIELD_CLASS="Boolean" />
      <EDITRECORD FIELD_KEY="LABELBACKGROUND" FIELD_VISIBLE="false" FIELDLABEL="LABELBACKGROUND" FIELD_EDIT="true" FIELD_MANDATORY="true" FIELD_WIDTH="50" ALIGNMENT="CENTER" FIELD_DEFAULT="false" FIELD_CLASS="Boolean" />
    </TRAINEDIT>`;

  const sortedTrains = [...timetable.trains].sort((a, b) => {
    const depA = a.stops[0]?.departure ?? a.stops[0]?.arrival ?? '';
    const depB = b.stops[0]?.departure ?? b.stops[0]?.arrival ?? '';
    if (!depA) return 1;
    if (!depB) return -1;
    return timeToMinutes(depA) - timeToMinutes(depB);
  });

  const dataRecords = sortedTrains.map((train) => {
    const stops = train.stops;
    const firstStop = stops[0];
    const lastStop = stops[stops.length - 1];

    const departure = firstStop ? (firstStop.departure ?? firstStop.arrival ?? '') : '';
    const origin = firstStop ? (stationMap.get(firstStop.station_id)?.name ?? '') : '';
    const destination = lastStop ? (stationMap.get(lastStop.station_id)?.name ?? '') : '';
    const trainSymbol = escapeXml(train.name);
    const engine = escapeXml(train.train_id ?? '');
    const trainName = escapeXml(train.notes && train.notes.length < 50 ? train.notes : '');

    return `      <DATARECORD TRAIN_NAME="${trainName}" TRAIN_SYMBOL="${trainSymbol}" ENGINE="${engine}" CREW="" TRANSPONDING="" CABOOSE="" ONDUTY="" DEPARTURE="${escapeXml(departure)}" FONT="FONT_LABEL" LENGTH="0" WEIGHT="0" CARS="0" AUTOTERMINATE="false" LABELBACKGROUND="false" f3="${escapeXml(origin)}" f4="${escapeXml(destination)}" />`;
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<DOCUMENT VERSION="3.0">',
    '  <TRAINSTORE>',
    trainedit,
    '    <TRAINDATA>',
    ...dataRecords,
    '    </TRAINDATA>',
    '  </TRAINSTORE>',
    '</DOCUMENT>',
  ].join('\n');
}

/** Generate tick marks between startTime and endTime at the given interval (minutes). */
export function generateTicks(
  startTime: string,
  endTime: string,
  intervalMinutes: number
): number[] {
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  const ticks: number[] = [];
  const first = Math.ceil(start / intervalMinutes) * intervalMinutes;
  for (let t = first; t <= end; t += intervalMinutes) {
    ticks.push(t);
  }
  return ticks;
}
