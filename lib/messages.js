import { publicBaseUrl } from './http.js';

export function brDate(date) {
  if (!date) return '';
  const [y, m, d] = String(date).split('-');
  return `${d}/${m}/${y}`;
}

export function msgClienteRecebido({ barbearia, cliente_nome, servico_nome, barbeiro_nome, data_agendamento, hora_inicio, agendamento_id }) {
  const link = `${publicBaseUrl()}/api/confirmar?id=${agendamento_id}`;
  return `Agendamento recebido!\n\nOla, ${cliente_nome}.\nSeu horario foi solicitado na ${barbearia.nome}.\n\nServico: ${servico_nome}\nBarbeiro: ${barbeiro_nome || 'Qualquer profissional'}\nData: ${brDate(data_agendamento)}\nHorario: ${hora_inicio}\n\nAguarde a confirmacao da barbearia.\n\nLink do agendamento:\n${link}`;
}

export function msgDonoNovo({ barbearia, cliente_nome, cliente_whatsapp, servico_nome, barbeiro_nome, data_agendamento, hora_inicio }) {
  const painel = `${publicBaseUrl()}/painel`;
  return `Novo agendamento - ${barbearia.nome}\n\nCliente: ${cliente_nome}\nWhatsApp: ${cliente_whatsapp}\nServico: ${servico_nome}\nBarbeiro: ${barbeiro_nome || 'Qualquer profissional'}\nData: ${brDate(data_agendamento)}\nHorario: ${hora_inicio}\n\nAbra o painel para acompanhar:\n${painel}`;
}

export function msgClienteConfirmado({ barbearia, cliente_nome, servico_nome, data_agendamento, hora_inicio }) {
  return `Horario confirmado!\n\nOla, ${cliente_nome}.\nSeu agendamento na ${barbearia.nome} foi confirmado.\n\nServico: ${servico_nome}\nData: ${brDate(data_agendamento)}\nHorario: ${hora_inicio}\n\nChegue com alguns minutos de antecedencia.`;
}

export function msgClienteLembrete({ barbearia, cliente_nome, servico_nome, data_agendamento, hora_inicio }) {
  return `Lembrete do seu horario\n\nOla, ${cliente_nome}. Faltam cerca de 30 minutos para seu horario na ${barbearia.nome}.\n\nServico: ${servico_nome}\nData: ${brDate(data_agendamento)}\nHorario: ${hora_inicio}\n\nResponda:\n1 - Confirmar presenca\n2 - Cancelar horario`;
}

export function msgDonoClienteConfirmou({ cliente_nome, servico_nome, data_agendamento, hora_inicio }) {
  return `Cliente confirmou presenca\n\nCliente: ${cliente_nome}\nServico: ${servico_nome}\nData: ${brDate(data_agendamento)}\nHorario: ${hora_inicio}`;
}

export function msgDonoClienteCancelou({ cliente_nome, servico_nome, data_agendamento, hora_inicio }) {
  return `Cliente pediu cancelamento\n\nCliente: ${cliente_nome}\nServico: ${servico_nome}\nData: ${brDate(data_agendamento)}\nHorario: ${hora_inicio}\n\nVerifique no painel.`;
}
