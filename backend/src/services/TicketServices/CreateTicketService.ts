import { Op } from "sequelize";
import AppError from "../../errors/AppError";
import GetDefaultWhatsApp from "../../helpers/GetDefaultWhatsApp";
import Ticket from "../../models/Ticket";
import ShowContactService from "../ContactServices/ShowContactService";
import { getIO } from "../../libs/socket";
import FindOrCreateATicketTrakingService from "./FindOrCreateATicketTrakingService";
import Contact from "../../models/Contact";
import Queue from "../../models/Queue";
import User from "../../models/User";
import Whatsapp from "../../models/Whatsapp";
import TicketTraking from "../../models/TicketTraking";
import { incrementCounter } from "../CounterServices/IncrementCounter";
import { getIndependentWhatsappIds } from "../../helpers/linharesIndependentWhatsapps";

interface Request {
  contactId: number;
  userId: number;
  companyId: number;
  queueId?: number;
}

/**
 * Linhares: a conversa nova e bloqueada se o contato ja tem ticket aberto ou
 * pendente em QUALQUER conexao da empresa (antes so olhava a conexao padrao,
 * e o cliente acabava com dois atendentes por dois numeros). O erro leva os
 * detalhes de quem esta com o contato para o frontend oferecer as acoes
 * (abrir, aceitar, pedir transferencia).
 */
const findBlockingTicket = async (
  contactId: number,
  companyId: number,
  targetWhatsappId: number
) => {
  // Linhares: conexão independente (ex.: FIXOLOJA do financeiro) não bloqueia
  // nem é bloqueada pelas outras — só pelos próprios tickets.
  const independentIds = await getIndependentWhatsappIds(companyId);
  let whatsappFilter = {};
  if (independentIds.includes(targetWhatsappId)) {
    whatsappFilter = { whatsappId: targetWhatsappId };
  } else if (independentIds.length) {
    whatsappFilter = { whatsappId: { [Op.notIn]: independentIds } };
  }

  return Ticket.findOne({
    where: {
      contactId,
      companyId,
      status: { [Op.or]: ["open", "pending"] },
      ...whatsappFilter
    },
    include: [
      { model: Contact, as: "contact", attributes: ["id", "name"] },
      { model: User, as: "user", attributes: ["id", "name"] },
      { model: Queue, as: "queue", attributes: ["id", "name"] },
      { model: Whatsapp, as: "whatsapp", attributes: ["id", "name"] }
    ],
    order: [["updatedAt", "DESC"]]
  });
};

const describeBlockingTicket = async (
  ticket: Ticket
): Promise<Record<string, unknown>> => {
  const traking = await TicketTraking.findOne({
    where: { ticketId: ticket.id },
    order: [["id", "DESC"]]
  });

  const since =
    ticket.status === "open"
      ? traking?.startedAt || ticket.updatedAt
      : traking?.queuedAt || ticket.createdAt;

  return {
    ticketId: ticket.id,
    uuid: ticket.uuid,
    status: ticket.status,
    contactName: ticket.contact?.name || null,
    userId: ticket.userId || null,
    userName: ticket.user?.name || null,
    queueId: ticket.queueId || null,
    queueName: ticket.queue?.name || null,
    whatsappId: ticket.whatsappId,
    whatsappName: ticket.whatsapp?.name || null,
    since
  };
};

const CreateTicketService = async ({
  contactId,
  userId,
  queueId,
  companyId
}: Request): Promise<Ticket> => {
  const defaultWhatsapp = await GetDefaultWhatsApp(companyId);

  let ticket = await findBlockingTicket(
    contactId,
    companyId,
    defaultWhatsapp.id
  );

  const include = [
    {
      model: Contact,
      as: "contact",
      include: ["tags", "extraInfo"]
    },
    "queue",
    "whatsapp",
    "user",
    "tags"
  ];

  if (ticket) {
    if (ticket.status === "open" && ticket.userId === userId) {
      await ticket.reload({
        include
      });
      return ticket;
    }
    throw new AppError(
      "ERR_OTHER_OPEN_TICKET",
      400,
      "warn",
      await describeBlockingTicket(ticket)
    );
  }

  const { isGroup } = await ShowContactService(contactId, companyId);

  ticket = await Ticket.create({
    contactId,
    companyId,
    queueId,
    whatsappId: defaultWhatsapp.id,
    status: "open",
    isGroup,
    userId
  });

  if (!ticket) {
    throw new AppError("ERR_CREATING_TICKET");
  }

  await FindOrCreateATicketTrakingService({
    ticketId: ticket.id,
    companyId: ticket.companyId,
    whatsappId: ticket.whatsappId,
    userId: ticket.userId
  });

  incrementCounter(ticket.companyId, "ticket-create");

  await ticket.reload({
    include
  });

  const io = getIO();

  io.to(ticket.id.toString()).emit("ticket", {
    action: "update",
    ticket
  });

  return ticket;
};

export default CreateTicketService;
