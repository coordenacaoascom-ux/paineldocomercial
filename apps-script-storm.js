// ════════════════════════════════════════════════════════════════
//  Google Apps Script — Proxy Storm API (Portal Comissões)
//  Como publicar:
//    1. Abrir script.google.com → Novo projeto
//    2. Colar este código
//    3. Implantar > Nova implantação > App da Web
//       - Executar como: Eu mesmo
//       - Quem tem acesso: Qualquer pessoa
//    4. Copiar a URL gerada e colar em STORM_GAS_URL no index.html
// ════════════════════════════════════════════════════════════════

var STORM_TOKEN_KEY = 'STORM_TOKEN';
var STORM_TOKEN_EXP_KEY = 'STORM_TOKEN_EXP';
var GAS_SECRET = 'stormportal2026np';

var STORM_USER = '3504';
var STORM_PASS = 'Promotoraaaa@@2405';
var STORM_CLIENT_ID = 'KxF2YZGcLTjk3WpaxEE7';
var STORM_BASE = 'https://openapi.stormfin.com.br';

function getStormToken() {
  var cache = CacheService.getScriptCache();
  var token = cache.get(STORM_TOKEN_KEY);
  if (token) return token;

  var resp = UrlFetchApp.fetch(STORM_BASE + '/token', {
    method: 'post',
    contentType: 'application/x-www-form-urlencoded',
    payload: 'grant_type=password&username=' + encodeURIComponent(STORM_USER)
      + '&password=' + encodeURIComponent(STORM_PASS)
      + '&client_id=' + encodeURIComponent(STORM_CLIENT_ID),
    muteHttpExceptions: true
  });

  var data = JSON.parse(resp.getContentText());
  if (!data.access_token) throw new Error('Storm auth failed: ' + resp.getContentText());

  var ttl = data.expires_in ? Math.min(data.expires_in - 60, 21600) : 3540;
  cache.put(STORM_TOKEN_KEY, data.access_token, ttl);
  return data.access_token;
}

function isValidDate(s) {
  if (!s) return false;
  var base = s.split('T')[0];
  return base !== '0000-00-00' && base.replace(/[-0]/g, '') !== '';
}

function fmtDate(s) {
  if (!isValidDate(s)) return null;
  var d = s.split('T')[0].split('-');
  return d.length === 3 ? d[2] + '/' + d[1] + '/' + d[0] : null;
}

function fmtBRL(n) {
  if (!n && n !== 0) return '—';
  return 'R$ ' + Number(n).toFixed(2).replace('.', ',').replace(/(\d)(?=(\d{3})+,)/g, '$1.');
}

function deriveSituacao(c) {
  var tcc = c.tabela_coeficiente_comissao;
  var cor = c.corretor;
  var statusNome = (c.status_contrato && c.status_contrato.nome) || '';
  var temData = isValidDate(c.data_pgto_bc);
  if (!cor || !cor.usuario) return 'DADOS IMPORTADOS — USUÁRIO NÃO VINCULADO';
  if (/TOMAD/i.test(statusNome)) return 'CONTRATO EM TOMADA DE DECISÃO';
  if (!tcc) return temData ? 'DADOS IMPORTADOS' : 'AGUARDANDO IMPORTAÇÃO (RELATÓRIO BANCO)';
  return temData ? 'COMISSÃO PAGA AO CORRETOR' : 'COMISSÃO DISPONÍVEL PARA PAGAMENTO';
}

function normalizeContrato(c) {
  var cor = c.corretor || {};
  var sala = cor.loja_sala || {};
  var comercialInfo = sala.responsavel || {};
  var regionalInfo = sala.regional || {};

  var comercialStr = '—';
  if (comercialInfo.usuario && comercialInfo.nome) comercialStr = comercialInfo.usuario + ' - ' + comercialInfo.nome;
  else if (cor.usuario && cor.nome) comercialStr = cor.usuario + ' - ' + cor.nome;

  var regionalStr = '—';
  if (regionalInfo.usuario && regionalInfo.nome) regionalStr = regionalInfo.usuario + ' - ' + regionalInfo.nome;

  var responsavelStr = (cor.usuario && cor.nome) ? cor.usuario + ' - ' + cor.nome : '—';

  var tcc = c.tabela_coeficiente_comissao || {};
  var sf = deriveSituacao(c);
  var vb = c.valor_bruto || 0;
  var recPct     = parseFloat(tcc.comissao_recebida) || 0;
  var repPct     = parseFloat(tcc.comissao_repassada) || 0;
  var repVal     = vb * repPct / 100;
  var adtRecPct  = parseFloat(tcc.comissao_recebida_adiantamento) || 0;
  var adtRepPct  = parseFloat(tcc.comissao_repassada_adiantamento) || 0;
  var adtRepVal  = vb * adtRepPct / 100;
  var totalRep   = repVal + adtRepVal;

  var linhas = [];
  if (tcc.id) {
    linhas.push({
      valorBase: fmtBRL(vb),
      valorBaseBruto: '—',
      comissaoRecebida: recPct.toFixed(2) + '%',
      comissaoValor: fmtBRL(repVal),
      adiantamento: adtRepPct > 0 ? fmtBRL(adtRepVal) : '—',
      adiantamentoPct: adtRepPct > 0 ? adtRepPct.toFixed(2) + '%' : '—',
      importadoPor: '—',
      observacoes: '',
      dataImportacao: fmtDate(c.data_pgto_bc) || '—',
      status: 'Analisada'
    });
  }

  var comissaoPaga = null;
  if (sf.includes('PAGA AO CORRETOR')) {
    comissaoPaga = {
      dataPagamento: fmtDate(c.data_pgto_bc) || '—',
      valorBase: fmtBRL(vb),
      valorComissao: fmtBRL(repVal),
      valorAdiantamento: adtRepPct > 0 ? fmtBRL(adtRepVal) : '—',
      totalPercentual: (repPct + adtRepPct).toFixed(2) + '%',
      valorTotal: fmtBRL(totalRep)
    };
  }

  return {
    codigo: c.codigo || '—',
    ade: c.ade || '—',
    responsavel: responsavelStr,
    banco: (c.banco && c.banco.nome) || '—',
    tipo: (c.operacao && c.operacao.nome) || '—',
    digitacao: fmtDate(c.data_pgto_bc) || '—',
    comercial: comercialStr,
    regional: regionalStr,
    multiloja: cor.corretor_multilojas ? 'Sim' : 'Não',
    nomeTabela: (tcc.orgao_tabela && tcc.orgao_tabela.nome_tabela) || '—',
    idTabela: tcc.id ? 'P.' + tcc.id : '—',
    situacaoFinanceiro: sf,
    linhasComissao: linhas,
    comissaoPaga: comissaoPaga,
    dataPagamento: fmtDate(c.data_pgto_bc),
    dadosOperacional: {
      contratoPendente: '—',
      situacaoContrato: (c.status_contrato && c.status_contrato.nome) || '—',
      dataPgtoCliente: fmtDate(c.data_pgto_bc) || '',
      historicoSituacao: '—',
      historicoTrocaAde: '—',
      historicoPendencia: '—'
    }
  };
}

function buscarTotalRepassado(token, usuario, dataPgtoBc) {
  var parts = dataPgtoBc.split('T')[0].split('-');
  if (parts.length < 3) return null;
  var mes = parseInt(parts[1], 10);
  var ano = parseInt(parts[0], 10);
  var pgtoMs = new Date(ano, mes - 1, parseInt(parts[2], 10)).getTime();
  try {
    var resp = UrlFetchApp.fetch(
      STORM_BASE + '/conta_corrente/consulta_lancamentos?usuario=' + encodeURIComponent(usuario) + '&mes=' + mes + '&ano=' + ano,
      { method: 'get', headers: { 'Authorization': 'Bearer ' + token }, muteHttpExceptions: true }
    );
    var data = JSON.parse(resp.getContentText());
    var lancamentos = (data && data.lancamentos) ? data.lancamentos : [];
    var matches = lancamentos.filter(function(l) {
      if (l.categoria !== 'Comissão paga ao Parceiro') return false;
      var ldMs = new Date(l.data_lancamento + 'T00:00:00').getTime();
      return Math.abs(ldMs - pgtoMs) <= 3 * 24 * 3600 * 1000;
    });
    if (matches.length === 1) return matches[0].valor;
  } catch(ex) {}
  return null;
}

function doGet(e) {
  var output = ContentService.createTextOutput();
  output.setMimeType(ContentService.MimeType.JSON);

  try {
    var token = e && e.parameter && e.parameter.token;
    if (token !== GAS_SECRET) {
      output.setContent(JSON.stringify({ error: 'unauthorized' }));
      return output;
    }

    var ade = e && e.parameter && e.parameter.ade;
    if (!ade) {
      output.setContent(JSON.stringify({ error: 'ade obrigatorio' }));
      return output;
    }

    var stormToken = getStormToken();
    var resp = UrlFetchApp.fetch(STORM_BASE + '/contratos?ade=' + encodeURIComponent(ade), {
      method: 'get',
      headers: { 'Authorization': 'Bearer ' + stormToken },
      muteHttpExceptions: true
    });

    var raw = JSON.parse(resp.getContentText());
    var items = (raw && raw.data) ? raw.data : (Array.isArray(raw) ? raw : []);
    var contratos = items.map(function(c) {
      var norm = normalizeContrato(c);
      if (norm.situacaoFinanceiro.indexOf('PAGA AO CORRETOR') >= 0 &&
          c.corretor && c.corretor.usuario && c.data_pgto_bc) {
        var total = buscarTotalRepassado(stormToken, c.corretor.usuario, c.data_pgto_bc);
        if (total !== null && norm.comissaoPaga) {
          norm.comissaoPaga.valorTotal = fmtBRL(total);
        }
      }
      return norm;
    });

    output.setContent(JSON.stringify(contratos));
  } catch(e) {
    output.setContent(JSON.stringify({ error: e.message }));
  }

  return output;
}
