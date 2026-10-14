import { Op, QueryTypes } from "sequelize";
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
import sequelize from "../../database";
import { logger } from "../../utils/logger";

interface Request {
  contactId: number;
  userId: number;
  companyId: number;
  queueId?: number;
  // Linhares: conexão escolhida na nova conversa (padrão da empresa se vazio)
  whatsappId?: number;
  // Linhares: quem está pedindo (para validar número de vendedor)
  requesterId?: number;
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

/**
 * Linhares: conexão de saída da nova conversa. Se o frontend mandou uma,
 * ela tem de ser da empresa e estar CONNECTED; número de vendedor
 * (linhares_conexao_vendedor) só pelo próprio dono ou por admin.
 * Sem escolha: conexão padrão da empresa, como sempre foi.
 */
const resolveWhatsapp = async (
  companyId: number,
  whatsappId: number | undefined,
  requesterId: number | undefined
): Promise<Whatsapp> => {
  if (!whatsappId) return GetDefaultWhatsApp(companyId);

  const whatsapp = await Whatsapp.findOne({
    where: { id: whatsappId, companyId, channel: "whatsapp" }
  });
  if (!whatsapp) throw new AppError("ERR_NO_DEF_WAPP_FOUND", 404);
  if (whatsapp.status !== "CONNECTED") {
    throw new AppError("ERR_LINHARES_CONNECTION_OFFLINE", 400);
  }

  try {
    const owners = await sequelize.query<{ userId: number }>(
      `SELECT "userId" FROM linhares_conexao_vendedor WHERE "whatsappId" = :whatsappId`,
      { replacements: { whatsappId }, type: QueryTypes.SELECT }
    );
    if (owners.length && owners[0].userId !== requesterId) {
      const requester = requesterId ? await User.findByPk(requesterId) : null;
      if (requester?.profile !== "admin") {
        throw new AppError("ERR_LINHARES_VENDOR_CONNECTION", 403);
      }
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    logger.debug({ error }, "linhares_conexao_vendedor unavailable");
  }

  return whatsapp;
};

const CreateTicketService = async ({
  contactId,
  userId,
  queueId,
  companyId,
  whatsappId,
  requesterId
}: Request): Promise<Ticket> => {
  const defaultWhatsapp = await resolveWhatsapp(
    companyId,
    whatsappId,
    requesterId
  );

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
