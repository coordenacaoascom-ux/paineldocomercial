const https = require('https');
const TOKEN = 'Bearer eyJhbGciOiJIUzUxMiJ9.eyJpc3MiOiJQaXBlZnkiLCJpYXQiOjE3ODAzMzU4MTUsImp0aSI6IjAwNjQzN2M4LWYyZTAtNGYwMS05ZmIxLTE0YmVhZDE2ZjY5NiIsInN1YiI6MzA3NDU5MDcxLCJ1c2VyIjp7ImlkIjozMDc0NTkwNzEsImVtYWlsIjoiZ2VzdGFvZGVwcm9jZXNzb3NAbm92YXByb21vdG9yYS5jb20ifSwidXNlcl90eXBlIjoiYXV0aGVudGljYXRlZCJ9.gyDi7LvQ96wEA5ikzBsuwXmfB0cduUYRK-FB3pWg0GT1XNY2XbEdvvrDG9lsRCJ7ic7Hkv1RMUyeyzb0s_ciMg';

function pipefyRequest(body) {
  return new Promise(function(resolve, reject) {
    const bodyStr = JSON.stringify(body);
    const req = https.request({
      hostname: 'api.pipefy.com',
      path: '/graphql',
      method: 'POST',
      headers: {
        'Authorization': TOKEN,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr)
      }
    }, function(res) {
      var chunks = [];
      res.on('data', function(chunk){ chunks.push(chunk); });
      res.on('end', function(){
        try {
          var data = Buffer.concat(chunks).toString('utf8');
          resolve(JSON.parse(data));
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

async function fetchAllCards(pipeId) {
  var allCards = [];
  var cursor = null;
  var hasNext = true;
  while(hasNext) {
    var afterStr = cursor ? `, after: "${cursor}"` : '';
    var query = `{ allCards(pipeId: "${pipeId}", first: 50${afterStr}) { pageInfo { hasNextPage endCursor } edges { node { id current_phase { name } created_at fields { field { label } value } } } } }`;
    var result = await pipefyRequest({ query });
    var ac = result.data && result.data.allCards;
    if(!ac) break;
    ac.edges.forEach(function(e) {
      var node = e.node;
      var f = {};
      (node.fields||[]).forEach(function(fi){
        var lbl = fi.field.label || '';
        f[lbl] = fi.value || '';
      });
      // obs: busca por regex para resistir a encoding quebrado no label
      var obs = '';
      Object.keys(f).forEach(function(lbl){
        if(/observa/i.test(lbl) && f[lbl] && f[lbl].trim()) {
          if(!obs) obs = f[lbl].trim();
        }
      });
      // motivo da recusa
      var motivo = '';
      Object.keys(f).forEach(function(lbl){
        if(/motivo/i.test(lbl) && f[lbl] && f[lbl].trim()) {
          if(!motivo) motivo = f[lbl].trim();
        }
      });
      // codigo parceiro: busca por regex
      var cp = '';
      Object.keys(f).forEach(function(lbl){
        if(/c.digo\s+parceiro/i.test(lbl) || /codigo\s+parceiro/i.test(lbl)) cp = f[lbl] || '';
      });
      if(!cp) cp = f['CÓDIGO PARCEIRO'] || f['CODIGO PARCEIRO'] || f['CÃ"DIGO PARCEIRO'] || f['CÃDIGO PARCEIRO'] || '';

      var banco = f['BANCO'] || '';
      var rs = f['RAZÃO SOCIAL'] || f['RAZAO SOCIAL'] || f['RAZÃO SOCIAL'] || '';
      Object.keys(f).forEach(function(lbl){
        if(/raz.o\s+social/i.test(lbl)) { if(!rs) rs = f[lbl] || ''; }
        if(/^banco$/i.test(lbl)) { if(!banco) banco = f[lbl] || ''; }
      });

      var tipo = '';
      Object.keys(f).forEach(function(lbl){
        if(/tipo\s+de\s+solicit/i.test(lbl)) tipo = f[lbl] || '';
      });

      var cc = '';
      Object.keys(f).forEach(function(lbl){
        if(/c.digo\s+comercial/i.test(lbl) || /codigo\s+comercial/i.test(lbl)) cc = f[lbl] || '';
      });

      allCards.push({
        id: node.id || '',
        f: node.current_phase ? node.current_phase.name : '',
        t: tipo,
        b: banco,
        cp: cp,
        rs: rs,
        cnpj: f['CNPJ'] || '',
        cc: cc,
        reg: f['REGIONAL'] || '',
        sup: f['SUPERINTENDENTE'] || '',
        cr: node.created_at ? node.created_at.split('T')[0].split('-').reverse().join('/') : '',
        obs: obs,
        motivo: motivo
      });
    });
    hasNext = ac.pageInfo.hasNextPage;
    cursor = ac.pageInfo.endCursor;
  }
  return allCards;
}

exports.handler = async function(event) {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json; charset=utf-8' };
  if (event.httpMethod === 'OPTIONS') { return { statusCode: 200, headers, body: '' }; }

  try {
    var body = JSON.parse(event.body || '{}');

    if(body.fetchCards) {
      var cards = await fetchAllCards('306955502');
      return { statusCode: 200, headers, body: JSON.stringify({ cards }) };
    }

    // Requisição GraphQL passthrough
    var bodyStr = event.body || '{}';
    var result = await new Promise(function(resolve, reject) {
      var req = https.request({
        hostname: 'api.pipefy.com',
        path: '/graphql',
        method: 'POST',
        headers: {
          'Authorization': TOKEN,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyStr)
        }
      }, function(res) {
        var chunks = [];
        res.on('data', function(chunk){ chunks.push(chunk); });
        res.on('end', function(){ resolve(Buffer.concat(chunks).toString('utf8')); });
      });
      req.on('error', reject);
      req.write(bodyStr);
      req.end();
    });
    return { statusCode: 200, headers, body: result };
  } catch(e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
// v4 - fix utf8 encoding + regex field matching
