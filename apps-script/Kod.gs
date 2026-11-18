function onEdit(e) {
  var r = e.range, sh = r.getSheet();
  if (sh.getName() !== 'Pilot Log') return;
  var top = Math.max(r.getRow(), 3), bottom = r.getLastRow();
  if (bottom < top) return;
  var c1 = r.getColumn(), c2 = r.getLastColumn(), n = bottom - top + 1;

  // Ferried ICAO (Q): ICAO code to capitals
  if (c1 <= 17 && c2 >= 17) {
    var cells = sh.getRange(top, 17, n, 1), v = cells.getValues();
    for (var i = 0; i < v.length; i++) {
      if (typeof v[i][0] === 'string') {
        v[i][0] = v[i][0].replace(/^(\s*)([A-Za-z0-9]{4})(?=\s|$)/, function (m, s, c) {
          return s + c.toUpperCase();
        });
      }
    }
    cells.setValues(v);
  }

  // Aircraft Type (H) and Registration (I)
  if (c1 <= 9 && c2 >= 8) {
    var fleet = e.source.getSheetByName('Fleet').getRange('A4:B60').getValues()
      .filter(function (f) { return f[0] !== ''; });
    var all = fleet.map(function (f) { return String(f[0]); });
    var regOnly = (c1 === 9);
    var rows = sh.getRange(top, 8, n, 2).getValues();
    for (var j = 0; j < rows.length; j++) {
      var row = top + j, type = String(rows[j][0]), reg = String(rows[j][1]);
      if (regOnly && reg !== '') {
        var hit = fleet.filter(function (f) { return String(f[0]) === reg; })[0];
        if (hit) { type = String(hit[1]); sh.getRange(row, 8).setValue(type); }
      } else if (!regOnly && reg !== '' && type !== '') {
        var ok = fleet.some(function (f) { return String(f[0]) === reg && String(f[1]) === type; });
        if (!ok) sh.getRange(row, 9).clearContent();
      }
      var list = fleet.filter(function (f) { return String(f[1]) === type; })
        .map(function (f) { return String(f[0]); });
      if (list.length === 0) list = all;
      sh.getRange(row, 9).setDataValidation(SpreadsheetApp.newDataValidation()
        .requireValueInList(list, true).setAllowInvalid(true).build());
    }
  }
}

// Menu at the top of the sheet: Pilot Log > Add row
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Pilot Log')
    .addItem('Add row', 'addPilotLogRow').addToUi();
}

// Adds one new row at the bottom of the Pilot Log with the same formulas,
// dropdowns and colours, and empty input cells.
function addPilotLogRow() {
  var sh = SpreadsheetApp.getActive().getSheetByName('Pilot Log');
  var last = sh.getLastRow();
  if (last < 4) return;
  sh.insertRowAfter(last);
  sh.getRange(last - 1, 1, 1, 19).copyTo(sh.getRange(last + 1, 1, 1, 19));
  ['B', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'P', 'Q'].forEach(function (col) {
    sh.getRange(col + (last + 1)).clearContent();
  });
  sh.getRange('I' + (last + 1)).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInRange(SpreadsheetApp.getActive().getRange('Fleet!$A$4:$A$60'), true)
    .setAllowInvalid(true).build());
  sh.setActiveRange(sh.getRange('B' + (last + 1)));
}

