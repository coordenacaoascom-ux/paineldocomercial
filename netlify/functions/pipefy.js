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
      let data = '';
      res.on('data', function(chunk){ data += chunk; });
      res.on('end', function(){
        try { resolve(JSON.parse(data)); } catch(e) { reject(e); }
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
      (node.fields||[]).forEach(function(fi){ f[fi.field.label] = fi.value || ''; });
      allCards.push({
        id: node.id || '',
        f: node.current_phase ? node.current_phase.name : '',
        t: f['TIPO DE SOLICITAÇÃO'] || '',
        b: f['BANCO'] || '',
        cp: f['CÓDIGO PARCEIRO'] || '',
        rs: f['RAZÃO SOCIAL'] || '',
        cnpj: f['CNPJ'] || '',
        cc: f['CÓDIGO COMERCIAL'] || '',
        reg: f['REGIONAL'] || '',
        sup: f['SUPERINTENDENTE'] || '',
        cr: node.created_at ? node.created_at.split('T')[0].split('-').reverse().join('/') : '',
        obs: f['OBSERVAÇÃO'] || f['OBSERVACAO'] || f['OBSERVAÇÕES'] || f['OBSERVACOES'] || ''
      });
    });
    hasNext = ac.pageInfo.hasNextPage;
    cursor = ac.pageInfo.endCursor;
  }
  return allCards;
}

exports.handler = async function(event) {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') { return { statusCode: 200, headers, body: '' }; }

  try {
    var body = JSON.parse(event.body || '{}');

    // Se for requisição de cards completos
    if(body.fetchCards) {
      var cards = await fetchAllCards('306955502');
      return { statusCode: 200, headers, body: JSON.stringify({ cards }) };
    }

    // Requisição GraphQL normal (fases)
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
        let data = '';
        res.on('data', function(chunk){ data += chunk; });
        res.on('end', function(){ resolve(data); });
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
// v2
