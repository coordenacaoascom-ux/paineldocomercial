const https = require('https');

const STORM_USER = '3504';
const STORM_PASS = 'Promotoraaaa@@2405';
const STORM_HOST = 'openapi.stormfin.com.br';

var _stormToken = null;
var _stormTokenExp = 0;

function httpReq(options, body) {
  return new Promise(function(resolve, reject) {
    var req = https.request(options, function(res) {
      var chunks = [];
      res.on('data', function(c) { chunks.push(c); });
      res.on('end', function() {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
        } catch(e) { reject(new Error('JSON parse error: ' + e.message)); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function getToken() {
  var now = Date.now();
  if (_stormToken && now < _stormTokenExp) return _stormToken;
  var body = 'grant_type=password&username=' + encodeURIComponent(STORM_USER) + '&password=' + encodeURIComponent(STORM_PASS);
  var res = await httpReq({
    hostname: STORM_HOST, path: '/token', method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
  }, body);
  if (!res.data || !res.data.access_token) throw new Error('Storm auth failed: ' + JSON.stringify(res.data));
  _stormToken = res.data.access_token;
  _stormTokenExp = now + ((res.data.expires_in || 3600) * 1000 - 60000);
  return _stormToken;
}

exports.handler = async function(event) {
  var cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json; charset=utf-8'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };

  try {
    var body = JSON.parse(event.body || '{}');
    var ade = body.ade;
    if (!ade) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'ade obrigatorio' }) };

    var token = await getToken();
    var res = await httpReq({
      hostname: STORM_HOST,
      path: '/contrato?ade=' + encodeURIComponent(ade),
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + token }
    });

    return { statusCode: res.status, headers: cors, body: JSON.stringify(res.data) };
  } catch(e) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: e.message }) };
  }
};
