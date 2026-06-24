import { publicBaseUrl } from './http.js';

export function brDate(date) {
  if (!date) return '';
  const [y, m, d] = String(date).split('-');
  return `${d}/${m}/${y}`;
}

export function msgClienteRecebido({ barbearia, cliente_nome, servico_nome, barbeiro_nome, data_agendamento, hora_inicio, agendamento_id }) {
  const link = `${publicBaseUrl()}/api/confirmar?id=${agendamento_id}`;
  return `✅ Agendamento recebido!\n\nOlá, ${cliente_nome}.\nSeu horário foi solicitado na ${barbearia.nome}.\n\nServiço: ${servico_nome}\nBarbeiro: ${barbeiro_nome || 'Qualquer profissional'}\nData: ${brDate(data_agendamento)}\nHorário: ${hora_inicio}\n\nAguarde a confirmação da barbearia.\n\nLink do agendamento:\n${link}`;
}

export function msgDonoNovo({ barbearia, cliente_nome, cliente_whatsapp, servico_nome, barbeiro_nome, data_agendamento, hora_inicio, agendamento_id }) {
  const painel = `${publicBaseUrl()}/painel`;
  return `📅 Novo agendamento - ${barbearia.nome}\n\nCliente: ${cliente_nome}\nWhatsApp: ${cliente_whatsapp}\nServiço: ${servico_nome}\nBarbeiro: ${barbeiro_nome || 'Qualquer profissional'}\nData: ${brDate(data_agendamento)}\nHorário: ${hora_inicio}\n\nAbra o painel para confirmar ou cancelar:\n${painel}`;
}

export function msgClienteConfirmado({ barbearia, cliente_nome, servico_nome, data_agendamento, hora_inicio }) {
  return `✅ Horário confirmado!\n\nOlá, ${cliente_nome}.\nSeu agendamento na ${barbearia.nome} foi confirmado.\n\nServiço: ${servico_nome}\nData: ${brDate(data_agendamento)}\nHorário: ${hora_inicio}\n\nChegue com alguns minutos de antecedência. 💈`;
}

export function msgClienteLembrete({ barbearia, cliente_nome, servico_nome, data_agendamento, hora_inicio }) {
  return `⏰ Lembrete de agendamento\n\nOlá, ${cliente_nome}.\nVocê tem horário na ${barbearia.nome}.\n\nServiço: ${servico_nome}\nData: ${brDate(data_agendamento)}\nHorário: ${hora_inicio}\n\nResponda:\n1 - Vou comparecer\n2 - Quero cancelar`;
}

export function msgDonoClienteConfirmou({ cliente_nome, servico_nome, data_agendamento, hora_inicio }) {
  return `✅ Cliente confirmou presença\n\nCliente: ${cliente_nome}\nServiço: ${servico_nome}\nData: ${brDate(data_agendamento)}\nHorário: ${hora_inicio}`;
}

export function msgDonoClienteCancelou({ cliente_nome, servico_nome, data_agendamento, hora_inicio }) {
  return `⚠️ Cliente pediu cancelamento\n\nCliente: ${cliente_nome}\nServiço: ${servico_nome}\nData: ${brDate(data_agendamento)}\nHorário: ${hora_inicio}\n\nVerifique no painel.`;
}
