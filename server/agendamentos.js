import { json, method, normalizePhoneBR, safeString } from '../lib/http.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { sendText } from '../lib/evolution.js';
import { msgClienteRecebido, msgDonoNovo } from '../lib/messages.js';

async function getWhatsapp(barbeariaId) {
  const { data, error } = await supabaseAdmin
    .from('barbearia_whatsapp')
    .select('*')
    .eq('barbearia_id', barbeariaId)
    .eq('ativo', true)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function logWhatsapp({ barbearia_id, agendamento_id, destino, tipo, texto, status, erro, retorno }) {
  await supabaseAdmin.from('whatsapp_logs').insert({
    barbearia_id,
    agendamento_id,
    destino,
    tipo,
    texto,
    status,
    erro: erro || null,
    retorno: retorno || null
  });
}

export default async function handler(req, res) {
  if (!method(req, res, ['POST'])) return;
  try {
    const body = req.body || {};
    const slug = safeString(body.slug);
    const cliente_nome = safeString(body.cliente_nome);
    const cliente_whatsapp = normalizePhoneBR(body.cliente_whatsapp);
    const servico_id = safeString(body.servico_id);
    const barbeiro_id = safeString(body.barbeiro_id) || null;
    const data_agendamento = safeString(body.data_agendamento);
    const hora_inicio = safeString(body.hora_inicio);
    const observacoes = safeString(body.observacoes);

    if (!slug || !cliente_nome || !cliente_whatsapp || !servico_id || !data_agendamento || !hora_inicio) {
      return json(res, 400, { erro: 'Dados obrigatórios faltando.' });
    }

    const { data: barbearia, error: e1 } = await supabaseAdmin
      .from('barbearias')
      .select('*')
      .eq('slug', slug)
      .eq('status', 'ativa')
      .maybeSingle();
    if (e1) throw e1;
    if (!barbearia) return json(res, 404, { erro: 'Barbearia não encontrada ou indisponível.' });

    const { data: servico, error: e2 } = await supabaseAdmin
      .from('servicos')
      .select('id,nome,preco_cents,duracao_minutos')
      .eq('id', servico_id)
      .eq('barbearia_id', barbearia.id)
      .eq('ativo', true)
      .maybeSingle();
    if (e2) throw e2;
    if (!servico) return json(res, 404, { erro: 'Serviço indisponível.' });

    let barbeiro = null;
    if (barbeiro_id) {
      const r = await supabaseAdmin
        .from('barbeiros')
        .select('id,nome')
        .eq('id', barbeiro_id)
        .eq('barbearia_id', barbearia.id)
        .eq('ativo', true)
        .maybeSingle();
      if (r.error) throw r.error;
      barbeiro = r.data;
      if (!barbeiro) return json(res, 404, { erro: 'Barbeiro indisponível.' });
    }

    const { data: ocupado, error: e3 } = await supabaseAdmin
      .from('agendamentos')
      .select('id')
      .eq('barbearia_id', barbearia.id)
      .eq('data_agendamento', data_agendamento)
      .eq('hora_inicio', hora_inicio)
      .eq('barbeiro_id', barbeiro_id)
      .not('status', 'in', '(cancelado,recusado)')
      .maybeSingle();
    if (e3) throw e3;
    if (ocupado) return json(res, 409, { erro: 'Esse horário acabou de ser reservado. Escolha outro horário.' });

    let clienteId = null;
    const { data: clienteExistente } = await supabaseAdmin
      .from('clientes')
      .select('id')
      .eq('barbearia_id', barbearia.id)
      .eq('whatsapp', cliente_whatsapp)
      .maybeSingle();

    if (clienteExistente?.id) {
      clienteId = clienteExistente.id;
      await supabaseAdmin.from('clientes').update({ nome: cliente_nome }).eq('id', clienteId);
    } else {
      const { data: novoCliente, error: e4 } = await supabaseAdmin
        .from('clientes')
        .insert({ barbearia_id: barbearia.id, nome: cliente_nome, whatsapp: cliente_whatsapp })
        .select('id')
        .single();
      if (e4) throw e4;
      clienteId = novoCliente.id;
    }

    const { data: agendamento, error: e5 } = await supabaseAdmin
      .from('agendamentos')
      .insert({
        barbearia_id: barbearia.id,
        servico_id,
        barbeiro_id,
        cliente_id: clienteId,
        cliente_nome,
        cliente_whatsapp,
        data_agendamento,
        hora_inicio,
        observacoes,
        status: 'pendente'
      })
      .select('*')
      .single();
    if (e5) throw e5;

    const whats = await getWhatsapp(barbearia.id);
    const avisos = [];

    if (whats) {
      const textoCliente = msgClienteRecebido({
        barbearia,
        cliente_nome,
        servico_nome: servico.nome,
        barbeiro_nome: barbeiro?.nome,
        data_agendamento,
        hora_inicio,
        agendamento_id: agendamento.id
      });
      try {
        const retorno = await sendText({
          apiUrl: whats.evolution_api_url,
          apiKey: whats.evolution_api_key,
          instanceName: whats.instance_name,
          number: cliente_whatsapp,
          text: textoCliente
        });
        await logWhatsapp({ barbearia_id: barbearia.id, agendamento_id: agendamento.id, destino: cliente_whatsapp, tipo: 'cliente_agendamento_recebido', texto: textoCliente, status: 'enviado', retorno });
        avisos.push('cliente');
      } catch (err) {
        await logWhatsapp({ barbearia_id: barbearia.id, agendamento_id: agendamento.id, destino: cliente_whatsapp, tipo: 'cliente_agendamento_recebido', texto: textoCliente, status: 'erro', erro: err.message });
      }

      if (barbearia.whatsapp_dono) {
        const textoDono = msgDonoNovo({
          barbearia,
          cliente_nome,
          cliente_whatsapp,
          servico_nome: servico.nome,
          barbeiro_nome: barbeiro?.nome,
          data_agendamento,
          hora_inicio,
          agendamento_id: agendamento.id
        });
        try {
          const retorno = await sendText({
            apiUrl: whats.evolution_api_url,
            apiKey: whats.evolution_api_key,
            instanceName: whats.instance_name,
            number: barbearia.whatsapp_dono,
            text: textoDono
          });
          await logWhatsapp({ barbearia_id: barbearia.id, agendamento_id: agendamento.id, destino: barbearia.whatsapp_dono, tipo: 'dono_novo_agendamento', texto: textoDono, status: 'enviado', retorno });
          avisos.push('dono');
        } catch (err) {
          await logWhatsapp({ barbearia_id: barbearia.id, agendamento_id: agendamento.id, destino: barbearia.whatsapp_dono, tipo: 'dono_novo_agendamento', texto: textoDono, status: 'erro', erro: err.message });
        }
      }
    }

    return json(res, 201, { sucesso: true, agendamento, avisos_enviados: avisos });
  } catch (err) {
    return json(res, err.status || 500, { erro: err.message });
  }
}
