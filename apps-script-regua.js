// ════════════════════════════════════════════════════════════════
//  Google Apps Script — Régua Parceiro + Retirada de Régua
//  Planilha: https://docs.google.com/spreadsheets/d/1QPVyf62XQ7DannGc_4Fwow4fdLMoGzKG7BcIGIZPHe4
//  Para publicar: Implantar > Nova implantação > App da Web > Qualquer pessoa
// ════════════════════════════════════════════════════════════════

var TOKEN = 'npreg2026xk9';
var RETIRADA_GID = 1200125203;

function doGet(e) {
  var token = e && e.parameter && e.parameter.token;
  if (token !== TOKEN) {
    return ContentService.createTextOutput(JSON.stringify({ error: 'unauthorized' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var mainData   = readMainSheet(ss);
  var retirada   = readRetiradaSheet(ss);

  return ContentService.createTextOutput(JSON.stringify({ data: mainData, retirada: retirada }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── Lê TODAS as abas de réguas (qualquer aba que NÃO seja a de retirada) ──
function readMainSheet(ss) {
  var sheets = ss.getSheets();
  var allData = [];
  var seen = {};

  for (var s = 0; s < sheets.length; s++) {
    if (sheets[s].getSheetId() === RETIRADA_GID) continue;
    var sheet = sheets[s];

    var rows = sheet.getDataRange().getValues();
    if (rows.length < 2) continue;
    var headers = rows[0].map(function(h){ return String(h).trim().toLowerCase(); });

    function col(names) {
      for (var n = 0; n < names.length; n++) {
        var idx = headers.indexOf(names[n]);
        if (idx >= 0) return idx;
      }
      return -1;
    }

    var iCod  = col(['código','cod','codigo','código parceiro','cod parceiro']);
    var iCom  = col(['comercial']);
    var iReg  = col(['regional']);
    var iSup  = col(['superintendente','sup']);
    var iReg2 = col(['régua','regua','tipo','liberação','liberacao']);
    var iBan  = col(['banco','bancos']);
    var iDat  = col(['data','data início','data inicio']);

    if (iCod < 0) continue;

    for (var i = 1; i < rows.length; i++) {
      var row = rows[i];
      var cod = String(row[iCod] || '').trim();
      if (!cod) continue;
      if (seen[cod]) continue;
      seen[cod] = true;

      var dataVal = iDat >= 0 ? row[iDat] : '';
      var dataStr = '';
      if (dataVal instanceof Date) {
        dataStr = dataVal.toISOString();
      } else {
        dataStr = String(dataVal || '').trim();
      }

      allData.push({
        cod:       cod,
        comercial: iCom >= 0 ? String(row[iCom] || '').trim() : '',
        regional:  iReg >= 0 ? String(row[iReg] || '').trim() : '',
        sup:       iSup >= 0 ? String(row[iSup] || '').trim() : '',
        regua:     iReg2 >= 0 ? String(row[iReg2] || '').trim() : '',
        banco:     iBan >= 0 ? String(row[iBan] || '').trim() : '',
        data:      dataStr
      });
    }
  }
  return allData;
}

// ── Lê a aba RETIRADA DE RÉGUA (col A = cod, col H = data) ──
function readRetiradaSheet(ss) {
  var sheets = ss.getSheets();
  var sheet  = null;
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getSheetId() === RETIRADA_GID) { sheet = sheets[i]; break; }
  }
  if (!sheet) return [];

  var rows = sheet.getDataRange().getValues();
  if (rows.length < 2) return [];

  var data = [];
  for (var i = 1; i < rows.length; i++) {
    var cod     = String(rows[i][0] || '').trim();  // Col A
    var dataVal = rows[i][7];                        // Col H
    if (!cod) continue;

    var dataStr = '';
    if (dataVal instanceof Date) {
      dataStr = Utilities.formatDate(dataVal, Session.getScriptTimeZone(), 'dd/MM/yyyy');
    } else {
      dataStr = String(dataVal || '').trim();
    }

    data.push({ cod: cod, data: dataStr });
  }
  return data;
}
