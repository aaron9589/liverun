/**
 * Pure data migrations run against the in-memory DB at startup.
 * Each mutates `db` in place and returns the number of records changed.
 */

// Removes the retired `train_type` field from every train in every timetable.
function stripTrainType(db) {
  let changed = 0;
  for (const tt of (db && db.timetables) || []) {
    for (const tr of (tt.trains ?? [])) {
      if (Object.prototype.hasOwnProperty.call(tr, 'train_type')) {
        delete tr.train_type;
        changed++;
      }
    }
  }
  return changed;
}

module.exports = { stripTrainType };
